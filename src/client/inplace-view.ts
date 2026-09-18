/**
 * 就地遮蔽回退·客户端纯计算（M3，移植 dsh-rewind/src/client/hidden.ts 语义）。
 *
 * 从 chat 快照推导需要从 transcript 隐藏的行 anchor seq 集：一次就地回退切一个
 * 区间 [目标消息 seq, 标记 seq]，落在区间内的行（含目标与区间内助手/工具行）
 * 全部遮蔽，使渲染对话与模型上下文一致。遮蔽标记（空 user/message +
 * surface replace）在 dsh 视图里不渲染成任何行（非 append surface、非 compact
 * 插件），聊天流天然没有命令行/标记行；区间信息由执行方经
 * {@link recordInplaceSpan} 写入本模块的持久化存储（localStorage，刷新后仍能
 * 隐藏已撤回的历史行）。
 *
 * 无 DOM、不订阅——纯函数 + 一个本地 span 存储，输入只有会话 id 与 chat 快照。
 * TODO: span 存在浏览器本地，换设备打开同一会话时被遮蔽行会重新可见（与
 * restore-records 同一天花板）；宿主在快照里透出 surfaceOp 后可改为纯派生。
 */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'

/** 一条就地回退的隐藏区间：[目标消息 seq, 遮蔽标记 seq]。 */
interface InplaceSpan {
  readonly start: number
  readonly end: number
}

// ── span 持久化（与会话恢复记录同一模式）─────────────────────────────────

const SPANS_STORAGE_KEY = 'dsh-shadow-rewind:inplace-spans:v1'
/** 每会话持久化的最大区间数（新区间入栈溢出时丢最旧）。 */
const SPANS_LIMIT_PER_SESSION = 100

const spansBySession = new Map<string, InplaceSpan[]>()
let spansHydrated = false
const spanListeners = new Set<() => void>()

function safeStorage(): Storage | undefined {
  try {
    const value = globalThis.localStorage
    if (value === undefined || value === null) return undefined
    return value
  } catch {
    return undefined
  }
}

function persistSpans(): void {
  const storage = safeStorage()
  if (storage === undefined) return
  const payload: Record<string, readonly InplaceSpan[]> = {}
  for (const [sessionId, list] of spansBySession) {
    payload[sessionId] = list.slice(-SPANS_LIMIT_PER_SESSION)
  }
  try {
    storage.setItem(SPANS_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // 配额满 / 隐私模式：持久化失败不影响内存语义。
  }
}

function hydrateSpans(): void {
  if (spansHydrated) return
  spansHydrated = true
  const storage = safeStorage()
  if (storage === undefined) return
  let raw: string | null = null
  try {
    raw = storage.getItem(SPANS_STORAGE_KEY)
  } catch {
    return
  }
  if (raw === null) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
  const source = parsed as Record<string, unknown>
  for (const sessionId of Object.keys(source)) {
    const list = source[sessionId]
    if (!Array.isArray(list)) continue
    const spans: InplaceSpan[] = []
    for (const entry of list) {
      const item = entry as Record<string, unknown>
      if (typeof item?.start !== 'number' || typeof item?.end !== 'number') continue
      if (!Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end)) continue
      spans.push({ start: item.start, end: item.end })
    }
    if (spans.length > 0) spansBySession.set(sessionId, spans)
  }
}

/** 记录一次就地回退的隐藏区间（执行成功后调用；广播给座位行隐藏刷新）。 */
export function recordInplaceSpan(sessionId: string, start: number, end: number): void {
  hydrateSpans()
  const list = spansBySession.get(sessionId) ?? []
  list.push({ start, end })
  if (list.length > SPANS_LIMIT_PER_SESSION) list.splice(0, list.length - SPANS_LIMIT_PER_SESSION)
  spansBySession.set(sessionId, list)
  persistSpans()
  for (const listener of spanListeners) listener()
}

/** 订阅 span 变化（返回释放器）。 */
export function subscribeInplaceSpans(listener: () => void): () => void {
  spanListeners.add(listener)
  return () => { spanListeners.delete(listener) }
}

/** 某会话的全部隐藏区间（只读）。 */
function spansOf(sessionId: string): readonly InplaceSpan[] {
  hydrateSpans()
  return spansBySession.get(sessionId) ?? []
}

// ── 快照推导 ────────────────────────────────────────────────────────────

/** chat 视图中一个行节点的最小面。 */
interface ChatRowLike {
  readonly anchorSeq?: number
}

/**
 * 需要从 transcript 遮蔽的行 anchor seq 集合：落在任一回退区间
 * [目标, 标记] 内的行（含目标自身与区间内助手/工具行）一并隐藏。多个回退
 * 各自独立成区间，绝不合并（后一次回退到更晚的点会在两个区间之间留下仍属
 * surface 的新流量）。
 */
export function hiddenSeqsOf(sessionId: string, snap: ChatSnapshot): Set<number> {
  const spans = spansOf(sessionId)
  const hidden = new Set<number>()
  if (spans.length === 0) return hidden
  for (const key of snap.order) {
    const node = snap.nodes.get(key) as ChatRowLike | undefined
    const anchor = node?.anchorSeq
    if (anchor === undefined) continue
    if (spans.some(span => anchor >= span.start && anchor <= span.end)) {
      hidden.add(anchor)
    }
  }
  return hidden
}

/** 被就地遮蔽隐藏掉的 chat key 集合（seat 行按 key 判 hide）。 */
export function hiddenKeysOf(sessionId: string, snap: ChatSnapshot): Set<string> {
  const hiddenSeqs = hiddenSeqsOf(sessionId, snap)
  if (hiddenSeqs.size === 0) return new Set<string>()
  const keys = new Set<string>()
  for (const key of snap.order) {
    const node = snap.nodes.get(key) as ChatRowLike | undefined
    if (node !== undefined && node.anchorSeq !== undefined && hiddenSeqs.has(node.anchorSeq)) keys.add(key)
  }
  return keys
}

/** chat 中 seq 处的用户/插话消息全文（composer 回填用；无状态→undefined）。 */
export function messageTextAt(snap: ChatSnapshot, seq: number): string | undefined {
  for (const key of snap.order) {
    const node = snap.nodes.get(key) as
      | { readonly kind?: unknown; readonly data?: { readonly seq?: number; readonly content?: readonly { readonly type?: string; readonly text?: string }[] } | null }
      | undefined
    if (node === undefined) continue
    if (node.kind !== 'user' && node.kind !== 'steering') continue
    const data = node.data
    if (data !== null && typeof data === 'object' && data.seq === seq) {
      return data.content
        ?.map(block => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
        .join('')
    }
  }
  return undefined
}
