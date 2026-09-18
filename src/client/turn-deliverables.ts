/**
 * 单轮作用域的**文件提及词汇**（纯客户端、与模型无关）：最终回复里的行内
 * 代码 token 要打开它点名的文件，token 解析需要「这一轮的工具碰过哪些路径」。
 *
 * 这只是链接解析词汇，**不是变更清单**：变更清单/行数/diff/撤销的唯一事实
 * 来源是宿主的检查点 diff（fs-changes / 预览端点）。这里刻意只保留路径与
 * 事件 seq——工具名白名单（write/edit/str_replace_editor）与结果节点的 seq
 * 用来把路径归到「收尾轮」。
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import { pathKey } from './path-keys.ts'
// 保留历史导出面（live 条等仍从本模块取 basename）。
export { basename } from './path-keys.ts'

/** 同轮内产出过的一个路径（按首次出现）。 */
interface ProducedPath {
  readonly seq: number
  readonly path: string
}

/** 针对某一 Turn 发布的不可变产出文件事实（仅路径，供提及解析）。 */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** 这一 Turn 累积到的成功变更路径。 */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, string | null>
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

/** 一次受支持的一方变更调用的目标路径（工具名白名单）。 */
function mutationPath(name: string, argsRaw: string): string | null {
  const args = parseArgs(argsRaw)
  if (args === null) return null
  switch (name) {
    case 'write':
    case 'edit':
      return pathValue(args.file_path)
    case 'str_replace_editor':
      return pathValue(args.path)
    default:
      return null
  }
}

/**
 * 某个 Turn 数据值产出过的文件路径（首次出现顺序、去重）。
 *
 * 来源是变更工具自己的结果，不是收尾文风：无论模型有没有记得点名，产出过的
 * 文件都必须可被提及解析。读操作不产出任何东西，删除与失败调用同样不算。
 * @param data - 引擎为某一 Turn 发布的 Deliverables 数据。
 * @param seq - 收尾的 Assistant seq；在此之后的工具结算一律排除。
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  if (data === undefined) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const produced of data.produced) {
    if (produced.seq > seq) continue
    const key = pathKey(produced.path)
    if (seen.has(key)) continue
    seen.add(key)
    paths.push(produced.path)
  }
  return paths
}

/**
 * 只有收尾轮真的产出过文件时才认领轮尾链。
 * @param owner - 收尾 assistant 的轮尾 owner 货币。
 * @returns 产出路径；无产出返回 null 表示在挂载前放弃认领。
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return paths.length === 0 ? null : paths
}

/** Turn 局部的成功变更路径累积器；它不发布任何视图节点。 */
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
      const path = mutationPath(match.event.data.name, match.event.data.arguments)
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), path)
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const callId = String(match.event.data.message.source.callId)
    const path = context.state.calls.get(callId)
    if (path === undefined || path === null) return context.state
    return {
      ...context.state,
      produced: [...context.state.produced, { seq: match.event.seq, path }],
    }
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
  const matches = paths.filter(path => basenameOf(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}

/** 路径末段（本模块内部使用；公开面经 path-keys 的 basename 导出）。 */
function basenameOf(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}