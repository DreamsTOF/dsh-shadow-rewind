/**
 * 单轮作用域的产出文件定义与读取器。纯客户端、与模型无关：词汇来源是变更
 * 工具自己的**结果**，绝不是收尾文风。
 *
 * dsh 0.1.2 迁移：会话视图（callView / resultView 卡片）机制随 client
 * runtime 移除，ConversationMatch 不再携带 view。produced 路径与 hunks 改
 * 从会话事件直接派生——`tool/call` 的原始参数给出路径与「意图 hunk」，
 * `tool/result` 的 `meta.diffs`（dsh-tool-fs 的 presentationMeta）给出落地
 * 后的真实 hunks，两者的形状与本插件的 ProducedFileDiff 完全一致。
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ProducedFileDiff, ProducedFileReview } from '../file-review/change-types.ts'
import { deletedPathsFromCall } from './deleted-paths.ts'

export type { ProducedFileDiff, ProducedFileReview } from '../file-review/change-types.ts'

/** 同轮内的终端命令删掉了这个路径（仅展示，不能撤销）。 */
interface ProducedPath {
  readonly seq: number
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  readonly deleted?: true
}

/** 针对某一 Turn 发布的不可变产出文件事实。 */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** 这一 Turn 累积到的成功变更路径。 */
    deliverables: DeliverablesTurnData
  }
}

