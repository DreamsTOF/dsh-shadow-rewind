/**
 * dsh-shadow-rewind —— 浏览器半边的「会话回退」面。
 *
 * 职责：给每条直发用户消息挂「恢复到发送之前」入口，打开统一恢复弹窗
 * RewindDialog（消息按钮与审计面板「从快照恢复此轮」共用同一份预览数据）。
 * 唯一语义：**整树恢复到该检查点，丢弃其后的一切写盘**（含终端/外部与手动
 * 修改）；消息入口同时就地遮蔽该消息及其后的对话行并把文本放回输入框。
 *
 * 全部走客户端公开服务（slots / sessions / conversation），宿主半边不注入
 * 任何上下文；文件恢复的真正执行与安全闸都在引擎侧。
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the runtime client Context merges（ctx.slots / sessions）。
import type {} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import { forceWarmFsChanges } from './fs-diff-utils.ts'
import { commitRestore, popRewound, snapshotBarrierOf } from './rewound-changes.ts'
import { hiddenKeysOf } from './inplace-view.ts'
import { runInplaceMask, chatSnapshotOf } from './inplace-run.ts'
import { decodeSharedRewindPreview, fetchSharedRewindPreview, RewindPreviewHttpError } from './preview-http.ts'
import { REWIND_BASE, rewindErrorText } from './client-http.ts'
import { skipReasonLabel } from './change-labels.ts'
import { matchPendingRows, retractSpan, type SteeringItemLike } from './pending.ts'
import { openAuditOverlay } from './audit-open.ts'

const PATH = REWIND_BASE

// ── 样式 ────────────────────────────────────────────────────────────────

const STYLE_ID = 'dsh-shadow-rewind'
const styles = `
.srw-tail{display:inline-flex;align-items:center;align-self:center;height:24px;margin-left:2px}
.srw-trigger{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.srw-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.srw-overlay{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.55);backdrop-filter:blur(4px)}
.srw-dialog{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:min(560px,100%);max-height:calc(100dvh - 96px);padding:18px 20px;border-radius:14px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#111a2e);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));box-shadow:0 18px 60px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary,#e6ecff)}
.srw-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px;font-weight:600}
.srw-foot{display:flex;justify-content:flex-end;gap:8px}
.srw-foot button{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:transparent;color:var(--dsw-alias-label-secondary,#b8c5ea);cursor:pointer;font-size:13px}
.srw-foot button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.srw-foot button:disabled{opacity:.5;cursor:default}
.srw-content{min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.srw-body{display:flex;flex-direction:column;gap:14px;width:100%;min-width:0;box-sizing:border-box}
.srw-option{display:flex;align-items:flex-start;gap:10px;width:100%;box-sizing:border-box;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.srw-option[data-selected="true"]{border-color:var(--dsw-alias-state-business-primary)}
.srw-option input{flex:none;margin:2px 0 0}
.srw-option-content{flex:1;min-width:0}
.srw-option strong{display:block;color:var(--dsw-alias-label-primary);font-size:14px}
.srw-option-description{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.srw-summary{display:flex;flex-wrap:wrap;column-gap:16px;row-gap:4px;color:var(--dsw-alias-label-secondary);font-size:13px}
.srw-files{max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.srw-file{display:flex;align-items:center;gap:16px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.srw-file[data-expandable="true"]{cursor:pointer}
.srw-file[data-expandable="true"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.srw-file:last-child{border-bottom:0}
.srw-file code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.srw-kind{flex:none;color:var(--dsw-alias-label-tertiary)}
.srw-stats{display:inline-flex;gap:6px;flex:none;padding:2px 6px;border:0;border-radius:6px;background:transparent;cursor:pointer;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.srw-stats:hover{background:var(--dsw-alias-interactive-bg-hover)}
.srw-added{color:var(--dsw-alias-state-success-primary)}
.srw-removed{color:var(--dsw-alias-state-error-primary)}
.srw-skipped{margin:0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.srw-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.srw-warning,.srw-error{margin:0;padding:10px 12px;border-radius:10px;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.srw-warning{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary)}
.srw-error{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);color:var(--dsw-alias-state-error-primary)}
.srw-retry{align-self:flex-start}
.srw-select-all{display:flex;align-items:center;gap:8px;padding:6px 10px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.srw-file input[type="checkbox"]{flex:none;cursor:pointer}
`

// ── 类型 ────────────────────────────────────────────────────────────────

/** 一条可回退的直发用户消息锚点。 */
interface RewindMatched {
  readonly messageSeq: number
  readonly promptText: string
}

/**
 * 统一恢复弹窗（RewindDialog）的寻址：消息按钮带 messageSeq（三种模式全可用），
 * 审计面板「从快照恢复此轮」带 turn（宿主约束：只支持只恢复文件）。两种寻址
 * 共用同一份预览数据（preview-http 共享加载器）。
 */
export type RewindDialogTarget = RewindMatched | { readonly turn: number }

/** 一个消息行注入目标：DOM 操作容器 + 匹配的会话节点。 */
interface RewindTarget {
  readonly container: HTMLElement
  readonly matched: RewindMatched
}

/** pending steering 气泡的撤回入口目标。 */
interface PendingTarget {
  readonly key: string
  readonly container: HTMLElement
  readonly itemId: string
  readonly text: string | null
  readonly preview: string
}

/** 会话 scope 的最小操作面（撤回用；getSnapshot 提供队列镜像）。 */
interface SessionScopeLike {
  getSnapshot(): unknown
  cancel(): Promise<unknown>
  updateQueue(itemId: string, action: { readonly kind: 'remove' }): Promise<unknown>
}

/** 快照节点里本插件关心的最小面（unknown-safe，不依赖宿主内部类型细节）。 */
interface RewindNodeLike {
  readonly kind?: unknown
  readonly seq?: unknown
  readonly key?: unknown
  readonly content?: unknown
}

/** 本面需要的最小客户端服务面。 */
interface RewindClientContext {
  readonly sessions: {
    open(sessionId: string): void
    scope(sessionId: string): unknown
  }
  readonly conversation: {
    readonly input: { for(scope: unknown): { setDraft(text: string): void } }
  }
}

