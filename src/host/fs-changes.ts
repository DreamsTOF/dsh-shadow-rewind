/**
 * 宿主适配层·fs-changes 的服务端计算：行数统计 + 轮配对 diff + 窗口归属。
 *
 * 轮次配对与 live-tail 的两侧内容宿主本来就持有（检查点 blob / live 扫描读
 * 盘），在服务端把 added/removed 算好随响应下发——过去客户端为渲染 +/− 要
 * 把每个文件的新旧全文各拉一遍，一轮 30 个文件就是 60 个请求。
 *
 * 本文件的共享助手 {@link computeTurnFsChanges} 同时服务两个端点
 * （/shadow-rewind 预览与 /shadow-rewind/fs-changes），配对轮与 live-tail
 * 不再各持一份拷贝。
 */

import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { diffLines } from 'diff'
import { errorMessage } from '../errors.js'
import { isWithin } from '../path-utils.js'
import { attributePaths, serializeOwner } from '../attribution.js'
import type { ShadowRewindEngine } from '../engine.js'
import type { PathAttribution } from '../attribution.js'
import type { TurnIntent, WorkspaceChange } from '../types.js'
import type { RewindHttpDeps } from './types.js'

/** 行数统计的单侧字节上限：超出视为统计不可得（数量级保护，非语义边界）。 */
const DIFF_COUNT_MAX_BYTES = 2 * 1024 * 1024
/** 单次 fs-changes 请求的行数统计预算（按变更条数计）：超出后剩余变更不带行数。 */
export const DIFF_COUNT_BUDGET = 600

/** 往返校验解码：非 UTF-8 内容按「统计不可得」处理（返回 null），绝不猜着算。 */
export function decodeUtf8(bytes: Buffer): string | null {
  const text = bytes.toString('utf8')
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null
}

/** 有界并发执行：保持结果与 tasks 输入同序，任意失败照常上抛。 */
export async function runLimited<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    while (next < tasks.length) {
      const index = next
      next += 1
      const task = tasks[index]
      if (task !== undefined) results[index] = await task()
    }
  })
  await Promise.all(workers)
  return results
}

/** LF 计行：空串 0 行；最后一个换行后无内容不虚增一行。 */
export function countLines(text: string): number {
  if (text === '') return 0
  let count = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1
  return text.endsWith('\n') ? count : count + 1
}

/** 行数按 LF 规范化统计：CRLF 文件不会产生幽灵增删。 */
export function lineCounts(before: string, after: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const part of diffLines(before.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), after.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))) {
    if (part.added === true) added += part.count ?? 0
    else if (part.removed === true) removed += part.count ?? 0
  }
  return { added, removed }
}

/** 「读当前磁盘」的唯一实现（K8 归一：/file?checkpointId=live 与
 * readChangeSide 此前是两份围栏各异的拷贝）。返回 null = 不可得
 * （不在工作区内 / 软链接 / 缺失 / 读取失败），调用方按各自语义呈现。 */
export async function readLiveFile(cwd: string, path: string): Promise<Buffer | null> {
  const candidate = resolve(cwd, path)
  if (!isWithin(cwd, candidate)) return null
  try {
    const stat = await lstat(candidate)
    if (stat.isSymbolicLink() || !stat.isFile()) return null
    return await readFile(candidate)
  } catch {
    return null
  }
}

/** 读变更单侧内容：checkpointId 或 'live'（当前磁盘，围栏同 /file 端点）。 */
export async function readChangeSide(engine: ShadowRewindEngine, cwd: string, sourceId: string, path: string): Promise<Buffer | null> {
  if (sourceId === 'live') {
    return readLiveFile(cwd, path)
  }
  return engine.getFileContentFromCheckpoint({ cwd, checkpointId: sourceId, path })
}

/** 端点变更条目：path/kind + 服务端预算行数 + 检查点权限位 + 目录标记。
 * oldMode/newMode 供客户端透传给宿主撤销（写回时恢复权限位）；
 * dir 条目的撤销语义是 mkdir/rmdir，不产生行数。
 * owner 为检查点窗口网格归属（信息徽标，不影响任何默认行为）。 */
export interface FsChangeItem {
  path: string
  kind: 'added' | 'modified' | 'deleted'
  added?: number
  removed?: number
  oldMode?: number
  newMode?: number
  dir?: true
  /** serializeOwner 形态：'target' | 'multi' | 'unknown' | <sessionId>（信息徽标）。 */
  owner?: string
}

