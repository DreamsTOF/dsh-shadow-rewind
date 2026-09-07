/**
 * dsh-shadow-rewind —— 浏览器半边的「会话回退」面。
 * （自手写 client.js 等价移植为 TS 模块，行为与文案保持逐行一致。）
 *
 * 职责：给每条直发用户消息挂「恢复到发送之前」入口，打开预览对话框
 * （文件清单 / 快照跳过项 / 两种回退模式），确认后调用宿主 /shadow-rewind
 * 端点执行文件恢复，可选在分叉出的新会话里继续。
 *
 * 全部走客户端公开服务（slots / sessions / conversation），宿主半边不注入
 * 任何上下文；文件恢复的真正执行与安全闸都在引擎侧。
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ProducedFileDiff } from '../file-review/change-types.ts'
import { fetchCheckpointFileContent } from './fs-diff-utils.ts'
import { pathKey } from './session-changes.ts'
import { markRewound, popRewound } from './rewound-changes.ts'
import { matchPendingRows, retractSpan, type SteeringItemLike } from './pending.ts'
import { UnifiedDiff } from './UnifiedDiff.tsx'
import { fetchSubsetPlan, pathsTooLong, SubsetPlanError } from './subset-plan.ts'

const PATH = '/shadow-rewind'

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
.srw-file{display:flex;justify-content:space-between;gap:16px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.srw-file[data-expandable="true"]{cursor:pointer}
.srw-file[data-expandable="true"]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.srw-file-diff{padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:300px;overflow:auto;background:var(--dsw-alias-bg-layer-2)}
.srw-file:last-child{border-bottom:0}
.srw-file code{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.srw-kind{flex:none;color:var(--dsw-alias-label-tertiary)}
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

type SessionNodes = Iterable<RewindNodeLike>

/** slots 系统注入的会话订阅钩子（选择器返回什么组件就拿到什么）。 */
type UseSession = (selector: (snapshot: unknown) => SessionNodes) => SessionNodes

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
  /** 对称模式归属：'target' | 'multi' | 'unknown' | 其它会话 id。 */
  readonly owner?: string
  /** 对称模式默认勾选（只属于目标会话的路径）。 */
  readonly autoSelect?: boolean
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
    readonly messageSeq: number
    readonly turn: number
    readonly checkpointId: string
    /** 工作区绝对路径（新宿主）：行级预览按需拉全文时的 cwd 参数。 */
    readonly workspace?: string
    /** 恢复语义模式：恒为 symmetric（勾选式子集；旧宿主可能缺省）。 */
    readonly mode?: 'current-wins' | 'symmetric'
    readonly totalChanges: number
    readonly changes: readonly RewindPreviewChange[]
    readonly truncated: boolean
    readonly activeSessionIds: readonly unknown[]
    readonly skippedPaths: readonly RewindPreviewSkip[]
    readonly planId?: string
    /** 当前页在全部变更中的起始下标（loadAll 分页校验用）。 */
    readonly offset?: number
  }

type RewindMode = 'both' | 'code'

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
      openRestoredSession: async (sessionId: string, promptText: string) => {
        await openSessionWithDraft(ctx as unknown as RewindClientContext, sessionId, promptText)
      },
      sessionScopeOf: (sessionId: string): SessionScopeLike | undefined =>
        (ctx as unknown as RewindClientContext).sessions.scope(sessionId) as SessionScopeLike | undefined,
    }),
  }, RewindPortals))
}

// ── pending steering 撤回（抄 dsh-rewind 的 pending 管道）────────────────

/** pending steering 气泡行（宿主权威的 pre-admission 投影）。 */
const PENDING_SEAT_SELECTOR = '[data-pending-steering]'

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