interface RewindPreviewChange {
  readonly path: string
  readonly kind: string
  /** 服务端预算的净行数（不可得时缺省）。 */
  readonly added?: number
  readonly removed?: number
  /** 归属徽标（信息展示）：'target' | 'multi' | 'unknown' | 其它会话 id。 */
  readonly owner?: string
}

interface RewindPreviewSkip {
  readonly path: string
  readonly reason: string
}

type RewindPreview =
  | { readonly status: 'pending' }
  | { readonly status: 'missing' }
  | { readonly status: 'skipped'; readonly reason: string }
  | { readonly status: 'failed'; readonly error: string }
  | {
    readonly status: 'ready'
    readonly sessionId: string
    /** 寻址回显：turn 入口（按轮预览）不带 messageSeq；messageSeq 入口两者都可能带。 */
    readonly messageSeq?: number
    readonly turn?: number
    readonly checkpointId: string
    /** 工作区绝对路径：撤销恢复与「审查界面」定位用。 */
    readonly workspace?: string
    readonly totalChanges: number
    readonly changes: readonly RewindPreviewChange[]
    readonly truncated: boolean
    readonly skippedPaths: readonly RewindPreviewSkip[]
    readonly planId?: string
    /** 当前页在全部变更中的起始下标（loadAll 分页校验用）。 */
    readonly offset?: number
  }

// ── 入口：注册消息操作行的 portal 桥 ─────────────────────────────────────

export const rewindInject = ['slots', 'sessions', 'conversation']

export function rewindApply(ctx: Context): void {
  rewindContextRef = ctx as unknown as RewindClientContext
  ctx.effect(() => {
    if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = STYLE_ID
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'shadow-rewind: styles')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'shadow-rewind-portals',
    order: 100,
    inject: () => ({
      sessionScopeOf: (sessionId: string): SessionScopeLike | undefined =>
        (ctx as unknown as RewindClientContext).sessions.scope(sessionId) as SessionScopeLike | undefined,
    }),
  }, RewindPortals))
}

// ── pending steering 撤回（抄 dsh-rewind 的 pending 管道）────────────────

/** pending steering 气泡行（宿主权威的 pre-admission 投影）。 */
const PENDING_SEAT_SELECTOR = '[data-pending-steering]'

/** 所有会话座位行（含用户/助手/工具/命令），锚点 key 在 data-chat-anchor-key。 */
const CHAT_SEAT_SELECTOR = '[data-chat-anchor-key]'

/**
 * 定位 pending 行的操作按钮容器（copy 等 IconActions 行）：取行内最后一个
 * 非本插件按钮的 parentElement——操作行恒在最后，跳过自身的 ↶/↺ 防止
 * 刷新时把按钮挂到自己身上。DOM 形状不匹配就拒绝挂载（绝不挂错）。
 */
function actionsContainerOf(row: HTMLElement | undefined): HTMLElement | undefined {
  const buttons = Array.from(row?.querySelectorAll<HTMLButtonElement>('button') ?? [])
  const lastButton = buttons.filter((button) => !button.classList.contains('srw-trigger')).at(-1)
  const structural = lastButton?.parentElement
  if (structural instanceof HTMLElement && structural.querySelector('button') !== null) return structural
  return undefined
}

/**
 * pending 气泡的文本（克隆行读 textContent，并剔除末尾的操作容器——宿主
 * copy 按钮的 Tooltip 悬浮文本会让整行 textContent 在鼠标悬停时抖动，
 * 克隆读取保持 matchPendingRows 严格相等的稳定性；活行绝不被触碰）。
 */
function bubbleTextOf(row: HTMLElement): string {
  const clone = row.cloneNode(true) as HTMLElement
  clone.lastElementChild?.remove()
  return clone.textContent ?? ''
}

/**
 * 从会话镜像收集 pending 撤回目标（子代理队列宿主侧拒绝变更，直接跳过）。
 * 会话镜像本身是 cordis 服务代理：在未把该服务声明进本插件 inject 的宿主上
 * `scope.getSnapshot()` 会抛「cannot get property ... without inject」——撤回
 * 只是可选增强，读不到队列就整组放弃，绝不让它把 durable 回退按钮的刷新
 * 流程打断（durable 目标在 refresh 里先于它 setState）。
 */
function collectPendingTargets(sessionScope: SessionScopeLike | undefined): readonly PendingTarget[] {
  if (sessionScope === undefined) return []
  let snapshot: {
    readonly subagent?: unknown
    readonly queue?: readonly { readonly id?: unknown; readonly placement?: unknown; readonly preview?: unknown; readonly text?: unknown }[]
  }
  try {
    snapshot = sessionScope.getSnapshot() as typeof snapshot
  } catch {
    return []
  }
  if (snapshot?.queue === undefined || !Array.isArray(snapshot.queue)) return []
  if (snapshot.subagent !== null) return [] // 队列可变性闸（queueMutable = subagent === null）
  const steering = snapshot.queue
    .filter((item) => item.placement === 'steering')
    .map((item): SteeringItemLike & { readonly preview: string } | null => {
      if (typeof item.id !== 'string' || item.id === '') return null
      return {
        id: item.id,
        text: typeof item.text === 'string' ? item.text : null,
        preview: typeof item.preview === 'string' ? item.preview : '',
      }
    })
    .filter((item): item is SteeringItemLike & { readonly preview: string } => item !== null)
  if (steering.length === 0) return []
  const rows = Array.from(document.querySelectorAll<HTMLElement>(PENDING_SEAT_SELECTOR))
  const matched = matchPendingRows(
    rows.map((row) => ({ text: bubbleTextOf(row) })),
    steering.map((item) => ({ id: item.id, text: item.text })),
  )
  const targets: PendingTarget[] = []
  for (let i = 0; i < matched.length; i++) {
    const itemId = matched[i]
    if (itemId === null || itemId === undefined) continue
    const row = rows[i]
    const actions = actionsContainerOf(row)
    if (actions === undefined) continue
    const item = steering[i]
    if (item === undefined) continue
    targets.push({ key: `pending:${itemId}`, container: actions, itemId, text: item.text, preview: item.preview })
  }
  return targets
}