/** 一条变更两侧内容的行数差；内容缺失/超限/非 UTF-8/读取失败都返回 undefined
 * （调用方按「行数不可得」呈现，绝不猜）。两侧都在但内容相同 = 纯权限位变更，
 * 返回 {0,0}。 */
export async function countChangeLines(
  engine: ShadowRewindEngine,
  cwd: string,
  path: string,
  prevId: string,
  nextId: string,
): Promise<{ added: number; removed: number } | undefined> {
  try {
    const [before, after] = await Promise.all([
      readChangeSide(engine, cwd, prevId, path),
      readChangeSide(engine, cwd, nextId, path),
    ])
    if (before === null && after === null) return undefined
    if (before !== null && before.byteLength > DIFF_COUNT_MAX_BYTES) return undefined
    if (after !== null && after.byteLength > DIFF_COUNT_MAX_BYTES) return undefined
    const beforeText = before === null ? null : decodeUtf8(before)
    const afterText = after === null ? null : decodeUtf8(after)
    if (beforeText === null && before !== null) return undefined
    if (afterText === null && after !== null) return undefined
    if (beforeText === null) return { added: countLines(afterText ?? ''), removed: 0 }
    if (afterText === null) return { added: 0, removed: countLines(beforeText) }
    return lineCounts(beforeText, afterText)
  } catch {
    return undefined
  }
}

/** 为一条变更补行数与元数据；内容缺失/超限/非 UTF-8/预算耗尽都静默省略行数字段。
 * mode-changed（纯权限位变更）对外映射为 'modified'——内容两侧相同，行数自然为 0。 */
async function withLineCounts(
  engine: ShadowRewindEngine,
  cwd: string,
  change: WorkspaceChange,
  prevId: string,
  nextId: string,
  budget: { remaining: number },
): Promise<FsChangeItem> {
  const base: FsChangeItem = {
    path: change.path,
    // 调用方已过滤：进来的只有 added/modified/deleted/mode-changed。
    kind: (change.kind === 'mode-changed' ? 'modified' : change.kind) as FsChangeItem['kind'],
    ...(change.before !== undefined && change.before.kind !== 'dir' ? { oldMode: change.before.mode } : {}),
    ...(change.after !== undefined && change.after.kind !== 'dir' ? { newMode: change.after.mode } : {}),
    ...(change.before?.kind === 'dir' || change.after?.kind === 'dir' ? { dir: true as const } : {}),
  }
  if (base.dir === true || budget.remaining <= 0) return base
  budget.remaining -= 1
  const counts = await countChangeLines(engine, cwd, change.path, prevId, nextId)
  return counts === undefined ? base : { ...base, ...counts }
}

/** 一轮的文件系统变更条目（配对轮与 live-tail 同形）。 */
export interface TurnFsChange {
  readonly turn: number
  readonly turnStartSeq: number
  readonly checkpointId: string
  readonly nextCheckpointId: string
  readonly live?: true
  /** 本轮内容型工具调用摘要（轮末检查点的 intent；live 轮从会话事件即时采集）。 */
  readonly intent?: readonly TurnIntent[]
  /** 检查点快照内容抽样不可读（影子仓库丢失 / sqlite 受损等）：诚实标注。 */
  readonly degraded?: true
  readonly changes: readonly FsChangeItem[]
}

/**
 * 共享配对助手：一轮的「检查点 diff + 窗口归属 + 行数预算」。轮配对
 * （diffCheckpoints）与 live-tail（inspect = 最后检查点 vs 当前磁盘）共用，
 * 两端点（/shadow-rewind 预览与 /shadow-rewind/fs-changes）不再各持一份拷贝。
 *
 * 归属行为：窗口内快照做网格归属（attributePaths），owner 随条目透出，
 * 作为信息徽标。归属失败保守保留全部路径。
 *
 * 返回 undefined = 结构性跳过（无 sessionId / 无配对终点）或对比失败
 * （已记警告）；空 changes 数组原样返回，由调用方决定是否透出。
 */