/** 从会话镜像收集 pending 撤回目标（子代理队列宿主侧拒绝变更，直接跳过）。 */
function collectPendingTargets(sessionScope: SessionScopeLike | undefined): readonly PendingTarget[] {
  if (sessionScope === undefined) return []
  const snapshot = sessionScope.getSnapshot() as {
    readonly subagent?: unknown
    readonly queue?: readonly { readonly id?: unknown; readonly placement?: unknown; readonly preview?: unknown; readonly text?: unknown }[]
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
  readonly openRestoredSession: (sessionId: string, promptText: string) => Promise<void>
  readonly sessionScopeOf: (sessionId: string) => SessionScopeLike | undefined
  readonly useSession: UseSession
}

/**
 * 恢复屏障取值：恢复成功那一刻会话快照的最大节点 seq（rewound-changes 的
 * 遮蔽判别基准）。
 */
function rewindBarrier(useSession: UseSession): number {
  let max = -1
  for (const node of useSession((snapshot) => nodesOf(snapshot))) {
    if (typeof node.seq === 'number' && node.seq > max) max = node.seq
  }
  return max
}

function RewindPortals({ sessionId, openRestoredSession, sessionScopeOf, useSession }: RewindPortalsProps) {
  const nodes = useSession((snapshot) => nodesOf(snapshot))
  const [targets, setTargets] = React.useState<RewindTarget[]>([])
  const [pendingTargets, setPendingTargets] = React.useState<PendingTarget[]>([])
  React.useLayoutEffect(() => {
    let active = true
    let queued = false
    const refresh = () => {
      if (!active) return
      const next = collectTargets(nodes)
      setTargets((current) => sameTargets(current, next) ? current : next)
      const nextPending = collectPendingTargets(sessionScopeOf(sessionId))
      setPendingTargets((current) => samePendingTargets(current, nextPending) ? current : [...nextPending])
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
      openRestoredSession,
      sessionScopeOf,
      useSession,
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

/** nodesOf 的快照同一性缓存：选择器每次调用都必须返回**同一引用**——
 * `map.values()` 迭代器与 `[]` 字面量每次都是新对象，useSession 据此判定
 * store 在抖动，陷入「渲染 → 快照又变 → 再渲染」的无限循环，正是 React
 * #185（Maximum update depth exceeded）的根因。按不可变快照引用记忆化
 * （session-changes.ts 的徽标推导同款手法）。 */
const nodesCache = new WeakMap<object, SessionNodes>()

const EMPTY_NODES: SessionNodes = []

/** 兼容不同 dsh 版本的快照形态：优先 chat.nodes（Map，物化成数组以稳定引用），回退顶层 nodes。 */
function nodesOf(snapshot: unknown): SessionNodes {
  if (typeof snapshot !== 'object' || snapshot === null) return EMPTY_NODES
  const hit = nodesCache.get(snapshot)
  if (hit !== undefined) return hit
  const record = snapshot as {
    chat?: { nodes?: Map<unknown, RewindNodeLike> }
    nodes?: SessionNodes
  }
  const nodes: SessionNodes = record.chat?.nodes !== undefined
    ? Array.from(record.chat.nodes.values())
    : record.nodes ?? EMPTY_NODES
  nodesCache.set(snapshot, nodes)
  return nodes
}

interface RewindActionProps {
  readonly matched: RewindMatched
  readonly container: HTMLElement
  readonly sessionId: string
  readonly openRestoredSession: (sessionId: string, promptText: string) => Promise<void>
  readonly sessionScopeOf: (sessionId: string) => SessionScopeLike | undefined
  readonly useSession: UseSession
}

function RewindAction({ matched, container, sessionId, openRestoredSession, useSession }: RewindActionProps) {
  const [open, setOpen] = React.useState(false)
  return React.createElement(React.Fragment, null,
    createPortalButton(container, matched, () => setOpen(true)),
    open && React.createElement(RewindDialog, {
      sessionId,
      matched,
      openRestoredSession,
      useSession,
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

interface RewindDialogProps {
  readonly sessionId: string
  readonly matched: RewindMatched
  readonly openRestoredSession: (sessionId: string, promptText: string) => Promise<void>
  readonly useSession: UseSession
  readonly onClose: () => void
}

function RewindDialog({ sessionId, matched, openRestoredSession, useSession, onClose }: RewindDialogProps) {
  const [loading, setLoading] = React.useState(true)
  const [preview, setPreview] = React.useState<RewindPreview | null>(null)
  const [mode, setMode] = React.useState<RewindMode>('both')
  const [applying, setApplying] = React.useState(false)
  const [stale, setStale] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [completed, setCompleted] = React.useState<string | null>(null)
  // B1 撤销：恢复完成后提供「撤销本次恢复」（进程内单次 undo）。
  const [undoing, setUndoing] = React.useState(false)
  // EXPECTED-DESIGN 1.2：probe 探到 CAS 冲突时的三选项弹窗清单（null = 不弹）。
  const [undoConflicts, setUndoConflicts] = React.useState<readonly { path: string; reason: string }[] | null>(null)
  // 对称模式的勾选集（null = 非对称模式，整树恢复）。
  const [selected, setSelected] = React.useState<ReadonlySet<string> | null>(null)

  const load = React.useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setStale(false)
      setError(null)
      setCompleted(null)
    }
    try {
      const response = await fetch(`${PATH}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}`, {
        headers: { accept: 'application/json' }, cache: 'no-store',
      })
      const first = decodePreview(await responseJson(response))
      // 对称模式：勾选清单必须覆盖全部变更——自动按页拉全后初始化默认勾选
      // （只属于目标会话的路径）。
      if (first.status === 'ready' && first.mode === 'symmetric' && first.truncated) {
        const collected = [...first.changes]
        let offset = collected.length
        while (first.totalChanges > offset) {
          const pageResponse = await fetch(`${PATH}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}&details=1&offset=${String(offset)}&limit=200`, {
            headers: { accept: 'application/json' }, cache: 'no-store',
          })
          const page = decodePreview(await responseJson(pageResponse))
          if (page.status !== 'ready' || page.checkpointId !== first.checkpointId || page.offset !== offset) {
            throw new RewindRequestError('PLAN_STALE', '项目文件在展开列表时发生了变化。')
          }
          collected.push(...page.changes)
          offset += page.changes.length
          if (page.changes.length === 0) break
        }
        const merged: RewindPreview = { ...first, changes: collected, truncated: false }
        setPreview(merged)
        setSelected(new Set(merged.changes.filter(change => change.autoSelect === true).map(change => change.path)))
        return
      }
      setPreview(first)
      setSelected(first.status === 'ready' && first.mode === 'symmetric'
        ? new Set(first.changes.filter(change => change.autoSelect === true).map(change => change.path))
        : null)
    } catch (caught) {
      // 静默重查失败不动已有预览（占用未解除是常态，不算错误）。
      if (!silent) setError(friendlyError(caught))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [sessionId, matched.messageSeq])

  React.useEffect(() => { void load() }, [load])

  const ready = preview !== null && preview.status === 'ready' ? preview : null
  const hasChanges = ready !== null && ready.totalChanges > 0
  const symmetric = ready?.mode === 'symmetric'
  const selectedCount = selected?.size ?? 0
  const allSelected = symmetric && ready !== null && selected !== null
    && selected.size >= ready.changes.length && ready.changes.length > 0
  const planMissing = hasChanges && ready !== null
    && ready.planId === undefined
  const canApply = ready !== null && !loading && !applying && completed === null
    && hasChanges && !planMissing && !stale
    && (!symmetric || selectedCount > 0)
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
      const record = await responseJson(response) as { undonePaths?: unknown; skippedPaths?: unknown }
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
      // 撤销成功：弹出最近一次遮蔽标记，live 条恢复显示恢复前的改动。
      if (undone > 0 || force) popRewound(sessionId)
    } catch (undoError) {
      setError(`撤销失败：${messageOf(undoError)}`)
    } finally {
      setUndoing(false)
    }
  }

  const togglePath = (path: string) => {
    setSelected((current) => {
      if (current === null) return current
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const setAllPaths = (selectAll: boolean) => {
    setSelected((current) => {
      if (current === null) return current
      if (!selectAll) return new Set<string>()
      const readyNow = preview !== null && preview.status === 'ready' ? preview : null
      return readyNow === null ? current : new Set(readyNow.changes.map(change => change.path))
    })
  }

  const loadAll = async () => {
    if (ready === null || !ready.truncated) return
    setLoading(true)
    try {
      const collected = [...ready.changes]
      let offset = collected.length
      while (offset < ready.totalChanges) {
        const response = await fetch(`${PATH}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}&details=1&offset=${String(offset)}&limit=200`, {
          headers: { accept: 'application/json' }, cache: 'no-store',
        })
        const page = decodePreview(await responseJson(response))
        if (page.status !== 'ready' || page.checkpointId !== ready.checkpointId || page.offset !== offset) {
          throw new RewindRequestError('PLAN_STALE', '项目文件在展开列表时发生了变化。')
        }
        collected.push(...page.changes)
        offset += page.changes.length
        if (page.changes.length === 0) break
      }
      setPreview({ ...ready, changes: collected, truncated: false })
    } catch (caught) {
      if (caught instanceof RewindRequestError && caught.code === 'PLAN_STALE') setStale(true)
      setError(friendlyError(caught))
    } finally {
      setLoading(false)
    }
  }

  const applyRestore = async () => {
    if (ready === null || !canApply) return
    setApplying(true)
    setError(null)
    try {
      let planId = ready.planId
      // 对称模式且未全选：先铸造只覆盖勾选路径的子集计划（确认由本弹窗
      // 承担——确认串已废除，EXPECTED-DESIGN 1.4 #2）。
      if (ready.planId !== undefined
        && symmetric && selected !== null && selected.size < ready.totalChanges) {
        const paths = ready.changes.filter(change => selected.has(change.path)).map(change => change.path)
        if (paths.length > 0) {
          if (pathsTooLong(paths)) throw new Error('勾选的文件过多，无法构造恢复请求；请减少勾选')
          const subset = await fetchSubsetPlan(`sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}`, paths)
          planId = subset.planId
        }
      }
      const response = await fetch(PATH, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          sessionId,
          messageSeq: ready.messageSeq,
          checkpointId: ready.checkpointId,
          planId,
        }),
      })
      const result = await responseJson(response)
      // 恢复成功：打回滚遮蔽标记，live 条的会话累计视图据此扣掉被恢复的条目
      // （屏障 = 当前快照最大节点 seq；屏障后的再编辑照常显示）。
      // 对称模式只遮蔽勾选（被恢复）的路径；整树恢复（非对称）遮蔽全部路径。
      markRewound(
        sessionId,
        symmetric && selected !== null
          ? new Set(ready.changes.filter(change => selected.has(change.path)).map(change => pathKey(change.path)))
          : null,
        rewindBarrier(useSession),
      )
      if (mode === 'code') {
        setCompleted('项目文件已恢复；当前对话保持不变。恢复前的文件已自动备份。')
        return
      }
      setCompleted('项目文件已恢复，并已创建新对话。恢复前的文件已自动备份。')
      try {
        await openRestoredSession((result as { sessionId?: string }).sessionId ?? '', matched.promptText)
        onClose()
      } catch (navigationError) {
        setError(`文件已经恢复，新对话也已创建，但没能自动打开：${messageOf(navigationError)}`)
      }
    } catch (caught) {
      if ((caught instanceof RewindRequestError || caught instanceof SubsetPlanError)
        && caught.code === 'PLAN_STALE') {
        setStale(true)
      }
      setError(friendlyError(caught))
    } finally {
      setApplying(false)
    }
  }

  const radioName = `srw-${sessionId}-${String(matched.messageSeq)}`
  return React.createElement('div', { className: 'srw-overlay', role: 'dialog', 'aria-modal': 'true' },
    React.createElement('div', { className: 'srw-dialog' },      React.createElement('div', { className: 'srw-dialog-head' },
        React.createElement('strong', null, '恢复到发送这条消息之前'),
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
            React.createElement('div', { key: 'options' },
              optionRadio(radioName, 'both', mode, applying, setMode, '恢复文件并从这里继续', '创建一个从这里开始的新会话（当前对话会保留）'),
              optionRadio(radioName, 'code', mode, applying, setMode, '只恢复文件', '恢复这条消息发送之前的文件，当前对话保持不变。'),
            ),
            React.createElement('div', { className: 'srw-summary', key: 'summary' },
              React.createElement('strong', null, symmetric
                ? `将恢复 ${String(selectedCount)} / ${String(ready.totalChanges)} 个文件`
                : `将恢复 ${String(ready.totalChanges)} 个文件`),
              React.createElement('span', null, mode === 'both' ? '恢复后在新对话里继续' : '当前对话保持不变'),
            ),
            symmetric && React.createElement('p', { className: 'srw-status', key: 'hint' }, '默认只勾选本会话改动的文件；勾选其它文件会把它们一并恢复到该时点。'),
            ready.skippedPaths.length > 0 && React.createElement('div', { className: 'srw-skipped', key: 'skipped' }, [
              React.createElement('div', { key: 'title' }, '以下文件未纳入快照，恢复不会改动它们：'),
              ...ready.skippedPaths.map((skip) => React.createElement('div', { key: skip.path },
                React.createElement('code', null, skip.path), `（${skipReasonLabel(skip.reason)}）`)),
            ]),
            planMissing && React.createElement('p', { className: 'srw-error', key: 'plan' }, '恢复信息已经失效，请重新检查。'),
            stale && React.createElement('p', { className: 'srw-error', key: 'stale' }, '项目文件在检查后又发生了变化。为避免覆盖新修改，本次恢复已失效，请重新检查。'),
            ready.totalChanges === 0 && React.createElement('p', { className: 'srw-status', key: 'nochanges' }, '项目文件已经是这条消息发送前的状态，无需恢复。'),
            ready.changes.length > 0 && React.createElement('div', { className: 'srw-files', key: 'files' }, [
              symmetric && React.createElement('label', { className: 'srw-select-all', key: 'selectall' },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: allSelected,
                  onChange: (event) => { setAllPaths(event.target.checked) },
                }),
                '全部选中（整树恢复）',
              ),
              ...ready.changes.map((change) => React.createElement(PreviewFileRow, {
                key: change.path,
                change,
                checkpointId: ready.checkpointId,
                workspace: ready.workspace,
                symmetric,
                checked: selected?.has(change.path) ?? false,
                onTogglePath: () => { togglePath(change.path) },
              })),
            ]),
            ready.truncated && React.createElement('button', { type: 'button', className: 'srw-retry', key: 'more', onClick: () => { void loadAll() } },
              `查看全部 ${String(ready.totalChanges)} 个文件`),
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
          applying ? '正在恢复…' : completed === null ? (mode === 'both' ? '恢复并从这里继续' : '恢复文件') : '已完成'),
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
 * 恢复预览的文件行（A3）：点击展开「当前 → 快照」方向的行级 diff——
 * del = 恢复会带走的当前行，add = 恢复会加回来的快照行。
 * 旧宿主没有 workspace 字段时退化为纯清单行（不展开）。
 */
function PreviewFileRow({ change, checkpointId, workspace, symmetric, checked, onTogglePath }: {
  readonly change: RewindPreviewChange
  readonly checkpointId: string
  readonly workspace?: string
  readonly symmetric: boolean
  readonly checked: boolean
  readonly onTogglePath: () => void
}): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  const badge = change.owner === undefined || change.owner === 'target'
    ? null
    : change.owner === 'multi'
      ? '双方都改过'
      : change.owner === 'unknown'
        ? '来源不明'
        : `会话 ${change.owner.length > 12 ? `${change.owner.slice(0, 12)}…` : change.owner}`
  const expandable = workspace !== undefined && change.kind !== 'type-changed'
  return React.createElement('div', { key: change.path },
    React.createElement('div', {
      className: 'srw-file',
      'data-expandable': expandable ? 'true' : undefined,
      onClick: expandable ? () => setOpen((current) => !current) : undefined,
    },
      symmetric && React.createElement('input', {
        type: 'checkbox',
        checked,
        onClick: (event: React.MouseEvent) => { event.stopPropagation() },
        onChange: onTogglePath,
      }),
      React.createElement('code', null, change.path),
      badge !== null && React.createElement('span', { className: 'srw-kind' }, badge),
      React.createElement('span', { className: 'srw-kind' }, kindLabel(change.kind)),
      expandable && React.createElement('span', { className: 'srw-kind' }, open ? '收起 ▲' : '对比 ▼'),
    ),
    open && expandable && React.createElement(PreviewFileDiff, {
      path: change.path,
      kind: change.kind,
      checkpointId,
      workspace,
    }),
  )
}

/** 行级预览内容：当前磁盘 vs 快照（方向 当前 → 快照）。 */
function PreviewFileDiff({ path, kind, checkpointId, workspace }: {
  readonly path: string
  readonly kind: string
  readonly checkpointId: string
  readonly workspace: string
}): React.ReactElement {
  const [diff, setDiff] = React.useState<readonly ProducedFileDiff[] | 'unavailable' | null>(null)
  React.useEffect(() => {
    let active = true
    setDiff(null)
    // kind 语义来自 inspect（快照 → 当前）：added = 现在才存在（恢复会移除），
    // deleted = 快照里有、现在没了（恢复会写回）。
    const isAddedNow = kind === 'added'
    const isGoneNow = kind === 'deleted'
    void Promise.all([
      isGoneNow ? Promise.resolve('') : fetchCheckpointFileContent('live', path, workspace),
      isAddedNow ? Promise.resolve('') : fetchCheckpointFileContent(checkpointId, path, workspace),
    ]).then(([current, snapshot]) => {
      if (!active) return
      if (current === null && snapshot === null) {
        setDiff('unavailable')
        return
      }
      // 方向 = 当前 → 快照：del = 恢复会带走的行，add = 恢复会加回来的行。
      setDiff([{ path, oldText: current ?? '', newText: snapshot ?? '' }])
    })
    return () => { active = false }
  }, [path, kind, checkpointId, workspace])
  if (diff === null) return React.createElement('div', { className: 'srw-file-diff' }, React.createElement('p', { className: 'srw-status' }, '加载全文…'))
  if (diff === 'unavailable') return React.createElement('div', { className: 'srw-file-diff' }, React.createElement('p', { className: 'srw-status' }, '内容不可用（二进制文件或读取失败）。'))
  return React.createElement('div', { className: 'srw-file-diff' },
    React.createElement(UnifiedDiff, {
      diffs: diff,
      contextLines: 3,
      showCopyButton: true,
      labels: {
        copy: '复制差异',
        copied: '已复制',
        showUnchanged: (count: number) => `显示 ${String(count)} 行未变更内容`,
        hideUnchanged: (count: number) => `折叠 ${String(count)} 行未变更内容`,
        hunkN: (n: number) => `块 ${String(n)}`,
        hunkInclude: '勾选的块参与撤销/重做',
      },
    }),
  )
}

function optionRadio(
  radioName: string,
  value: RewindMode,
  mode: RewindMode,
  disabled: boolean,
  setMode: (value: RewindMode) => void,
  title: string,
  description: string,
) {
  return React.createElement('label', { className: 'srw-option', 'data-selected': mode === value, key: value },
    React.createElement('input', {
      type: 'radio', name: radioName, checked: mode === value, disabled,
      onChange: () => setMode(value),
    }),
    React.createElement('span', { className: 'srw-option-content' },
      React.createElement('strong', null, title),
      React.createElement('span', { className: 'srw-option-description' }, description),
    ),
  )
}

// ── 协议解析与文案 ───────────────────────────────────────────────────────

function decodePreview(value: unknown): RewindPreview {
  const record = recordOf(value)
  const status = requiredString(record.status, 'status')
  if (status === 'pending' || status === 'missing') return { status }
  if (status === 'skipped') return { status, reason: requiredString(record.reason, 'reason') }
  if (status === 'failed') return { status, error: requiredString(record.error, 'error') }
  if (status !== 'ready') throw new Error(`未知回退状态：${status}`)
  if (!Array.isArray(record.changes)) throw new Error('回退预览缺少 changes')
  const activeSessionIds = Array.isArray(record.activeSessionIds) ? record.activeSessionIds : []
  // 跳过项明细：[{path, reason}]，逐条渲染给用户看。
  const skippedPaths = Array.isArray(record.skippedPaths)
    ? record.skippedPaths.map((entry) => {
      const skip = recordOf(entry)
      return { path: requiredString(skip.path, 'path'), reason: requiredString(skip.reason, 'reason') }
    })
    : []
  return {
    status,
    sessionId: requiredString(record.sessionId, 'sessionId'),
    messageSeq: requiredInteger(record.messageSeq, 'messageSeq'),
    turn: requiredInteger(record.turn, 'turn'),
    checkpointId: requiredString(record.checkpointId, 'checkpointId'),
    ...(record.mode === 'symmetric' || record.mode === 'current-wins' ? { mode: record.mode } : {}),
    totalChanges: requiredInteger(record.totalChanges, 'totalChanges'),
    changes: record.changes.map((entry) => {
      const change = recordOf(entry)
      return {
        path: requiredString(change.path, 'path'),
        kind: requiredString(change.kind, 'kind'),
        ...(typeof change.owner === 'string' ? { owner: change.owner } : {}),
        ...(change.autoSelect === true ? { autoSelect: true as const } : {}),
      }
    }),
    truncated: record.truncated === true,
    activeSessionIds,
    skippedPaths,
    ...(typeof record.workspace === 'string' ? { workspace: record.workspace } : {}),
    ...(typeof record.planId === 'string' ? { planId: record.planId } : {}),
    ...(typeof record.offset === 'number' ? { offset: record.offset } : {}),
  }
}

/** 跳过原因的用户文案。 */
function skipReasonLabel(reason: string): string {
  switch (reason) {
    case 'too-large': return '超过大小上限'
    case 'unsupported-type': return '文件类型不支持'
    case 'read-failed': return '读取失败'
    default: return reason
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'added': return '移除后来新增的文件'
    case 'deleted': return '找回文件'
    case 'modified': return '恢复之前的版本'
    case 'mode-changed': return '恢复文件权限'
    case 'type-changed': return '恢复之前的文件类型'
    default: return kind
  }
}

function friendlyError(error: unknown): string {
  if (error instanceof RewindRequestError) {
    switch (error.code) {
      case 'PLAN_STALE': return '项目文件在检查后又发生了变化。为避免覆盖新修改，请重新检查后再恢复。'
      case 'RESTORE_POINT_NOT_FOUND': return '没有找到对应的文件状态，可能已被清理。'
      case 'NO_CHANGES': return '项目文件已经是这条消息发送前的状态，无需恢复。'
      case 'RESTORE_FAILED_ROLLED_BACK': return '恢复未能完成，项目文件已自动还原到操作前的状态。'
      case 'CONVERSATION_REWIND_FAILED': return '文件已恢复，但无法创建新对话；项目文件已自动还原。'
      case 'RECOVERY_REQUIRED': return error.message
      default: return error.message
    }
  }
  return messageOf(error)
}

// ── DOM 收集与会话跳转 ───────────────────────────────────────────────────

function collectTargets(nodes: SessionNodes): RewindTarget[] {
  const rows = new Map<string, Element>()
  for (const element of Array.from(document.querySelectorAll('[data-chat-flow-kind="user"][data-chat-anchor-key]'))) {
    const key = (element as HTMLElement).dataset.chatAnchorKey
    if (key !== undefined) rows.set(key, element)
  }
  const targets: RewindTarget[] = []
  for (const node of nodes) {
    const matched = selectRewindMessage(node)
    if (matched === null) continue
    const anchorKey = typeof node.key === 'string' ? node.key : `node:${String(node.seq)}`
    const row = rows.get(anchorKey)
    // 容器必须是宿主操作行的最后一个**宿主**子元素——跳过本插件自己注入的
    // .srw-tail。取裸 lastElementChild 会把上一轮注入的按钮当成容器，再往里
    // 嵌套注入；MutationObserver → refresh → 再渲染 正反馈成无限循环
    // （React #185 Maximum update depth exceeded 即来源于此）。
    const actions = lastHostAction(row?.querySelector('[data-time-hover-root="true"]'))
    if (!(actions instanceof HTMLElement)) continue
    targets.push({ container: actions, matched })
  }
  return targets
}

/** `root` 里最后一个非 `.srw-tail` 的子元素（本插件注入的按钮行不算宿主内容）。 */
function lastHostAction(root: Element | null | undefined): Element | null {
  let child = root?.lastElementChild ?? null
  while (child !== null && child.classList.contains('srw-tail')) child = child.previousElementSibling
  return child
}

function sameTargets(left: readonly RewindTarget[], right: readonly RewindTarget[]): boolean {
  return left.length === right.length && left.every((target, index) => {
    const other = right[index]
    return other !== undefined
      && target.container === other.container
      && target.matched.messageSeq === other.matched.messageSeq
  })
}

async function openSessionWithDraft(ctx: RewindClientContext, sessionId: string, promptText: string): Promise<void> {
  let lastError: unknown = new Error('新对话还没有准备好')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      ctx.sessions.open(sessionId)
      const scope = ctx.sessions.scope(sessionId)
      if (scope !== undefined) {
        ctx.conversation.input.for(scope).setDraft(promptText)
        return
      }
      lastError = new Error('新对话还没有准备好')
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => { setTimeout(resolve, 50) })
  }
  throw lastError
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