/** 往 pending 行的操作容器注入撤回按钮（命令式 DOM，同消息回退按钮）。 */
function createPendingPortalButton(container: HTMLElement, onOpen: () => void): null {
  let holder = container.querySelector<HTMLElement>(':scope > .srw-tail')
  if (holder === null) {
    holder = document.createElement('span')
    holder.className = 'srw-tail'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'srw-trigger'
    button.title = '撤回这条未发送的消息'
    button.setAttribute('aria-label', '撤回这条未发送的消息')
    button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 4.75h8M4 8h5.5M4 11.25h3.5" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg>'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      event.preventDefault()
      onOpen()
    })
    holder.appendChild(button)
    container.appendChild(holder)
  }
  return null
}

/** 撤回执行（抄 dsh-rewind retractPending）：先暂停回合 → 目标及其后全部
 * steering 逐个 remove → composer 为空时回填被撤回的文本。remove 失败
 * 静默忽略（典型 queue-item-not-found：消息刚被领取，此时走常规回退）。 */
async function retractPending(
  sessionScope: SessionScopeLike,
  ctx: RewindClientContext,
  sessionId: string,
  itemId: string,
  text: string | null,
): Promise<void> {
  await sessionScope.cancel().catch(() => undefined)
  const snapshot = sessionScope.getSnapshot() as {
    readonly queue?: readonly { readonly id?: unknown; readonly placement?: unknown }[]
  }
  const steering = (snapshot?.queue ?? [])
    .filter((item): item is { readonly id: string; readonly placement: string; readonly text: string | null } =>
      typeof item.id === 'string' && item.placement === 'steering')
  for (const id of retractSpan(steering, itemId)) {
    await sessionScope.updateQueue(id, { kind: 'remove' }).catch(() => undefined)
  }
  if (text !== null && text !== '') {
    const composer = document.querySelector('[data-composer-input]')
    if (composer !== null && (composer.textContent ?? '').trim() === '') {
      const scope = ctx.sessions.scope(sessionId)
      if (scope !== undefined) ctx.conversation.input.for(scope).setDraft(text)
    }
  }
}

/** 从一条会话节点提取「可回退的直发用户消息」锚点。 */
function selectRewindMessage(node: RewindNodeLike): RewindMatched | null {
  if (node.kind !== 'user' || !Number.isSafeInteger(node.seq) || (node.seq as number) < 0) return null
  const blocks = Array.isArray(node.content) ? node.content : []
  const promptText = blocks
    .filter((block): block is Record<string, unknown> =>
      typeof block === 'object' && block !== null
      && (block as Record<string, unknown>).type === 'text'
      && typeof (block as Record<string, unknown>).text === 'string')
    .map((block) => block.text as string)
    .join('\n')
  return { messageSeq: node.seq as number, promptText }
}

interface RewindPortalsProps {
  readonly sessionId: string
  readonly sessionScopeOf: (sessionId: string) => SessionScopeLike | undefined
  /** dsh 0.1.2 起会话快照不再携带对话节点：直发消息候选改从 chat 视图快照
   * （uiConversation chat target）的 legacy.nodes 取 kind='user' 节点。 */
  readonly useChat: UseChat
}

function RewindPortals({ sessionId, sessionScopeOf, useChat }: RewindPortalsProps) {
  // chat 目标快照按不可变发布：useChat 每次渲染取同一引用，派生数组按引用
  // 记忆化，避免「渲染 → 数组新引用 → effect 重跑」死循环。
  const chat = useChat((value) => value)
  const nodes = React.useMemo<readonly RewindNodeLike[]>(
    () => chatUserNodes(chat as ChatSnapshot | undefined),
    [chat],
  )
  const [targets, setTargets] = React.useState<RewindTarget[]>([])
  const [pendingTargets, setPendingTargets] = React.useState<PendingTarget[]>([])
  // M3 就地遮蔽：本次渲染中我们动手隐藏过的座位行（恢复显示时只动自己的）。
  const hiddenSeats = React.useRef<WeakSet<HTMLElement>>(new WeakSet())
  React.useLayoutEffect(() => {
    let active = true
    let queued = false
    const refresh = () => {
      if (!active) return
      const next = collectTargets(nodes)
      setTargets((current) => sameTargets(current, next) ? current : next)
      const nextPending = collectPendingTargets(sessionScopeOf(sessionId))
      setPendingTargets((current) => samePendingTargets(current, nextPending) ? current : [...nextPending])
      applyHiddenSeats(sessionId, chat, hiddenSeats.current)
    }
    // DOM 行可能晚于会话快照出现；MutationObserver + 微任务去重足够。
    // 首轮收集同样走微任务：commit 阶段绝不 setState，杜绝嵌套更新
    // （React #185 Maximum update depth exceeded）。
    const queue = () => {
      if (queued || !active) return
      queued = true
      queueMicrotask(() => { queued = false; refresh() })
    }
    queue()
    const observer = new MutationObserver(queue)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => { active = false; observer.disconnect() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, sessionId])
  return [
    ...targets.map((target) => React.createElement(RewindAction, {
      key: `${sessionId}:${String(target.matched.messageSeq)}`,
      matched: target.matched,
      container: target.container,
      sessionId,
      sessionScopeOf,
    })),
    ...pendingTargets.map((target) => React.createElement(RetractAction, {
      key: target.key,
      target,
      sessionId,
      sessionScopeOf,
    })),
  ]
}

/** 两组 pending 目标是否等价（顺序敏感；无变化就不触发 React 重渲染）。 */
function samePendingTargets(left: readonly PendingTarget[], right: readonly PendingTarget[]): boolean {
  return left.length === right.length && left.every((target, index) => {
    const other = right[index]
    return other !== undefined && target.key === other.key && target.container === other.container
  })
}

/** chatUserNodes 的快照同一性缓存：chat 快照按不可变发布，派生数组必须按
 * 快照引用记忆化，否则每次渲染都是新引用，把 layout effect 拖进无限循环。 */
const chatNodesCache = new WeakMap<object, readonly RewindNodeLike[]>()

const EMPTY_CHAT_NODES: readonly RewindNodeLike[] = []

/** 从 view 节点里探测用户消息的事件 seq（legacy 记录无 key，锚点 key 靠 seq
 * 对齐——宿主对同一个 user 消息会同时给出 legacy 记录与 chat view 节点）。 */
function probeUserSeq(node: unknown): number | undefined {
  if (typeof node !== 'object' || node === null) return undefined
  const record = node as {
    readonly anchorSeq?: unknown
    readonly seq?: unknown
    readonly kind?: unknown
    readonly data?: { readonly node?: { readonly seq?: unknown }; readonly seq?: unknown }
  }
  const candidates = [
    record.anchorSeq,
    record.seq,
    record.data?.seq,
    record.data?.node?.seq,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0) return candidate
  }
  return undefined
}