/** One `tool/call` 的派生意图：路径 + 意图 hunks + 终端删除路径。 */
interface CallIntent {
  readonly path: string | null
  /** 结果 meta 缺失时的回退 hunks（write/edit/str_replace_editor 的参数直译）。 */
  readonly intended: readonly ProducedFileDiff[]
  readonly deletions: readonly string[]
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, CallIntent | null>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pathValue(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function parseArgs(argsRaw: string): Record<string, unknown> | null {
  try {
    const args: unknown = JSON.parse(argsRaw)
    return isRecord(args) ? args : null
  } catch {
    return null
  }
}

/**
 * 从一次受支持的一方变更调用里抽出变更路径与意图 hunks。会话 `tool/call`
 * 事件都是根调用；Code Dispatch 的子调用不会独立进入这个 Definition。
 */
function mutationIntent(name: string, argsRaw: string): CallIntent | null {
  const args = parseArgs(argsRaw)
  if (args === null) return null
  switch (name) {
    case 'write': {
      const path = pathValue(args.file_path)
      const content = args.content
      if (path === null || typeof content !== 'string') return null
      return { path, intended: [{ path, oldText: null, newText: content }], deletions: [] }
    }
    case 'edit': {
      const path = pathValue(args.file_path)
      const { old_string: oldString, new_string: newString } = args
      if (path === null || typeof oldString !== 'string' || typeof newString !== 'string'
        || oldString === '' || oldString === newString) {
        return null
      }
      return { path, intended: [{ path, oldText: oldString, newText: newString }], deletions: [] }
    }
    case 'str_replace_editor': {
      const path = pathValue(args.path)
      if (path === null) return null
      if (args.command === 'create' && typeof args.file_text === 'string') {
        return { path, intended: [{ path, oldText: null, newText: args.file_text }], deletions: [] }
      }
      if (args.command === 'str_replace'
        && typeof args.old_str === 'string' && typeof args.new_str === 'string'
        && args.old_str !== '') {
        return {
          path,
          intended: [{ path, oldText: args.old_str, newText: args.new_str }],
          deletions: [],
        }
      }
      return { path, intended: [], deletions: [] }
    }
    default:
      // 终端工具：rm 族参数的字面删除路径（display-only，无 hunks）。
      return { path: null, intended: [], deletions: deletedPathsFromCall(name, argsRaw) }
  }
}

/** 校验跨宿主/浏览器传输的 diff hunks（未知即拒绝，绝不猜）。 */
function producedDiffs(meta: unknown): readonly ProducedFileDiff[] {
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
 * 某个收尾 Assistant 边界处可见的文件与审查 hunks。
 * @param data - 引擎为某一 Turn 发布的 Deliverables 数据。
 * @param seq - 收尾的 Assistant seq；在此之后的工具结算一律排除。
 * @returns 产出文件按首次出现顺序，同路径 hunks 按结算顺序追加。
 */
export function reviewsForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly ProducedFileReview[] {
  if (data === undefined) return []
  const reviews: Array<{ path: string; diffs: ProducedFileDiff[]; deleted?: true }> = []
  const byPath = new Map<string, { path: string; diffs: ProducedFileDiff[]; deleted?: true }>()
  for (const produced of data.produced) {
    if (produced.seq > seq) continue
    const review = byPath.get(produced.path)
    if (review === undefined) {
      const created = {
        path: produced.path,
        diffs: [...produced.diffs],
        ...(produced.deleted === true ? { deleted: true as const } : {}),
      }
      byPath.set(produced.path, created)
      reviews.push(created)
    } else {
      review.diffs.push(...produced.diffs)
      // 以最后一个状态为准：删除把条目标成 deleted，之后同轮内又被写回
      // （文件被重建）则清掉该标记。
      if (produced.deleted === true) review.deleted = true
      else delete review.deleted
    }
  }
  return reviews
}

/**
 * 某个 Turn 数据值产出过的文件。
 *
 * 来源是变更工具自己的结果，不是收尾文风：无论模型有没有记得点名，产出过的
 * 文件都必须列出。变更靠工具名识别——`write` / `edit` / `str_replace_editor`
 * ——新变更工具只要声明自己的参数就能加入。读操作不产出任何东西（看看文件
 * 不算产出），删除与失败调用同样不算（删了就没东西可开了）。路径保持首次
 * 出现顺序且只出现一次，于是「同轮先写后改」的文件是单一条目。
 *
 * Turn 归属在函数运行前已由 Conversation Location 索引裁定，因此路径不会
 * 跨轮泄漏，这个推导也不必从相邻的展示节点反推边界。
 * @param data - 引擎为某一 Turn 发布的 Deliverables 数据。
 * @param seq - 收尾的 Assistant seq；在此之后的工具结算一律排除。
 * @returns 产出路径按首次出现顺序；这一轮什么都没写时返回空。
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  const lastDeleted = new Map<string, boolean>()
  for (const produced of data.produced) {
    if (produced.seq > seq) continue
    lastDeleted.set(produced.path, produced.deleted === true)
    if (seen.has(produced.path)) continue
    seen.add(produced.path)
    paths.push(produced.path)
  }
  // 删除路径没有可打开的文件：即使同轮早些时候的 write 记过它，也不进提及
  // 词汇。
  return paths.filter(path => lastDeleted.get(path) !== true)
}

/**
 * 只有收尾轮真的产出过文件时才认领轮尾链。
 * @param owner - 收尾 assistant 的轮尾 owner 货币。
 * @returns 作为组件 match 的产出文件审查，或 null 表示在挂载前放弃认领。
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly ProducedFileReview[] | null {
  const reviews = reviewsForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return reviews.length === 0 ? null : reviews
}

/** Turn 局部的成功变更累积器；它不发布任何视图节点。 */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    const turn = match.event.data.turn
    return { turn: typeof turn === 'number' ? turn : 0, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const intent = mutationIntent(match.event.data.name, match.event.data.arguments)
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), intent)
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const intent = context.state.calls.get(callId)
    if (intent === undefined || intent === null) return context.state
    // 落地 hunks 优先（meta.diffs = 工具执行时的真实前后文），意图 hunks 兜底
    // （旧日志/无 meta 工具）；两者都没有但有删除路径时只记 deleted 条目。
    const applied = producedDiffs(match.event.data.meta)
    const diffs = applied.length > 0 ? applied : intent.intended
    const seq = match.event.seq
    const additions: ProducedPath[] = []
    if (intent.path !== null) {
      additions.push({
        seq,
        path: intent.path,
        diffs: diffs.filter(diff => diff.path === intent.path),
      })
    }
    // dsh 只通过终端删文件；一次成功终端调用里字面 rm 系列参数就是唯一的
    // 删除记录（dsh 没有「删除文件」工具）。它们与带 hunks 的路径进入同一套
    // produced 词汇：无 diffs，永不撤销。
    for (const path of intent.deletions) {
      if (additions.some(addition => addition.path === path)) continue
      additions.push({ seq, path, diffs: [], deleted: true })
    }
    return additions.length === 0
      ? context.state
      : { ...context.state, produced: [...context.state.produced, ...additions] }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn'
      && previous.turn === context.state.turn
      && previous.key === 'deliverables'
      && previous.value.produced === context.state.produced) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: { produced: context.state.produced },
    }
  },
}

/**
 * 路径末段——一眼就能认出文件的那一部分。
 * @param path - 用斜杠或反斜杠分隔的路径。
 * @returns 末段；没有分隔符时返回整串。
 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/**
 * 一轮产出路径之上的「文件提及」词汇，供收尾消息的行文使用：行内代码 token
 * 会打开它点名的文件。token 先按完整路径精确解析，再退而求其次——恰好等于
 * **唯一一个**产出路径的 basename。两个路径共用的 basename 保持惰性、绝不
 * 猜，于是提及链接永远不会打开错误的文件或 404。
 * @param paths - 本轮产出路径（工具顺序，已去重）。
 * @param openFile - 聊天视图的文件 opener。
 * @param label - 为已解析路径本地化可访问的打开标签。
 * @returns MarkdownText 消费的 resolver；完整路径乘在 `title` 上，与文件行
 * 上的 chip 用同一消歧标识。
 */
export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

/** basename 恰好等于 `value` 的产出路径；多于一个或没有都返回 undefined。 */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}
