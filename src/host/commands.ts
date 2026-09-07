/**
 * 宿主适配层·headless 命令面（A4，借鉴 dsh-checkpoint-diff 的 /diff、/rollback）。
 *
 * dsh 0.1.2 的命令系统是 cordis 服务 `commands`（CommandRuntime.register），
 * 命令不产生模型消息，结果由 UI 直接渲染——脚本与 CLI 也能消费。
 *
 * 提供两个命令：
 *  - /shadow-diff：两个时间节点（轮号 / 检查点 id / trace 序号）之间的变更摘要；
 *  - /shadow-undo：撤销该工作区最近一次文件恢复。
 *
 * 命令服务缺失的宿主上注册静默跳过（`ctx.commands?`），不 pending。
 */

import { errorMessage } from '../errors.js'
import { traceRangeDiff } from '../trace-replay.js'
import type { ShadowRewindEngine } from '../engine.js'
import { bumpWorkspaceRevision } from './revision.js'
import { decodeUtf8, countLines, lineCounts, readChangeSide } from './fs-changes.js'
import { sessionEvents } from './types.js'
import type { AgentFace } from './types.js'

/** 命令注册面（结构类型；`commands` 服务缺失时注册静默跳过，不 pending）。 */
export interface ShadowRewindCommandsHost {
  readonly commands?: {
    register(definition: {
      readonly name: string
      readonly description: string
      readonly input?: { readonly hint: string }
      readonly handler: (invocation: ShadowRewindCommandInvocation) => Promise<ShadowRewindCommandResult> | ShadowRewindCommandResult
    }): () => void
  }
}

export interface ShadowRewindCommandInvocation {
  readonly agent: AgentFace
  readonly rawInput: string
  readonly signal?: AbortSignal
}

export interface ShadowRewindCommandResult {
  readonly kind: 'success' | 'error'
  readonly text: string
}

const COMMAND_DIFF_USAGE = '用法：/shadow-diff [起] [终]\n起/终可以是：轮号（如 3）、检查点 id（rp_…）、轨迹节点（trace:序号）。\n省略「终」时对比「该轮轮起 → 该轮轮末（或下一轮轮起）」。'
/** 命令输出的行数上限（聊天输出不是导出工具，防刷屏）。 */
const COMMAND_MAX_ROWS = 40

/** 注册 headless 命令：/shadow-diff（区间 diff 摘要）与 /shadow-undo（撤销最近一次恢复）。 */
export function installShadowRewindCommands(ctx: ShadowRewindCommandsHost, engine: ShadowRewindEngine): void {
  ctx.commands?.register({
    name: 'shadow-diff',
    description: 'shadow-rewind：两个时间节点之间的文件变更摘要（轮号 / 检查点 id / trace 序号）',
    input: { hint: '[起] [终]' },
    handler: (invocation) => runShadowDiffCommand(engine, invocation),
  })
  ctx.commands?.register({
    name: 'shadow-undo',
    description: 'shadow-rewind：撤销这个工作区最近一次文件恢复',
    handler: (invocation) => runShadowUndoCommand(engine, invocation),
  })
}

/** /shadow-diff 参数的三种寻址（token 形状决定，混用即报错）。 */
type DiffTarget =
  | { readonly kind: 'turn'; readonly turn: number }
  | { readonly kind: 'checkpoint'; readonly id: string }
  | { readonly kind: 'trace'; readonly seq: number }

/** 按 token 形状解析寻址：rp_ 检查点 id / trace:序号 / ≤9 位轮号。 */
function parseDiffTarget(token: string): DiffTarget | null {
  if (/^rp_[0-9a-z]+_[0-9a-f]{12}$/.test(token)) return { kind: 'checkpoint', id: token }
  if (/^trace:[0-9]+$/.test(token)) return { kind: 'trace', seq: Number(token.slice('trace:'.length)) }
  if (/^[0-9]+$/.test(token) && token.length <= 9) return { kind: 'turn', turn: Number(token) }
  return null
}