/** 从 chat 视图快照（uiConversation chat target）取直发用户消息节点：
 * 内容/seq 来自 legacy.user 记录，data-chat-anchor-key 锚点来自同 seq 的
 * chat view 节点（legacy 记录本身没有 key）。 */
function chatUserNodes(chat: ChatSnapshot | null | undefined): readonly RewindNodeLike[] {
  if (chat === null || chat === undefined) return EMPTY_CHAT_NODES
  const hit = chatNodesCache.get(chat)
  if (hit !== undefined) return hit
  const legacyNodes = chat.legacy?.nodes
  const legacyUsers = Array.isArray(legacyNodes)
    ? legacyNodes.filter((node): node is RewindNodeLike =>
      typeof node === 'object' && node !== null
      && (node as { readonly kind?: unknown }).kind === 'user')
    : []
  // seq → chat view key（用户座位行的 data-chat-anchor-key）。
  const keyBySeq = new Map<number, string>()
  let viewNodes: readonly unknown[] = []
  try {
    viewNodes = chat.nodes?.values?.() ?? []
  } catch {
    viewNodes = []
  }
  for (const viewNode of viewNodes) {
    const record = viewNode as { readonly key?: unknown; readonly kind?: unknown }
    if (record.kind !== 'user') continue
    const seq = probeUserSeq(viewNode)
    if (typeof seq === 'number' && typeof record.key === 'string') keyBySeq.set(seq, record.key)
  }
  const users: readonly RewindNodeLike[] = legacyUsers.length > 0
    ? legacyUsers.map((node) => {
      const seq = typeof node.seq === 'number' && Number.isSafeInteger(node.seq) ? node.seq : undefined
      const key = seq === undefined ? undefined : keyBySeq.get(seq)
      return { ...node, ...(key === undefined ? {} : { key }) }
    })
    : EMPTY_CHAT_NODES
  chatNodesCache.set(chat, users)
  return users
}

interface RewindActionProps {
  readonly matched: RewindMatched
  readonly container: HTMLElement
  readonly sessionId: string
  readonly sessionScopeOf: (sessionId: string) => SessionScopeLike | undefined
}

function RewindAction({ matched, container, sessionId }: RewindActionProps) {
  const [open, setOpen] = React.useState(false)
  return React.createElement(React.Fragment, null,
    createPortalButton(container, matched, () => setOpen(true)),
    open && React.createElement(RewindDialog, {
      sessionId,
      target: matched,
      onClose: () => setOpen(false),
    }),
  )
}

interface RetractActionProps {
  readonly target: PendingTarget
  readonly sessionId: string
  readonly sessionScopeOf: (sessionId: string) => SessionScopeLike | undefined
}

/** 撤回管道要用的 RewindClientContext（composer 回填）；rewindApply 时绑定。 */
let rewindContextRef: RewindClientContext | null = null

/** pending 气泡旁的撤回按钮 + 确认对话框。 */
function RetractAction({ target, sessionId, sessionScopeOf }: RetractActionProps) {
  const [confirming, setConfirming] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const onConfirm = async (): Promise<void> => {
    const sessionScope = sessionScopeOf(sessionId)
    if (sessionScope === undefined || rewindContextRef === null) {
      setConfirming(false)
      return
    }
    setBusy(true)
    try {
      await retractPending(sessionScope, rewindContextRef, sessionId, target.itemId, target.text)
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }
  return React.createElement(React.Fragment, null,
    createPendingPortalButton(target.container, () => setConfirming(true)),
    confirming && React.createElement(RetractDialog, {
      text: target.text,
      preview: target.preview,
      busy,
      onConfirm: () => { void onConfirm() },
      onClose: () => { if (!busy) setConfirming(false) },
    }),
  )
}

interface RetractDialogProps {
  readonly text: string | null
  readonly preview: string
  readonly busy: boolean
  readonly onConfirm: () => void
  readonly onClose: () => void
}

/** 撤回确认对话框：单步确认，无模式选择、无 impact 预览（不涉及文件）。 */
function RetractDialog({ text, preview, busy, onConfirm, onClose }: RetractDialogProps) {
  const body = text !== null && text !== ''
    ? text
    : preview !== ''
      ? preview
      : null
  return React.createElement('div', {
    className: 'srw-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    onClick: (event: React.MouseEvent) => {
      if (event.target === event.currentTarget) onClose()
    },
  },
  React.createElement('div', { className: 'srw-dialog', style: { width: 'min(480px, 100%)' } },
    React.createElement('div', { className: 'srw-dialog-head' },
      React.createElement('strong', null, '撤回未发送的消息'),
      React.createElement('button', { type: 'button', className: 'srw-trigger', onClick: onClose, 'aria-label': '关闭' }, '✕'),
    ),
    React.createElement('div', { className: 'srw-content' },
      React.createElement('p', { className: 'srw-status' },
        '这条消息还在待执行队列里，撤回后不会发给模型；它之后的排队消息会一并撤回。'),
      body !== null
        ? React.createElement('p', { className: 'srw-warning', style: { maxHeight: '160px', overflowY: 'auto', whiteSpace: 'pre-wrap' } }, body)
        : null,
    ),
    React.createElement('div', { className: 'srw-foot' },
      React.createElement('button', { type: 'button', disabled: busy, onClick: onClose }, '取消'),
      React.createElement('button', { type: 'button', disabled: busy, onClick: onConfirm }, busy ? '撤回中…' : '撤回'),
    ),
  ),
  )
}

/** 往消息操作行尾部注入回退按钮（命令式 DOM，与宿主列表结构解耦）。 */
function createPortalButton(container: HTMLElement, _matched: RewindMatched, onOpen: () => void): null {
  let holder = container.querySelector<HTMLElement>(':scope > .srw-tail')
  if (holder === null) {
    holder = document.createElement('span')
    holder.className = 'srw-tail'
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'srw-trigger'
    button.title = '恢复到发送这条消息之前'
    button.setAttribute('aria-label', '恢复到发送这条消息之前')
    button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.35 3.25 2.75 7l3.6 3.75M3.1 7h5.15a4.25 4.25 0 0 1 4.25 4.25v1.25" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>'
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      event.preventDefault()
      onOpen()
    })
    holder.appendChild(button)
    container.appendChild(holder)
  }
  return null
}

