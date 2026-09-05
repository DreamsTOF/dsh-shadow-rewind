/**
 * 会话级的产出文件推导：从一个已定稿的 Chat 快照里算出每一轮改了什么。
 *
 * 纯客户端、与模型无关：词汇来源是变更工具自己的**结果**，绝不是收尾文风
 * 的文本。这是 turn-deliverables.ts 的侧边栏版本——那边用
 * ConversationNodeDefinition 为轮尾槽累加单轮数据，这里则是从会话快照的
 * 已定稿节点推导出**窗口内每一轮**的变更，并借 `turnEnds`（已完结轮）或
 * live 轮计数器把每个工具结果归到它所属的轮。
 *
 * dsh 0.1.2 迁移：快照换成 ChatSnapshot（Chat 目标的视图快照），节点数据从
 * `legacy` 兼容切片读取；工具路径与 hunks 来自节点的 `call`（原始参数）与
 * `meta`（dsh-tool-fs 落地的 presentationMeta.diffs）。
 */
import type { ChatSnapshot, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ProducedFileDiff, RecordedMutation } from '../file-review/change-types.ts'
import { deletedPathsFromCall } from './deleted-paths.ts'
import { diffsFromBeforeAfter } from './recorded-diffs.ts'

/** 写盘归因关联到的命令执行窗口（闸关归因命令级时附带）。 */
export interface FsCommandRef {
  readonly tool: string
  readonly callId?: string
  readonly sessionId: string
  readonly startedAt: number
  readonly endedAt: number
}

/** 写盘归因字段（仅闸关时宿主提供；开闸/旧宿主全部缺省）：
 * 'target' = 本会话，'multi' = 多会话，'unknown' = 不可知，其它 = 会话 id。 */
export interface FsAttributionFields {
  readonly owner?: string
  /** 归属本会话 → true（默认勾选）；其它/歧义 → false（须显式勾选）。 */
  readonly autoSelect?: boolean
  /** 归因置信层级：命令级 / 歧义 / 外部写入 / 窗口级 / 不可知。 */
  readonly attribution?: 'command' | 'ambiguous' | 'external' | 'window' | 'unknown'
  /** 归因到的命令执行窗口（仅 attribution === 'command' 时附带）。 */
  readonly command?: FsCommandRef
  /** 当前内容的写入时间（快照 mtime，ms epoch；旧清单无此字段则缺省）。 */
  readonly writtenAt?: number
}

/** 一轮里被改过的一个文件，hunks 按结算顺序追加。 */
export interface SessionFileChange extends FsAttributionFields {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  /** 本轮的终端命令删掉了这个路径（仅展示用，不能撤销）。 */
  readonly deleted?: true
  /** 条目来源：'fs' = 检查点对比派生（终端写盘）；缺省 = 工具结果视图。 */
  readonly origin?: 'fs'
  /** 空目录条目（撤销语义是 mkdir/rmdir，不涉内容）。 */
  readonly dir?: true
  /** 服务端预算的行数（fs 条目懒加载全文前的显示用；缺省按 diffs 汇总）。 */
  readonly counts?: { readonly added: number; readonly removed: number }
}

/** 一轮的产出文件，按首次出现顺序。 */
export interface TurnFileChanges {
  readonly turn: number
  /** 所属轮是否仍在运行（它的变更集还可能增长）。 */
  readonly live: boolean
  readonly files: readonly SessionFileChange[]
}