export async function computeTurnFsChanges(
  engine: ShadowRewindEngine,
  deps: Pick<RewindHttpDeps, 'logger'>,
  options: {
    readonly cwd: string
    readonly current: {
      readonly id: string
      readonly sessionId?: string
      readonly createdAt: number
      readonly turn: number
      readonly turnStartSeq: number
    }
    /** 归属终点：优先同轮轮末检查点（精确轮末树），回退下一轮轮起（旧语义）。 */
    readonly pairEnd?: { readonly id: string; readonly createdAt: number }
    /** 本轮意图摘要（配对轮取轮末检查点 manifest；live 轮由调用方从会话事件采集）。 */
    readonly intent?: readonly TurnIntent[]
    /** live-tail：无配对终点，对比源是当前磁盘。 */
    readonly live?: boolean
    readonly countBudget: { remaining: number }
  },
): Promise<TurnFsChange | undefined> {
  const { cwd, current, countBudget } = options
  const live = options.live === true
  if (current.sessionId === undefined) return undefined
  if (!live && options.pairEnd === undefined) return undefined
  // live-tail 的配对终点是哨兵（'live', +∞）：快照剪枝与窗口查询天然
  // 延伸到当前磁盘，后续分支与配对轮同形。
  const pairEnd = options.pairEnd ?? { id: 'live', createdAt: Number.MAX_SAFE_INTEGER }
  try {
    const fsDiff = live
      ? await engine.inspect({ cwd, restorePointId: current.id })
      : await engine.diffCheckpoints({ cwd, prevCheckpointId: current.id, currCheckpointId: pairEnd.id })
    const raw = fsDiff.changes.filter((change) =>
      (change.kind === 'added' || change.kind === 'modified'
        || change.kind === 'deleted' || change.kind === 'mode-changed')
      // 空目录的纯权限位变化没有可撤销语义，直接省略。
      && !(change.kind === 'mode-changed' && change.before?.kind === 'dir'))
    if (raw.length === 0) {
      return finishTurnFsChange(current, live, pairEnd, [], options.intent)
    }
    // 窗口 (current, pairEnd] 落盘者未必是本会话（其它会话的检查点窗口会
    // 插进来）。用窗口内快照做网格归属——owner 只是信息徽标。
    let ownership = new Map<string, PathAttribution>()
    try {
      const attributed = await engine.listSnapshotsAfter({
        cwd,
        restorePointId: current.id,
        paths: raw.map((change) => change.path),
      })
      // 窗口内快照按终点时间剪枝（配对轮 = pairEnd.createdAt；live-tail 的
      // 哨兵终点 = +∞，等价全保留）。
      const within = attributed.snapshots.filter((snapshot) => snapshot.createdAt < pairEnd.createdAt)
      ownership = attributePaths({
        targetSessionId: attributed.targetSessionId,
        changes: raw,
        snapshots: within,
      })
    } catch (error) {
      deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn)} ${live ? 'live-tail ' : ''}归因失败，保留全部路径：${errorMessage(error)}`)
    }
    // 行数统计限并发 4（ABSORB-RECALL 六，recall runLimited 同款）：大轮次
    // 下预算内的全文读取全并发会挤爆 fd 与响应延迟；统计结果与执行顺序
    // 无关（预算原子性由闭包保证），限流只改吞吐时序不改结果。
    const changes = await runLimited(raw.map((change) => async () => {
      const item = await withLineCounts(engine, cwd, change, current.id, pairEnd.id, countBudget)
      const attr = ownership.get(change.path)
      return attr === undefined ? item : {
        ...item,
        owner: serializeOwner(attr.owner),
      }
    }), 4)
    return finishTurnFsChange(current, live, pairEnd, changes, options.intent)
  } catch (error) {
    // 单轮对比失败只跳过该轮；对比失败不影响整体响应。
    deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn)} ${live ? 'live ' : ''}文件系统差异计算失败：${errorMessage(error)}`)
    return undefined
  }
}

/** 组装 TurnFsChange 的出口形状（live/intent 按需带字段）。 */
function finishTurnFsChange(
  current: { readonly id: string; readonly turn: number; readonly turnStartSeq: number },
  live: boolean,
  pairEnd: { readonly id: string },
  changes: readonly FsChangeItem[],
  intent?: readonly TurnIntent[],
): TurnFsChange {
  return {
    turn: current.turn,
    turnStartSeq: current.turnStartSeq,
    checkpointId: current.id,
    nextCheckpointId: pairEnd.id,
    ...(live ? { live: true as const } : {}),
    ...(intent !== undefined && intent.length > 0 ? { intent } : {}),
    changes,
  }
}

/**
 * 一条「会话累计」变更：同一路径在会话多轮里的净变化 = diff(最早触碰该路径的
 * 轮起检查点, 最后一次触碰的轮末/下一轮起点)。live 条的会话累计视图消费这一份
 * ——行数/权限位/增删形态全部由服务端按检查点算出，客户端不再跨轮拼接近似。
 *
 * 单轮路径直接复用该轮的预算结果（零额外读取）；跨轮路径按最早/最后两侧重算
 * 一次净行数。`turnStartSeq` 是最早触碰轮的 turn/start seq（回滚遮蔽基准）。
 */