// ── 回退对话框 ──────────────────────────────────────────────────────────

export interface RewindDialogProps {
  readonly sessionId: string
  /** 统一寻址：消息按钮 = RewindMatched；审计面板「从快照恢复此轮」= { turn }。 */
  readonly target: RewindDialogTarget
  /** 点某行的 +/- 就地跳到该文件 diff（审计面板内打开时提供）；缺省经
   * audit-open 总线交给 live 条开全屏审查并深链。 */
  readonly onJumpToDiff?: (path: string) => void
  readonly onClose: () => void
}

export function RewindDialog({ sessionId, target, onJumpToDiff, onClose }: RewindDialogProps) {
  // 消息入口才有 messageSeq 寻址（就地遮蔽以该消息为界）；轮入口只恢复文件。
  const targetMessageSeq = 'messageSeq' in target ? target.messageSeq : undefined
  const promptText = 'messageSeq' in target ? target.promptText : ''
  const [loading, setLoading] = React.useState(true)
  const [preview, setPreview] = React.useState<RewindPreview | null>(null)
  const [applying, setApplying] = React.useState(false)
  const [stale, setStale] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [completed, setCompleted] = React.useState<string | null>(null)
  // B1 撤销：恢复完成后提供「撤销本次恢复」（进程内单次 undo）。
  const [undoing, setUndoing] = React.useState(false)
  // EXPECTED-DESIGN 1.2：probe 探到 CAS 冲突时的三选项弹窗清单（null = 不弹）。
  const [undoConflicts, setUndoConflicts] = React.useState<readonly { path: string; reason: string }[] | null>(null)

  // Esc 关闭（manual §1.1：Esc / 点遮罩 / ✕ 三种关闭，与 AuditOverlay /
  // timeline 同一交互约定）。恢复执行中或冲突三选项子对话框打开时不响应，
  // 防止误关整个恢复流程。
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (applying || undoing || undoConflicts !== null) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose, applying, undoing, undoConflicts])

  /** 点某行的 +/-：就地跳转（面板内）或开全屏审查（消息旁，弹窗随之关闭）。 */
  const jumpToDiff = (path: string): void => {
    if (onJumpToDiff !== undefined) {
      onJumpToDiff(path)
      return
    }
    openAuditOverlay([path])
    onClose()
  }

  const load = React.useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setStale(false)
      setError(null)
      setCompleted(null)
    }
    try {
      // 共享加载器（preview-http）：GET + 分页拉全 + 解码一次做完。
      // 统一寻址：turn / messageSeq 二选一，与端点 query 对应。
      const shared = await fetchSharedRewindPreview(sessionId, target)
      setPreview(decodePreview(shared))
    } catch (caught) {
      // 静默重查失败不动已有预览。
      if (caught instanceof RewindPreviewHttpError) {
        if (caught.code === 'PLAN_STALE') setStale(true)
        if (!silent) setError(previewHttpMessage(caught))
      } else if (!silent) {
        setError(friendlyError(caught))
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [sessionId, target])

  React.useEffect(() => { void load() }, [load])

  const ready = preview !== null && preview.status === 'ready' ? preview : null
  const hasChanges = ready !== null && ready.totalChanges > 0
  const planMissing = hasChanges && ready !== null && ready.planId === undefined
  // 文件可零改动（会话已被该消息之后的内容推进、文件早已同步）——消息入口
  // 仍允许只做对话就地遮蔽，因此 hasChanges 不作为门槛。
  const needsFileRestore = targetMessageSeq === undefined || hasChanges
  const canApply = ready !== null && !loading && !applying && completed === null
    && !planMissing && !stale
    && (!needsFileRestore || hasChanges)
  const canUndo = completed !== null && ready !== null && ready.workspace !== undefined && !undoing && !applying

  const undoRestore = async () => {
    if (!canUndo || ready?.workspace === undefined) return
    setUndoing(true)
    setError(null)
    try {
      // 两段式（EXPECTED-DESIGN 1.2）：先 probe 只读比对 CAS——无冲突直接
      // 撤销；有冲突弹三选项对话框（拒绝 / 全部回滚 / 只回滚正常部分）。
      const probeResponse = await fetch(`${PATH}/restore-undo`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, cwd: ready.workspace, mode: 'probe' }),
      })
      const probeBody = await responseJson(probeResponse) as { conflicted?: unknown }
      const conflicted = Array.isArray(probeBody.conflicted)
        ? probeBody.conflicted
          .map((entry) => {
            const item = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
              ? entry as Record<string, unknown> : {}
            return typeof item.path === 'string'
              ? { path: item.path, reason: typeof item.reason === 'string' ? item.reason : '' }
              : null
          })
          .filter((entry): entry is { path: string; reason: string } => entry !== null)
        : []
      if (conflicted.length === 0) {
        await applyUndo(false)
        return
      }
      setUndoConflicts(conflicted)
    } catch (undoError) {
      setError(`撤销失败：${messageOf(undoError)}`)
    } finally {
      setUndoing(false)
    }
  }

  /** 执行撤销（force = 用户在弹窗授权「全部回滚 / 二次回滚」）。 */
  const applyUndo = async (force: boolean) => {
    if (ready?.workspace === undefined) return
    setUndoing(true)
    setError(null)
    try {
      const response = await fetch(`${PATH}/restore-undo`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, cwd: ready.workspace, ...(force ? { force: true } : {}) }),
      })
      const record = await responseJson(response) as {
        undonePaths?: unknown
        skippedPaths?: unknown
        /** 被撤销恢复的身份（T7：对齐遮蔽记录层，防多会话同工作区弹错层）。 */
        id?: unknown
        sessionId?: unknown
      }
      const undone = Array.isArray(record.undonePaths) ? record.undonePaths.length : 0
      const skipped = Array.isArray(record.skippedPaths)
        ? record.skippedPaths.filter((item): item is { path: string; reason: string } =>
          typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).path === 'string')
        : []
      const lines = [force
        ? `已强制撤销本次恢复：${String(undone)} 个路径回到恢复前状态（冲突修改已被覆盖）。`
        : `已撤销本次恢复：${String(undone)} 个路径回到恢复前状态。`]
      for (const skip of skipped) lines.push(`跳过 ${skip.path}：${skip.reason}`)
      if (skipped.length > 0) lines.push('被跳过的文件仍可再次点击「撤销本次恢复」，确认后强制回滚。')
      setCompleted(lines.join('\n'))
      setUndoConflicts(null)
      // 撤销成功：若被撤销的恢复正是本会话发起的（或宿主未回传身份 = 旧宿主，
      // 维持原行为），弹出最近一次遮蔽标记让 live 条恢复显示恢复前的改动；
      // 若是**其它会话**在同一工作区的恢复被撤销，绝不弹本会话的遮蔽层
      // （那层对应的磁盘状态仍有效），避免「弹错层」。fs 缓存任何磁盘变化都刷。
      const undoneSessionId = typeof record.sessionId === 'string' ? record.sessionId : undefined
      const poppedThisSession = undoneSessionId === undefined || undoneSessionId === sessionId
      if ((undone > 0 || force) && poppedThisSession) popRewound(sessionId)
      if (undone > 0 || force) forceWarmFsChanges(sessionId)
    } catch (undoError) {
      setError(`撤销失败：${messageOf(undoError)}`)
    } finally {
      setUndoing(false)
    }
  }

  const applyRestore = async () => {
    if (ready === null || !canApply) return
    setApplying(true)
    setError(null)
    try {
      const filesDone = ready.totalChanges > 0
      if (filesDone) {
        // 唯一恢复语义：整树（无子集）——宿主把工作区恢复到该检查点，
        // 丢弃其后一切写盘。
        const response = await fetch(PATH, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            // 双寻址：消息入口走 messageSeq；轮入口走 turn。
            ...(targetMessageSeq === undefined
              ? { turn: 'turn' in target ? target.turn : 0 }
              : { messageSeq: targetMessageSeq }),
            checkpointId: ready.checkpointId,
            planId: ready.planId,
          }),
        })
        await responseJson(response)
        // 恢复成功：打整树遮蔽标记（paths = null），live 条的会话累计视图据此
        // 扣掉屏障之前的全部条目；「撤销本次恢复」弹出标记即还原。
        // 屏障 = 当前 chat 快照全量最大 seq；快照不可得时 barrier=-1。
        const snapshot = chatSnapshotOf(rewindContextRef, sessionId)
        const barrier = snapshot === undefined || snapshot === null ? -1 : snapshotBarrierOf(snapshot)
        commitRestore({
          sessionId,
          paths: null,
          barrier,
          checkpointId: ready.checkpointId,
          mode: 'inplace',
          workspace: ready.workspace,
        })
        // 磁盘确定性变化：绕过 warm 节流立即刷新 fs 缓存（审计/live 同源）。
        forceWarmFsChanges(sessionId)
      }
      if (targetMessageSeq === undefined) {
        setCompleted(filesDone
          ? '项目文件已恢复；当前对话保持不变。恢复前的文件已自动备份。'
          : '项目文件已经是这一轮开始之前的状态，无需恢复。')
        return
      }
      const outcome = await runInplaceMask(sessionId, targetMessageSeq)
      if (outcome.status !== 'ok') {
        const prefix = filesDone ? '项目文件已恢复；' : ''
        setError(`${prefix}本对话就地回退失败：${outcome.text}`)
        return
      }
      // 目标消息文本放回输入框（仅本会话、输入框为空时，绝不覆盖草稿）。
      fillComposerIfEmpty(sessionId, promptText)
      setCompleted(filesDone
        ? '项目文件已恢复；本对话已就地回退到这条消息之前（目标及之后消息已撤回，文本已在输入框）。'
        : '本对话已就地回退到这条消息之前（目标及之后消息已撤回，文本已在输入框）；文件无需改动。')
    } catch (caught) {
      if (caught instanceof RewindRequestError && caught.code === 'PLAN_STALE') {
        setStale(true)
      }
      setError(friendlyError(caught))
    } finally {
      setApplying(false)
    }
  }

  const messageEntry = targetMessageSeq !== undefined
  return React.createElement('div', { className: 'srw-overlay', role: 'dialog', 'aria-modal': 'true' },
    React.createElement('div', { className: 'srw-dialog' },      React.createElement('div', { className: 'srw-dialog-head' },
        React.createElement('strong', null, messageEntry ? '恢复到发送这条消息之前' : '恢复到此轮之前'),
        React.createElement('button', { type: 'button', className: 'srw-trigger', onClick: onClose, 'aria-label': '关闭' }, '✕'),
      ),
      React.createElement('div', { className: 'srw-content' },
        React.createElement('div', { className: 'srw-body' },
          loading && React.createElement('p', { className: 'srw-status' }, '正在检查可以恢复的项目文件…'),
          preview?.status === 'pending' && React.createElement('p', { className: 'srw-status' }, '这条消息发送之前的文件还在保存，请稍后再试。'),
          preview?.status === 'missing' && React.createElement('p', { className: 'srw-error' }, '没有保存这条消息发送之前的文件。可能是当时还未启用回退功能，或记录已超出保留期限。'),
          preview?.status === 'skipped' && React.createElement('p', { className: 'srw-status' }, '为避免阻塞消息发送，本轮没有自动保存文件：', preview.reason),
          preview?.status === 'failed' && React.createElement('p', { className: 'srw-error' }, '没能保存这条消息发送之前的文件：', preview.error),
          ready !== null && [
            React.createElement('div', { className: 'srw-summary', key: 'summary' },
              React.createElement('strong', null, `将把整个工作区恢复到该时点（${String(ready.totalChanges)} 个文件受影响）`),
              React.createElement('span', null, messageEntry ? '本对话就地回退' : '当前对话保持不变'),
            ),
            React.createElement('p', { className: 'srw-status', key: 'hint' },
              '恢复按检查点整树进行：这之后的一切写盘都会被丢弃——包括终端/外部进程的改动与你自己手动做的修改。'),
            ready.skippedPaths.length > 0 && React.createElement('div', { className: 'srw-skipped', key: 'skipped' }, [
              React.createElement('div', { key: 'title' }, '以下文件未纳入快照，恢复不会改动它们：'),
              ...ready.skippedPaths.map((skip) => React.createElement('div', { key: skip.path },
                React.createElement('code', null, skip.path), `（${skipReasonLabel(skip.reason)}）`)),
            ]),
            planMissing && React.createElement('p', { className: 'srw-error', key: 'plan' }, '恢复信息已经失效，请重新检查。'),
            stale && React.createElement('p', { className: 'srw-error', key: 'stale' }, '项目文件在检查后又发生了变化。为避免覆盖新修改，本次恢复已失效，请重新检查。'),
            ready.totalChanges === 0 && React.createElement('p', { className: 'srw-status', key: 'nochanges' }, '项目文件已经是这条消息发送前的状态，无需恢复。'),
            ready.changes.length > 0 && React.createElement('div', { className: 'srw-files', key: 'files' },
              ready.changes.map((change) => React.createElement(PreviewFileRow, {
                key: change.path,
                change,
                onJump: () => { jumpToDiff(change.path) },
              })),
            ),
          ],
          completed !== null && React.createElement('p', { className: 'srw-status', style: { whiteSpace: 'pre-line' } }, completed),
          completed !== null && canUndo && React.createElement('button', {
            type: 'button', className: 'srw-retry', key: 'undo',
            onClick: () => { void undoRestore() }, disabled: undoing,
          }, undoing ? '正在撤销…' : '撤销本次恢复'),
          error !== null && React.createElement('p', { className: 'srw-error' }, error),
          !loading && (preview === null || preview.status !== 'ready' || stale || planMissing) && completed === null
            && React.createElement('button', { type: 'button', className: 'srw-retry', onClick: () => { void load() } }, '重新检查'),
        ),
      ),
      React.createElement('div', { className: 'srw-foot' },
        React.createElement('button', { type: 'button', onClick: onClose, disabled: applying }, '取消'),
        React.createElement('button', { type: 'button', onClick: () => { void applyRestore() }, disabled: !canApply },
          applying
            ? '正在恢复…'
            : completed === null
              ? messageEntry ? '就地回退' : '恢复文件'
              : '已完成'),
      ),
    ),
    undoConflicts !== null && React.createElement(UndoConflictDialog, {
      conflicts: undoConflicts,
      busy: undoing,
      onAbort: () => { setUndoConflicts(null) },
      onPartial: () => { void applyUndo(false) },
      onForce: () => { void applyUndo(true) },
    }),
  )
}