async function runShadowDiffCommand(engine: ShadowRewindEngine, invocation: ShadowRewindCommandInvocation): Promise<ShadowRewindCommandResult> {
  const cwd = invocation.agent.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') {
    return { kind: 'error', text: '当前会话没有工作区，无法对比。' }
  }
  const tokens = invocation.rawInput.trim().split(/\s+/).filter((token) => token !== '')
  if (tokens.length === 0 || tokens.length > 2) return { kind: 'error', text: COMMAND_DIFF_USAGE }
  const targets: DiffTarget[] = []
  for (const token of tokens) {
    const target = parseDiffTarget(token)
    if (target === null) return { kind: 'error', text: `无法识别「${token}」。\n${COMMAND_DIFF_USAGE}` }
    targets.push(target)
  }
  try {
    if (targets.every((target) => target.kind === 'trace')) {
      const [from, to] = targets as [{ kind: 'trace'; seq: number }, { kind: 'trace'; seq: number }]
      if (from.seq >= to.seq) return { kind: 'error', text: 'trace 区间语义是 (from, to]，from 必须小于 to。' }
      const result = traceRangeDiff(sessionEvents(invocation.agent.session), from.seq, to.seq)
      const header = `轨迹区间 #${String(from.seq)} → #${String(to.seq)}：${String(result.changes.length)} 个文件变更`
      return { kind: 'success', text: formatCommandDiff(header, result.changes, result.notes) }
    }
    if (targets.some((target) => target.kind === 'trace')) {
      return { kind: 'error', text: `快照检查点与轨迹节点不可混用。\n${COMMAND_DIFF_USAGE}` }
    }
    const sessionId = invocation.agent.session.id
    const checkpoints = await engine.listTurnCheckpoints({ cwd, sessionId })
    const startByTurn = new Map<number, string>()
    for (const point of checkpoints) {
      if (point.phase !== 'end' && point.turn !== undefined) startByTurn.set(point.turn, point.id)
    }
    const resolveCheckpoint = async (target: DiffTarget): Promise<string | null> => {
      if (target.kind === 'checkpoint') return target.id
      if (target.kind === 'turn') return startByTurn.get(target.turn) ?? null
      return null
    }
    let fromId: string | null
    let toId: string | null
    if (targets.length === 1 && targets[0]!.kind === 'turn') {
      // 单轮：轮起 → 轮末（无轮末则下一轮轮起，与 fs-changes 配对语义一致）。
      const turn = targets[0]!.turn
      fromId = startByTurn.get(turn) ?? null
      if (fromId === null) return { kind: 'error', text: `没有找到轮 ${String(turn)} 的轮起检查点（可能未开启自动检查点，或已超出保留上限）。` }
      const end = checkpoints.find((point) => point.phase === 'end' && point.turn === turn)
      toId = end?.id ?? startByTurn.get(turn + 1) ?? null
      if (toId === null) return { kind: 'error', text: `轮 ${String(turn)} 没有轮末检查点，也没有下一轮轮起可配对；可稍后重试或显式指定两个节点。` }
    } else if (targets.length === 2) {
      fromId = await resolveCheckpoint(targets[0]!)
      toId = await resolveCheckpoint(targets[1]!)
    } else {
      return { kind: 'error', text: COMMAND_DIFF_USAGE }
    }
    if (fromId === null || toId === null) {
      return { kind: 'error', text: '没有找到对应的检查点（可能已超出保留上限或被清理）。' }
    }
    const diff = await engine.diffCheckpoints({ cwd, prevCheckpointId: fromId, currCheckpointId: toId })
    const countBudget = { remaining: COMMAND_MAX_ROWS }
    const rows = await Promise.all(diff.changes.map(async (change) => {
      const [before, after] = await Promise.all([
        change.before === undefined ? Promise.resolve(null) : readChangeSide(engine, cwd, fromId!, change.path),
        change.after === undefined ? Promise.resolve(null) : readChangeSide(engine, cwd, toId!, change.path),
      ])
      const beforeText = before === null ? null : decodeUtf8(before)
      const afterText = after === null ? null : decodeUtf8(after)
      let counts: { added: number; removed: number } | undefined
      if (countBudget.remaining > 0 && (beforeText !== null || afterText !== null)) {
        countBudget.remaining -= 1
        counts = beforeText === null
          ? { added: countLines(afterText ?? ''), removed: 0 }
          : afterText === null
            ? { added: 0, removed: countLines(beforeText) }
            : lineCounts(beforeText, afterText)
      }
      return { path: change.path, kind: change.kind === 'mode-changed' ? 'modified' as const : change.kind, counts }
    }))
    return { kind: 'success', text: formatCommandDiff(`检查点 ${fromId} → ${toId}：${String(rows.length)} 个文件变更`, rows, undefined) }
  } catch (error) {
    return { kind: 'error', text: `对比失败：${errorMessage(error)}` }
  }
}

/** 命令输出的固定宽度摘要：A/M/D 前缀 + 行数（预算内才带）。 */
function formatCommandDiff(header: string, rows: readonly { readonly path: string; readonly kind: string; readonly counts?: { readonly added: number; readonly removed: number }; readonly added?: number; readonly removed?: number }[], notes: readonly string[] | undefined): string {
  const glyph: Record<string, string> = { added: 'A', deleted: 'D', modified: 'M' }
  const shown = rows.slice(0, COMMAND_MAX_ROWS)
  const lines = shown.map((row) => {
    // 两种行形状：快照模式行数在 counts，轨迹模式行数直接在 added/removed。
    const added = row.counts?.added ?? row.added
    const removed = row.counts?.removed ?? row.removed
    const counts = added === undefined && removed === undefined ? '' : `  +${String(added ?? 0)} −${String(removed ?? 0)}`
    return `${glyph[row.kind] ?? 'M'} ${row.path}${counts}`
  })
  if (rows.length > shown.length) lines.push(`…还有 ${String(rows.length - shown.length)} 个文件（完整清单见时间线面板）`)
  if (notes !== undefined && notes.length > 0) lines.push('', ...notes.map((note) => `注：${note}`))
  return [header, '', ...lines].join('\n')
}

async function runShadowUndoCommand(engine: ShadowRewindEngine, invocation: ShadowRewindCommandInvocation): Promise<ShadowRewindCommandResult> {
  const cwd = invocation.agent.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') {
    return { kind: 'error', text: '当前会话没有工作区，无从撤销。' }
  }
  try {
    const result = await engine.undoLastRestore({ cwd, signal: invocation.signal })
    // 撤销同样改写了磁盘：数据版本递增（与 restore-undo 端点同一标准）。
    await bumpWorkspaceRevision(cwd)
    const lines = [`已撤销最近一次恢复：${String(result.undonePaths.length)} 个路径回到恢复前状态（备份点 ${result.rescuePointId} 保留）。`]
    for (const path of result.undonePaths) lines.push(`已还原 ${path}`)
    for (const skip of result.skippedPaths) lines.push(`跳过 ${skip.path}：${skip.reason}`)
    return { kind: 'success', text: lines.join('\n') }
  } catch (error) {
    return { kind: 'error', text: errorMessage(error) }
  }
}