export interface CumulativeFsChange extends FsChangeItem {
  /** 最早触碰该路径的轮起检查点（diff 的 prev 侧）。 */
  readonly checkpointId: string
  /** 最后一次触碰的轮末检查点（或 'live' = 当前磁盘）。 */
  readonly nextCheckpointId: string
  /** 最早触碰轮的 turn/start seq（回滚遮蔽的判别基准）。 */
  readonly turnStartSeq: number
  /** 触碰过该路径的轮号（升序）。 */
  readonly turns: readonly number[]
}

/** 同路径累计的中间态：最早/最后一轮 + 合并后的归属与形态。 */
interface CumulativeAccumulator {
  first: TurnFsChange
  last: TurnFsChange
  firstItem: FsChangeItem
  owners: Set<string>
  dir: boolean
  oldMode?: number
  newMode?: number
}

/** 把逐轮变更合并成「每路径一行」的会话累计净变化（live 条的唯一数据源）。 */
export async function computeCumulativeFsChanges(
  engine: ShadowRewindEngine,
  options: {
    readonly cwd: string
    /** 逐轮变更（按轮升序；live 轮排最后）。 */
    readonly turns: readonly TurnFsChange[]
    readonly countBudget: { remaining: number }
  },
): Promise<readonly CumulativeFsChange[]> {
  const { cwd, turns, countBudget } = options
  const order: string[] = []
  const byPath = new Map<string, CumulativeAccumulator>()
  for (const turn of turns) {
    for (const item of turn.changes) {
      const existing = byPath.get(item.path)
      if (existing === undefined) {
        order.push(item.path)
        byPath.set(item.path, {
          first: turn,
          last: turn,
          firstItem: item,
          owners: new Set(item.owner === undefined ? [] : [item.owner]),
          dir: item.dir === true,
          ...(item.oldMode === undefined ? {} : { oldMode: item.oldMode }),
          ...(item.newMode === undefined ? {} : { newMode: item.newMode }),
        })
        continue
      }
      existing.last = turn
      if (item.owner !== undefined) existing.owners.add(item.owner)
      if (item.dir === true) existing.dir = true
      if (item.newMode !== undefined) existing.newMode = item.newMode
    }
  }
  const items: CumulativeFsChange[] = []
  for (const path of order) {
    const entry = byPath.get(path)
    if (entry === undefined) continue
    const { first, last, firstItem } = entry
    const owner = entry.owners.size === 0 ? undefined
      : entry.owners.size === 1 ? [...entry.owners][0]
        : 'multi'
    const base = {
      path,
      checkpointId: first.checkpointId,
      nextCheckpointId: last.nextCheckpointId,
      turnStartSeq: first.turnStartSeq,
      turns: turns.filter(turn => turn.changes.some(change => change.path === path)).map(turn => turn.turn),
      ...(owner === undefined ? {} : { owner }),
      ...(entry.dir ? { dir: true as const } : {}),
      ...(entry.oldMode === undefined ? {} : { oldMode: entry.oldMode }),
      ...(entry.newMode === undefined ? {} : { newMode: entry.newMode }),
    }
    if (entry.dir) {
      items.push({ ...base, kind: firstItem.kind })
      continue
    }
    if (first === last) {
      // 单轮路径：该轮的服务端预算结果就是净量，直接复用（零额外读取）。
      items.push({ ...base, ...firstItem })
      continue
    }
    if (countBudget.remaining <= 0) {
      items.push({ ...base, kind: firstItem.kind })
      continue
    }
    countBudget.remaining -= 1
    const counts = await countChangeLines(engine, cwd, path, first.checkpointId, last.nextCheckpointId)
    items.push(counts === undefined ? { ...base, kind: firstItem.kind } : { ...base, kind: firstItem.kind, ...counts })
  }
  return items
}

/** 并行只读探测检查点内容可读性；返回「不可读」的 id 集合（探测失败也算不可读）。 */
export async function probeUnreadableCheckpoints(engine: ShadowRewindEngine, cwd: string, ids: ReadonlySet<string>): Promise<Set<string>> {
  const unreadable = new Set<string>()
  await Promise.all([...ids].map(async (id) => {
    try {
      if (!(await engine.checkpointContentReadable({ cwd, restorePointId: id }))) unreadable.add(id)
    } catch {
      unreadable.add(id)
    }
  }))
  return unreadable
}