/**
 * 撤销冲突三选项弹窗（EXPECTED-DESIGN 1.2）：列出 CAS 失配（恢复之后又被
 * 修改过）的文件，用户三选一——拒绝回滚 / 全部回滚（覆盖修改）/
 * 只回滚正常部分（跳过后可对剩余文件做确认的二次回滚）。
 */
function UndoConflictDialog({ conflicts, busy, onAbort, onPartial, onForce }: {
  readonly conflicts: readonly { path: string; reason: string }[]
  readonly busy: boolean
  readonly onAbort: () => void
  readonly onPartial: () => void
  readonly onForce: () => void
}) {
  return React.createElement('div', {
    className: 'srw-overlay', role: 'dialog', 'aria-modal': 'true',
    style: { zIndex: 2147483300 },
  },
    React.createElement('div', { className: 'srw-dialog' },
      React.createElement('div', { className: 'srw-dialog-head' },
        React.createElement('strong', null, '部分文件无法正常回滚'),
        React.createElement('button', { type: 'button', className: 'srw-trigger', onClick: onAbort, 'aria-label': '关闭' }, '✕'),
      ),
      React.createElement('div', { className: 'srw-content' },
        React.createElement('div', { className: 'srw-body' },
          React.createElement('p', { className: 'srw-warning' },
            '以下文件在恢复之后又被修改过（可能与你的手动修改有关）。「全部回滚」会覆盖这些修改；',
            '「只回滚正常部分」会跳过它们，之后可对剩余文件再次确认回滚。'),
          React.createElement('div', { className: 'srw-files' },
            conflicts.map((conflict) => React.createElement('div', { className: 'srw-file', key: conflict.path },
              React.createElement('code', null, conflict.path),
              React.createElement('span', { className: 'srw-kind' }, '恢复后又被修改'),
            )),
          ),
        ),
      ),
      React.createElement('div', { className: 'srw-foot' },
        React.createElement('button', { type: 'button', onClick: onAbort, disabled: busy }, '拒绝回滚'),
        React.createElement('button', { type: 'button', onClick: onPartial, disabled: busy }, '只回滚正常部分'),
        React.createElement('button', { type: 'button', onClick: onForce, disabled: busy }, busy ? '正在回滚…' : '全部回滚'),
      ),
    ),
  )
}