/** 内部按路径累积器：hunk 列表 + 最后一次删除状态。 */
interface FileAccumulator {
  diffs: ProducedFileDiff[]
  deleted?: true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseArgs(argsRaw: string): Record<string, unknown> | null {
  try {
    const args: unknown = JSON.parse(argsRaw)
    return isRecord(args) ? args : null
  } catch {
    return null
  }
}

function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** 校验跨宿主/浏览器传输进来的 diff hunks（未知即拒绝，绝不猜）。 */
export function producedDiffs(meta: unknown): readonly ProducedFileDiff[] {
  if (!isRecord(meta) || !Array.isArray(meta.diffs)) return []
  const diffs: ProducedFileDiff[] = []
  for (const value of meta.diffs) {
    if (!isRecord(value)) return rejectDiffs(meta.diffs.length)
    const { path, oldText, newText, oldStart, newStart } = value
    if (typeof path !== 'string'
      || (oldText !== null && typeof oldText !== 'string')
      || typeof newText !== 'string'
      || (oldStart !== undefined
        && (typeof oldStart !== 'number' || !Number.isInteger(oldStart) || oldStart < 1))
      || (newStart !== undefined
        && (typeof newStart !== 'number' || !Number.isInteger(newStart) || newStart < 1))) {
      return rejectDiffs(meta.diffs.length)
    }
    diffs.push({
      path,
      oldText,
      newText,
      ...(typeof oldStart === 'number' ? { oldStart } : {}),
      ...(typeof newStart === 'number' ? { newStart } : {}),
    })
  }
  return diffs
}

/** 一条 hunk 形状不完整就整组丢弃是刻意设计（宿主撤销要求全量可逆）；
 * 但静默丢弃曾让「文件在列、撤销永久禁用」无从排查——至少留痕。 */
function rejectDiffs(total: number): readonly ProducedFileDiff[] {
  console.warn(`[dsh-shadow-rewind] diff 视图中存在不可解析的 hunk，整组丢弃（共 ${String(total)} 条）`)
  return []
}

/**
 * 一个根变更调用的产出路径（按渲染意图，即工具名：`write` / `edit` /
 * `str_replace_editor`）。其余工具一律没有产出——读就是看了看，终端就是跑了
 * 一跑。
 */
function producedPathsOfCall(name: string, argsRaw: string): readonly string[] {
  const args = parseArgs(argsRaw)
  if (args === null) return []
  switch (name) {
    case 'write':
    case 'edit':
      return pathValue(args.file_path) !== null ? [args.file_path as string] : []
    case 'str_replace_editor':
      return pathValue(args.path) !== null ? [args.path as string] : []
    default:
      return []
  }
}

/** 优先取落地结果 hunks；结果没带 meta 时退回调用意图直译的 hunks。 */
function reviewDiffs(node: ToolResultNode): readonly ProducedFileDiff[] {
  // 与 turn-deliverables 同一规则：落地 meta.diffs 优先，拿不到可用 hunks
  // 时回退 call 参数直译的意图 hunks——只认 meta 会让 hunks 静默丢失。
  const fromMeta = producedDiffs(node.meta)
  if (fromMeta.length > 0) return fromMeta
  const call = node.call
  if (call === null) return []
  const args = parseArgs(call.argsRaw)
  if (args === null) return []
  switch (call.name) {
    case 'write': {
      const path = pathValue(args.file_path)
      const content = args.content
      return path === null || typeof content !== 'string'
        ? []
        : [{ path, oldText: null, newText: content }]
    }
    case 'edit': {
      const path = pathValue(args.file_path)
      const { old_string: oldString, new_string: newString } = args
      return path === null || typeof oldString !== 'string' || typeof newString !== 'string'
        || oldString === '' || oldString === newString
        ? []
        : [{ path, oldText: oldString, newText: newString }]
    }
    case 'str_replace_editor': {
      const path = pathValue(args.path)
      if (path === null) return []
      if (args.command === 'create' && typeof args.file_text === 'string') {
        return [{ path, oldText: null, newText: args.file_text }]
      }
      if (args.command === 'str_replace'
        && typeof args.old_str === 'string' && typeof args.new_str === 'string'
        && args.old_str !== '') {
        return [{ path, oldText: args.old_str, newText: args.new_str }]
      }
      return []
    }
    default:
      return []
  }
}

/**
 * 把一个事件 seq 归属到它所属的轮。已完结轮占有直到自己 `turn/end` seq 的
 * seq 区间；超出最后一个已完结 end 的统统属于 live 轮——即进行中的
 * `partial` / running 调用所在轮，或当没有任何 live 信号可观察时的「下一轮」。
 */
function turnAttribution(legacy: ChatSnapshot['legacy']): (seq: number) => { turn: number; live: boolean } {
  const ends = [...legacy.turnEnds.entries()].sort((a, b) => a[1] - b[1])
  const liveTurn = legacy.partial?.turn
    ?? legacy.runningCalls[0]?.turn
    ?? ((ends.at(-1)?.[0] ?? 0) + 1)
  return (seq: number) => {
    for (const [turn, endSeq] of ends) {
      if (endSeq >= seq) return { turn, live: false }
    }
    return { turn: liveTurn, live: true }
  }
}

/** 推导一个会话的逐轮产出文件变更（无缓存的实现核心）。 */
function derive(snapshot: ChatSnapshot): TurnFileChanges[] {
  const legacy = snapshot.legacy
  const attribute = turnAttribution(legacy)
  const byTurn = new Map<number, { live: boolean; files: Map<string, FileAccumulator> }>()
  for (const node of legacy.nodes) {
    if (node.kind !== 'tool-result' || node.isError) continue
    // 只有根调用进入推导：Code Mode 的子调用走宿主录制器的 recorded-mutation
    // 合并（它们没有自己的调用参数视图）。
    if (node.parentCallId !== undefined) continue
    const call = node.call
    if (call === null) continue
    const paths = producedPathsOfCall(call.name, call.argsRaw)
    // dsh 没有「删除文件」工具：删除发生在终端里，一次成功终端调用的字面
    // rm 系列参数就是它唯一的记录。它们以「无 hunk、不可撤销」的条目呈现。
    const deletions = paths.length === 0 ? deletedPathsFromCall(call.name, call.argsRaw) : []
    if (paths.length === 0 && deletions.length === 0) continue
    const diffs = reviewDiffs(node)
    const { turn, live } = attribute(node.seq)
    let group = byTurn.get(turn)
    if (group === undefined) {
      group = { live, files: new Map() }
      byTurn.set(turn, group)
    }
    for (const path of paths) {
      const own = diffs.filter(diff => diff.path === path)
      const existing = group.files.get(path)
      if (existing === undefined) group.files.set(path, { diffs: [...own] })
      else {
        existing.diffs.push(...own)
        delete existing.deleted
      }
    }
    for (const path of deletions) {
      const existing = group.files.get(path)
      if (existing === undefined) group.files.set(path, { diffs: [], deleted: true })
      else existing.deleted = true
    }
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => ({
      turn,
      live: group.live,
      files: [...group.files.entries()].map(([path, own]) => ({
        path,
        diffs: own.diffs,
        ...(own.deleted === true ? { deleted: true as const } : {}),
      })),
    }))
}

/**
 * 快照同一性缓存：侧边栏徽标在每次 tab-bar 渲染都会跑这个推导，结果因此按
 * 不可变快照引用记忆化（会话只在内容真正变化时才发布新引用，WeakMap 键正好
 * 适配——快照不再被引用时条目随之可回收）。
 */
const cache = new WeakMap<ChatSnapshot, TurnFileChanges[]>()

/** 对某个会话快照推导逐轮产出文件变更（带缓存入口）。 */
export function deriveSessionChanges(snapshot: ChatSnapshot | null | undefined): TurnFileChanges[] {
  if (snapshot === null || snapshot === undefined) return []
  const hit = cache.get(snapshot)
  if (hit !== undefined) return hit
  const derived = derive(snapshot)
  cache.set(snapshot, derived)
  return derived
}

/**
 * 快照里可见的一个 Code Mode（`run_code`）根调用，连同它结算进的那一轮。
 * 子调用（`subCalls`）没有可复用的视图，它们的审查数据以异步方式从宿主
 * 录制器补充回来；这些根调用就是联接键——`run_code` 的 `callId` 正是派发的
 * `rootCallId`。
 */
export interface SessionRoot {
  readonly turn: number
  readonly live: boolean
  readonly rootCallId: string
}

/** 窗口内的全部 `run_code` 工具结果节点，按节点顺序。 */
export function deriveSessionRoots(snapshot: ChatSnapshot): SessionRoot[] {
  const legacy = snapshot.legacy
  const attribute = turnAttribution(legacy)
  const roots: SessionRoot[] = []
  for (const node of legacy.nodes) {
    if (node.kind !== 'tool-result' || node.isError) continue
    if (node.subCalls.length === 0) continue
    const { turn, live } = attribute(node.seq)
    roots.push({ turn, live, rootCallId: node.callId })
  }
  return roots
}

/**
 * 把宿主录制到的 Code Mode 变更合并进快照推导出的各轮：由完整 before / after
 * 重建的 hunks 追加到所属轮的文件组里（同路径条目保持一行，hunks 按派发顺序
 * 追加），于是 tab 的 diff 渲染、状态巡检与撤销对程序化改动与模型直发完全
 * 同路。所有入参都不可变；只有某条录制变更匹配上了可见根调用时，结果才是
 * 新数组（否则原样返回，避免无谓重渲染）。
 */
export function mergeRecordedTurns(
  turns: readonly TurnFileChanges[],
  roots: readonly SessionRoot[],
  recorded: readonly RecordedMutation[],
): readonly TurnFileChanges[] {
  if (recorded.length === 0 || roots.length === 0) return turns
  const rootTurns = new Map<string, { turn: number; live: boolean }>()
  for (const root of roots) rootTurns.set(root.rootCallId, { turn: root.turn, live: root.live })
  const byRoot = new Map<string, RecordedMutation[]>()
  for (const mutation of recorded) {
    const list = byRoot.get(mutation.rootCallId)
    if (list === undefined) byRoot.set(mutation.rootCallId, [mutation])
    else list.push(mutation)
  }
  let matched = false
  for (const root of roots) {
    if (byRoot.has(root.rootCallId)) { matched = true; break }
  }
  if (!matched) return turns

  const groups = new Map<number, { live: boolean; files: Map<string, FileAccumulator> }>()
  for (const turn of turns) {
    const files = new Map<string, FileAccumulator>()
    for (const file of turn.files) {
      files.set(file.path, {
        diffs: [...file.diffs],
        ...(file.deleted === true ? { deleted: true as const } : {}),
      })
    }
    groups.set(turn.turn, { live: turn.live, files })
  }
  for (const [rootCallId, mutations] of byRoot) {
    const owner = rootTurns.get(rootCallId)
    if (owner === undefined) continue
    let group = groups.get(owner.turn)
    if (group === undefined) {
      group = { live: owner.live, files: new Map() }
      groups.set(owner.turn, group)
    }
    for (const mutation of mutations) {
      const diffs = diffsFromBeforeAfter(mutation.path, mutation.before, mutation.after)
      if (diffs.length === 0) continue
      const existing = group.files.get(mutation.path)
      if (existing === undefined) group.files.set(mutation.path, { diffs: [...diffs] })
      else existing.diffs.push(...diffs)
    }
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => ({
      turn,
      live: group.live,
      files: [...group.files.entries()].map(([path, own]) => ({
        path,
        diffs: own.diffs,
        ...(own.deleted === true ? { deleted: true as const } : {}),
      })),
    }))
}

/** 统计跨所有轮的被改路径去重数（侧边栏徽标就是这个数）。 */
export function countChangedFiles(turns: readonly TurnFileChanges[]): number {
  const paths = new Set<string>()
  for (const turn of turns) {
    for (const file of turn.files) paths.add(file.path)
  }
  return paths.size
}

/** 路径末段——一眼就能认出文件的那一部分。 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** 绝对路径判定：POSIX 根、盘符根或 UNC 前缀，分隔符无关。 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

/** 把（可能相对的）工具路径按会话工作区目录解析成展示路径。 */
export function resolveSessionPath(cwd: string | undefined, path: string): string {
  if (isAbsolutePath(path)) return path
  const base = cwd ?? ''
  if (base === '') return path
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${path}`
}
