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
import type { ProducedFileDiff, ProducedFileReview, RecordedMutation } from '../file-review/change-types.ts'
import { coalesceCreatedFileDiffs, diffsFromBeforeAfter } from './recorded-diffs.ts'
import { isToolEntryRewound, type RewoundMark } from './rewound-changes.ts'

/** 窗口归属字段（检查点网格推导，勾选清单的建议标签）：
 * 'target' = 本会话，'multi' = 多会话，'unknown' = 不可知，其它 = 会话 id。 */
export interface FsAttributionFields {
  readonly owner?: string
  /** 归属本会话 → true（默认勾选）；其它/歧义 → false（须显式勾选）。 */
  readonly autoSelect?: boolean
}

/** 一轮里被改过的一个文件，hunks 按结算顺序追加。 */
export interface SessionFileChange extends FsAttributionFields {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  /** fs 删除条目（检查点对比 kind='deleted'）：展示为全红，撤销=写回旧内容。 */
  readonly deleted?: true
  /** 条目来源：'fs' = 检查点对比派生（终端写盘）；缺省 = 工具结果视图。 */
  readonly origin?: 'fs'
  /** 空目录条目（撤销语义是 mkdir/rmdir，不涉内容）。 */
  readonly dir?: true
  /** 服务端预算的行数（fs 条目懒加载全文前的显示用；缺省按 diffs 汇总）。 */
  readonly counts?: { readonly added: number; readonly removed: number }
  /** 条目内最后一个工具结果节点的事件 seq（回滚遮蔽的判别基准；录制条目缺省）。 */
  readonly lastSeq?: number
}

/** 一轮的产出文件，按首次出现顺序。 */
export interface TurnFileChanges {
  readonly turn: number
  /** 所属轮是否仍在运行（它的变更集还可能增长）。 */
  readonly live: boolean
  readonly files: readonly SessionFileChange[]
}