/**
 * 恢复预览的文件行：路径 + 服务端预算的净 +/- 行数（与 live 条同一口径）。
 * 完整的逐处 diff 在审查界面里看——点该行跳过去（深链展开该文件）。
 */
function PreviewFileRow({ change, onJump }: {
  readonly change: RewindPreviewChange
  readonly onJump: () => void
}): React.ReactElement {
  const hasStats = change.added !== undefined || change.removed !== undefined
  const stats = { added: change.added ?? 0, removed: change.removed ?? 0 }
  return React.createElement('div', { key: change.path },
    React.createElement('div', {
      className: 'srw-file',
      'data-expandable': 'true',
      onClick: onJump,
    },
      React.createElement('code', null, change.path),
      hasStats && React.createElement('button', {
        type: 'button',
        className: 'srw-stats',
        title: '在审查界面查看这个文件的完整 diff',
        onClick: (event: React.MouseEvent) => {
          event.stopPropagation()
          onJump()
        },
      },
        React.createElement('span', { className: 'srw-added' }, `+${String(stats.added)}`),
        React.createElement('span', { className: 'srw-removed' }, `-${String(stats.removed)}`),
      ),
    ),
  )
}

// ── 协议解析与文案 ───────────────────────────────────────────────────────

function decodePreview(value: unknown): RewindPreview {
  // 字段解析共用 preview-http 的 decodeSharedRewindPreview；这里只做统一弹窗
  // 的「就绪必填」严格校验与文案字段映射。寻址回显按入口宽松：turn 入口不带
  // messageSeq，messageSeq 入口可能不带 turn。
  const shared = decodeSharedRewindPreview(value)
  if (shared.status !== 'ready') {
    if (shared.status === 'skipped') return { status: 'skipped', reason: shared.reason ?? '' }
    if (shared.status === 'failed') return { status: 'failed', error: shared.error ?? shared.reason ?? '' }
    return { status: shared.status }
  }
  const sessionId = requiredString(shared.sessionId, 'sessionId')
  const messageSeq = optionalInteger(shared.messageSeq)
  const turn = optionalInteger(shared.turn)
  const checkpointId = requiredString(shared.checkpointId, 'checkpointId')
  return {
    status: 'ready',
    sessionId,
    ...(messageSeq === undefined ? {} : { messageSeq }),
    ...(turn === undefined ? {} : { turn }),
    checkpointId,
    totalChanges: requiredInteger(shared.totalChanges, 'totalChanges'),
    changes: shared.changes.map((change) => ({
      path: change.path,
      kind: change.kind,
      ...(change.added === undefined ? {} : { added: change.added }),
      ...(change.removed === undefined ? {} : { removed: change.removed }),
      ...(change.owner === undefined ? {} : { owner: change.owner }),
    })),
    truncated: shared.truncated,
    skippedPaths: shared.skippedPaths,
    ...(shared.workspace === undefined ? {} : { workspace: shared.workspace }),
    ...(shared.planId === undefined ? {} : { planId: shared.planId }),
    ...(shared.offset === undefined ? {} : { offset: shared.offset }),
  }
}

/** 共享加载器抛错的用户文案（单源映射；未覆盖码回落宿主原文）。 */
function previewHttpMessage(error: RewindPreviewHttpError): string {
  return rewindErrorText(error.code) ?? error.message
}

function friendlyError(error: unknown): string {
  // 错误码→文案单源（client-http.rewindErrorText）；未覆盖码回落宿主原文。
  if (error instanceof RewindRequestError) return rewindErrorText(error.code) ?? error.message
  return messageOf(error)
}

// ── DOM 收集与会话跳转 ───────────────────────────────────────────────────

/**
 * M3 就地遮蔽：按 chat 快照把被撤回区间里的座位行藏起来（display:none + 语义
 * data-dsh-rewind-hidden），让渲染对话与模型上下文一致；区间外的行恢复可见。
 * 只恢复「我们藏过的」行（WeakSet 记账），绝不擅自动其它来源的样式。
 */
function applyHiddenSeats(sessionId: string, chat: ChatSnapshot | null | undefined, hiddenSeats: WeakSet<HTMLElement>): void {
  const hiddenKeys = chat === null || chat === undefined ? new Set<string>() : hiddenKeysOf(sessionId, chat)
  for (const seat of Array.from(document.querySelectorAll<HTMLElement>(CHAT_SEAT_SELECTOR))) {
    const key = seat.dataset.chatAnchorKey
    if (key !== undefined && hiddenKeys.has(key)) {
      if (seat.style.display !== 'none') {
        seat.style.display = 'none'
        seat.dataset.dshRewindHidden = 'true'
        hiddenSeats.add(seat)
      }
      continue
    }
    if (hiddenSeats.has(seat)) {
      seat.style.display = ''
      delete seat.dataset.dshRewindHidden
      hiddenSeats.delete(seat)
    }
  }
}

function collectTargets(nodes: readonly RewindNodeLike[]): RewindTarget[] {
  const rows = new Map<string, HTMLElement>()
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('[data-chat-flow-kind="user"][data-chat-anchor-key]'))) {
    const key = element.dataset.chatAnchorKey
    if (key !== undefined) rows.set(key, element)
  }
  const targets: RewindTarget[] = []
  for (const node of nodes) {
    const matched = selectRewindMessage(node)
    if (matched === null) continue
    const anchorKey = typeof node.key === 'string' ? node.key : `node:${String(node.seq)}`
    const row = rows.get(anchorKey)
    // 结构式定位宿主操作行容器（dsh-rewind 同款）：取行内最后一个非本插件
    // 按钮的 parentElement，即宿主 MessageIconActions 的 .actions 容器。
    // 宿主当前线上没有 data-time-hover-root；命令式注入只在找到容器时才发生，
    // 找不到整行跳过（绝不误挂到别的气泡）。
    const actions = actionsContainerOf(row)
    if (actions === undefined) continue
    targets.push({ container: actions, matched })
  }
  return targets
}

function sameTargets(left: readonly RewindTarget[], right: readonly RewindTarget[]): boolean {
  return left.length === right.length && left.every((target, index) => {
    const other = right[index]
    return other !== undefined
      && target.container === other.container
      && target.matched.messageSeq === other.matched.messageSeq
  })
}

/** 就地回退成功后把目标文本放回输入框：仅当输入框为空且会话 scope 可达时。 */
function fillComposerIfEmpty(sessionId: string, text: string): void {
  if (text === '') return
  const composer = document.querySelector('[data-composer-input]')
  if (composer === null || (composer.textContent ?? '').trim() !== '') return
  const ctx = rewindContextRef
  if (ctx === null) return
  try {
    const scope = ctx.sessions.scope(sessionId)
    if (scope !== undefined) ctx.conversation.input.for(scope).setDraft(text)
  } catch {
    // 草稿写失败可忽略：文本仍可手动复制，绝不因此中断就地回退流程。
  }
}

// ── 基础工具 ─────────────────────────────────────────────────────────────

async function responseJson(response: Response): Promise<unknown> {
  const value: unknown = await response.json()
  if (!response.ok) {
    const record = recordOf(value)
    throw new RewindRequestError(
      typeof record.code === 'string' ? record.code : 'REWIND_FAILED',
      typeof record.error === 'string' ? record.error : `请求失败：${String(response.status)}`,
    )
  }
  return value
}

class RewindRequestError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('服务器返回了无效对象')
  }
  return value as Record<string, unknown>
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${name} 无效`)
  return value
}

function requiredInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error(`${name} 无效`)
  return value as number
}

/** 宽松可选整数（寻址回显按入口可缺席；非法/缺席 → undefined）。 */
function optionalInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}