/** 内部按路径累积器：展示路径（首次出现形态）+ hunk 列表 + 最新事件 seq。 */
interface FileAccumulator {
  path: string
  diffs: ProducedFileDiff[]
  /** 条目内最新工具结果节点 seq；录制合入的纯录制条目缺省（不参与回滚遮蔽）。 */
  lastSeq?: number
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
    if (paths.length === 0) continue
    const diffs = reviewDiffs(node)
    const { turn, live } = attribute(node.seq)
    let group = byTurn.get(turn)
    if (group === undefined) {
      group = { live, files: new Map() }
      byTurn.set(turn, group)
    }
    for (const path of paths) {
      const own = diffs.filter(diff => pathKey(diff.path) === pathKey(path))
      const key = pathKey(path)
      const existing = group.files.get(key)
      if (existing === undefined) group.files.set(key, { path, diffs: [...own], lastSeq: node.seq })
      else {
        existing.diffs.push(...own)
        existing.lastSeq = Math.max(existing.lastSeq ?? node.seq, node.seq)
      }
    }
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => ({
      turn,
      live: group.live,
      // 「新建后同轮又修改」收敛成单条 added（净内容），与轮尾卡片同语义。
      files: [...group.files.values()].map(own => ({
        path: own.path,
        diffs: coalesceCreatedFileDiffs(own.diffs),
        lastSeq: own.lastSeq,
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
      files.set(pathKey(file.path), {
        path: file.path,
        diffs: [...file.diffs],
        // 录制合并不改既有条目的 seq 基准；录制条目自身无 seq（回滚遮蔽
        // 按已有 lastSeq 缺省放行——录制变更的遮蔽精度见 rewound-changes 的 TODO）。
        ...(file.lastSeq !== undefined ? { lastSeq: file.lastSeq } : {}),
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
      const key = pathKey(mutation.path)
      const existing = group.files.get(key)
      if (existing === undefined) group.files.set(key, { path: mutation.path, diffs: [...diffs] })
      else existing.diffs.push(...diffs)
    }
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => ({
      turn,
      live: group.live,
      files: [...group.files.values()].map(own => ({
        path: own.path,
        diffs: coalesceCreatedFileDiffs(own.diffs),
        ...(own.lastSeq !== undefined ? { lastSeq: own.lastSeq } : {}),
      })),
    }))
}

/**
 * 回滚遮蔽过滤：把「磁盘上已不存在」的条目从轮列表里扣掉（live 条的会话
 * 累计视图与徽标共用）。规则见 rewound-changes.ts——条目 lastSeq ≤ 标记
 * 屏障且路径被恢复即遮蔽；没有 lastSeq 的条目（纯录制合入）一律放行。
 */
export function filterRewoundTurns(
  turns: readonly TurnFileChanges[],
  marks: readonly RewoundMark[],
): readonly TurnFileChanges[] {
  if (marks.length === 0) return turns
  const result: TurnFileChanges[] = []
  for (const turn of turns) {
    const files = turn.files.filter(file =>
      file.lastSeq === undefined
      || !isToolEntryRewound(marks, pathKey(file.path), file.lastSeq))
    if (files.length > 0) result.push({ ...turn, files })
  }
  return result
}

/** 统计跨所有轮的被改路径去重数（侧边栏徽标就是这个数）。 */
export function countChangedFiles(turns: readonly TurnFileChanges[]): number {
  const paths = new Set<string>()
  for (const turn of turns) {
    for (const file of turn.files) paths.add(pathKey(file.path))
  }
  return paths.size
}

/**
 * 单一「可撤销」判定（H1 归一）：轮尾卡片与侧栏 tab 共用同一份条件集，
 * 不再各自维护——mode-only fs 条目、fs 整文件形状（added/deleted）、目录
 * 条目、完整可回放的 hunk 序列，四种可逆形态只在这里写一遍。
 */
export function reversibleOf(file: {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  readonly origin?: 'fs'
  readonly dir?: boolean
}): boolean {
  // 目录条目天生可逆（mkdir/rmdir 互逆），占位形态即可判定。
  if (file.dir === true) return true
  // mode-only fs 条目：内容两侧相同、权限位不同——开关动作是一次裸 chmod。
  if (file.origin === 'fs' && file.diffs.length === 1) {
    const only = file.diffs[0]
    if (only !== undefined && only.path === file.path
      && only.oldText !== null && only.oldText === only.newText
      && only.oldMode !== undefined && only.newMode !== undefined
      && only.oldMode !== only.newMode) {
      return true
    }
  }
  // fs 整文件形状：单条 diff，要么新增（无旧侧），要么删除（新侧为空）。
  if (file.diffs.length === 1) {
    const only = file.diffs[0]
    if (only !== undefined && only.path === file.path
      && (only.oldText === null || (only.newText === '' && only.oldText !== ''))) {
      return true
    }
  }
  // 通用：hunks 完整可逆（宿主按行锚点回放）。
  return file.diffs.length > 0 && file.diffs.every(diff =>
    diff.path === file.path
    && diff.oldText !== null
    && diff.oldText !== diff.newText
    && (diff.oldText !== '' || diff.oldStart !== undefined)
    && (diff.newText !== '' || diff.newStart !== undefined))
}

/** 路径末段——一眼就能认出文件的那一部分。 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * J4：列表层路径比较键——反斜杠统一成正斜杠。工具参数可能是 Windows
 * 反斜杠相对路径，fs 条目恒为正斜杠（服务端 path-utils 语义）；裸 ===
 * 会把同一文件劈成两行、+/− 统计减半。大小写不折叠：POSIX 区分大小写，
 * 误并两个文件比漏并一个更危险。
 */
export function pathKey(path: string): string {
  return path.replace(/\\/g, '/')
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

/**
 * 合并工具侧条目与检查点 fs 条目为「每路径一行」，轮尾卡片与 live 条共用。
 *
 * 路径键用 pathKey 归一（J4：Windows 反斜杠与 fs 正斜杠是同一文件）。工具
 * 条目优先——它带着精确 hunk，也是「回滚本轮 AI 更改」的范围来源；仅当工具
 * 条目不可逆（典型：本轮新建 write(oldText=null) 后同轮又被 edit 修改，混合
 * hunk 宿主无法回放、+/− 也虚增成 +6 −3）而存在检查点 fs 条目时，改用 fs
 * 净条目：它的计数是「本轮相对轮起的净变化」（新建 = 最终行数而非 hunk 累加），
 * 撤销语义也正确（新建撤销 = 删除文件）。
 */
export function mergeToolFsEntries(
  tool: readonly ProducedFileReview[],
  fs: readonly ProducedFileReview[],
): readonly ProducedFileReview[] {
  if (fs.length === 0) return tool
  const byKey = new Map<string, ProducedFileReview>()
  for (const entry of tool) {
    const key = pathKey(entry.path)
    if (!byKey.has(key)) byKey.set(key, entry)
  }
  for (const entry of fs) {
    const key = pathKey(entry.path)
    const existing = byKey.get(key)
    if (existing === undefined) { byKey.set(key, entry); continue }
    if (!reversibleOf(existing)) byKey.set(key, entry)
  }
  return [...byKey.values()]
}
