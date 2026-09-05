/**
 * dsh-shadow-rewind —— 时间线浮层面板（借鉴 dsh-checkpoint-diff 的
 * DiffPanel 思路：header action 触发、自绘浮层、时间线选区 → 区间 diff）。
 *
 * 职责：一个工作台式的「这台机器这个项目发生过什么」视图——
 *  - 时间线：turn 快照检查点（轮起/轮末、意图标签、degraded 降级标注）+
 *    会话轨迹节点（tool/call 边界）；
 *  - 选区对比：选两个检查点 → 快照逐文件对比；选两个轨迹节点 → 内容重放
 *    区间 diff（write/edit/str_replace_editor，附盲区 notes）；
 *  - 逐文件行级 diff 渲染复用 UnifiedDiff；快照对比的内容经 /shadow-rewind/file
 *    端点按需懒取。
 *
 * 与侧边栏「文件审查」tab 互补不互斥：侧边栏管逐轮审查与 hunk 撤销，
 * 浮层管跨轮审计与回看；恢复入口仍走消息旁回退按钮 / 侧边栏每轮快照恢复
 * （那里有完整的安全闸与确认流）。
 * TODO: 天花板——面板内暂不直接发起恢复（复用计划+确认串的安全闸需要
 * 跨组件状态）；升级路径：把恢复预览对话框抽成共享组件后从面板深链。
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ProducedFileDiff } from '../file-review/change-types.ts'
import { fetchCheckpointFileContent } from './fs-diff-utils.ts'
import { UnifiedDiff } from './UnifiedDiff.tsx'

const PATH = '/shadow-rewind/trace'
/** 上次查看记忆的 localStorage 键：sessionId → { from, to }（会话内节点对）。 */
const LAST_VIEW_KEY = 'dsh-shadow-rewind:last-view'

/** 读取上次查看的节点对（形状非法/缺失返回 null；节点存在性由调用方校验）。 */
function loadLastView(sessionId: string): { from: Selection; to: Selection } | null {
  try {
    const raw = localStorage.getItem(LAST_VIEW_KEY)
    if (raw === null) return null
    const all = JSON.parse(raw) as Record<string, unknown>
    const entry = all[sessionId]
    if (typeof entry !== 'object' || entry === null) return null
    const record = entry as Record<string, unknown>
    const parse = (value: unknown): Selection | null => {
      if (typeof value !== 'object' || value === null) return null
      const sel = value as Record<string, unknown>
      if (sel.kind === 'checkpoint' && typeof sel.id === 'string' && sel.id.startsWith('rp_')) return { kind: 'checkpoint', id: sel.id }
      if (sel.kind === 'trace' && typeof sel.id === 'string' && sel.id.startsWith('trace:')) return { kind: 'trace', id: sel.id }
      return null
    }
    const from = parse(record.from)
    const to = parse(record.to)
    return from === null || to === null ? null : { from, to }
  } catch {
    return null
  }
}

function saveLastView(sessionId: string, selection: readonly Selection[]): void {
  if (selection.length !== 2) return
  try {
    const all = JSON.parse(localStorage.getItem(LAST_VIEW_KEY) ?? '{}') as Record<string, unknown>
    all[sessionId] = { from: selection[0], to: selection[1] }
    localStorage.setItem(LAST_VIEW_KEY, JSON.stringify(all))
  } catch {
    // localStorage 不可用（隐私模式等）时静默放弃。
  }
}

const STYLE_ID = 'dsh-shadow-rewind-timeline'
const styles = `
.srw-tl-trigger{display:inline-flex;align-items:center;height:24px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:12px}
.srw-tl-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.srw-tl-dialog{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:min(880px,100%);max-height:calc(100dvh - 96px);padding:16px 18px;border-radius:14px;background:var(--dsw-alias-bg-layer-2,#111a2e);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));box-shadow:0 18px 60px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary,#e6ecff)}
.srw-tl-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px;font-weight:600}
.srw-tl-close{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:18px;line-height:1;padding:4px}
.srw-tl-body{min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px}
.srw-tl-section{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.srw-tl-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.srw-tl-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;cursor:pointer;min-width:0}
.srw-tl-row:last-child{border-bottom:0}
.srw-tl-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.srw-tl-row[data-selected="true"]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 18%,transparent)}
.srw-tl-row[data-degraded="true"]{color:var(--dsw-alias-state-warn-primary)}
.srw-tl-dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.srw-tl-row[data-mutating="true"] .srw-tl-dot{background:var(--dsw-alias-state-success-primary,#4ade80)}
.srw-tl-row[data-error="true"] .srw-tl-dot{background:var(--dsw-alias-state-error-primary)}
.srw-tl-main{flex:1;min-width:0;display:flex;align-items:center;gap:8px}
.srw-tl-main code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
.srw-tl-meta{flex:none;color:var(--dsw-alias-label-tertiary)}
.srw-tl-chip{flex:none;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:11px}
.srw-tl-bar{display:flex;align-items:center;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.srw-tl-bar button{height:28px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px}
.srw-tl-bar button:disabled{opacity:.5;cursor:default}
.srw-tl-bar button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.srw-tl-selects{display:flex;gap:10px}
.srw-tl-select{display:flex;flex:1;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-tertiary);min-width:0}
.srw-tl-select select{flex:1;min-width:0;height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 6px}
/* (head) 检查点：左侧高亮竖线标记当前最新状态。 */
.srw-tl-row[data-head="true"]{box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary)}
.srw-tl-row[data-head="true"] .srw-tl-dot{background:var(--dsw-alias-state-business-primary)}

/* ── 横向拖选时间线条带：双轨（快照 / 调用三泳道），等宽槽位投影 ── */
.srw-tl-strip{display:flex;flex-direction:column;gap:4px;touch-action:none}
.srw-tl-track{position:relative;display:flex;align-items:center;gap:8px;user-select:none}
.srw-tl-trackLabel{flex:0 0 auto;width:32px;color:var(--dsw-alias-label-tertiary);font-size:11px}
.srw-tl-cells{position:relative;display:flex;flex:1;min-height:16px;align-items:stretch;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-1)}
.srw-tl-cell{flex:1 1 0;min-width:2px;margin:0 1px;border-radius:3px;background:var(--dsw-alias-label-tertiary);opacity:.45;cursor:pointer}
.srw-tl-cell[data-phase="end"]{opacity:.9}
.srw-tl-cell[data-degraded="true"]{background:var(--dsw-alias-state-warn-primary);opacity:.9}
.srw-tl-lanes{display:flex;flex-direction:column;gap:2px;padding:2px}
.srw-tl-lane{position:relative;min-height:8px}
.srw-tl-span{position:absolute;top:0;height:100%;min-width:2px;border-radius:2px;background:var(--dsw-alias-label-tertiary);opacity:.6;cursor:pointer}
.srw-tl-span[data-kind="user"]{background:var(--dsw-alias-label-primary);opacity:.85}
.srw-tl-span[data-kind="assistant"]{background:var(--dsw-alias-label-secondary);opacity:.75}
.srw-tl-span[data-mutating="true"]{background:var(--dsw-alias-state-success-primary);opacity:.9}
.srw-tl-span[data-error="true"]{background:var(--dsw-alias-state-error-primary);opacity:.95}
.srw-tl-tick{position:absolute;top:-2px;width:1px;height:calc(100% + 4px);background:var(--dsw-alias-border-l3)}
.srw-tl-band{position:absolute;top:0;height:100%;pointer-events:none;background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,transparent);border:1px solid var(--dsw-alias-state-business-primary);border-radius:4px}
.srw-tl-draftHint{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px}
.srw-tl-notes{margin:0;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-state-warn-primary);font-size:12px;line-height:18px}
.srw-tl-diff{display:flex;flex-direction:column;gap:8px}
.srw-tl-file{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;overflow:hidden}
.srw-tl-file-head{display:flex;justify-content:space-between;gap:10px;padding:6px 10px;font-size:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.srw-tl-file-head code{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.srw-tl-file-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.srw-tl-file-body{max-height:340px;overflow:auto}
.srw-tl-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}
.srw-tl-error{margin:0;padding:10px 12px;border-radius:10px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px}
`

// ── 协议（宽松解析：未知/缺失字段降级为空，旧宿主不炸） ──────────────────

interface TraceNodeView {
  readonly seq: number
  readonly name: string
  readonly path?: string
  readonly mutating: boolean
  readonly error?: boolean
}

interface CheckpointView {
  readonly id: string
  readonly turn: number
  readonly phase?: 'start' | 'end'
  readonly createdAt?: number
  readonly fileCount?: number
  readonly degraded?: boolean
  readonly intent?: readonly { readonly tool: string; readonly path: string; readonly seq: number }[]
}

interface TraceSpanView {
  readonly seq: number
  readonly kind: 'user' | 'assistant' | 'tool'
  readonly lane: 0 | 1 | 2
  readonly name?: string
  readonly mutating?: boolean
  readonly error?: boolean
}

interface TimelineData {
  readonly cwd: string
  readonly nodes: readonly TraceNodeView[]
  readonly checkpoints: readonly CheckpointView[]
  readonly spans: readonly TraceSpanView[]
  readonly turnBoundaries: readonly number[]
}

interface RangeChangeView {
  readonly path: string
  readonly kind: 'added' | 'modified' | 'deleted'
  readonly before?: string | null
  readonly after?: string | null
  readonly added?: number
  readonly removed?: number
}

interface RangeResult {
  readonly mode: 'trace' | 'checkpoint'
  readonly from: string
  readonly to: string
  readonly cwd: string
  readonly changes: readonly RangeChangeView[]
  readonly notes?: readonly string[]
}

/** 选区条目：检查点用 rp id，轨迹节点用 trace:<seq>（混合选区被禁用）。 */
type Selection = { readonly kind: 'checkpoint'; readonly id: string } | { readonly kind: 'trace'; readonly id: string }

/** 下拉选项：检查点 + 轨迹节点统一寻址。 */
function selectionOptions(data: TimelineData): { readonly value: string; readonly label: string }[] {
  const options: { value: string; label: string }[] = []
  for (const point of data.checkpoints) {
    options.push({ value: point.id, label: `快照 轮${String(point.turn)} ${point.phase === 'end' ? '轮末' : '轮起'}` })
  }
  for (const node of data.nodes) {
    options.push({ value: `trace:${String(node.seq)}`, label: `#${String(node.seq)} ${node.name}${node.path === undefined ? '' : ` ${node.path}`}` })
  }
  return options
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body !== null && typeof body === 'object' && typeof (body as Record<string, unknown>).error === 'string'
      ? (body as Record<string, unknown>).error as string
      : `HTTP ${String(response.status)}`
    throw new Error(message)
  }
  return body
}

function parseTimeline(value: unknown): TimelineData | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.cwd !== 'string' || !Array.isArray(record.nodes) || !Array.isArray(record.checkpoints)) return null
  const nodes: TraceNodeView[] = []
  for (const raw of record.nodes) {
    if (typeof raw !== 'object' || raw === null) continue
    const node = raw as Record<string, unknown>
    if (typeof node.seq !== 'number' || typeof node.name !== 'string') continue
    nodes.push({
      seq: node.seq,
      name: node.name,
      ...(typeof node.path === 'string' ? { path: node.path } : {}),
      mutating: node.mutating === true,
      ...(node.error === true ? { error: true } : {}),
    })
  }
  const checkpoints: CheckpointView[] = []
  for (const raw of record.checkpoints) {
    if (typeof raw !== 'object' || raw === null) continue
    const point = raw as Record<string, unknown>
    if (typeof point.id !== 'string' || typeof point.turn !== 'number') continue
    checkpoints.push({
      id: point.id,
      turn: point.turn,
      ...(point.phase === 'end' ? { phase: 'end' as const } : point.phase === 'start' ? { phase: 'start' as const } : {}),
      ...(typeof point.createdAt === 'number' ? { createdAt: point.createdAt } : {}),
      ...(typeof point.fileCount === 'number' ? { fileCount: point.fileCount } : {}),
      ...(point.degraded === true ? { degraded: true } : {}),
      ...(Array.isArray(point.intent)
        ? {
          intent: point.intent
            .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
            .map((item) => ({
              tool: String(item.tool ?? ''),
              path: String(item.path ?? ''),
              seq: typeof item.seq === 'number' ? item.seq : 0,
            }))
            .filter((item) => item.tool !== '' && item.path !== ''),
        }
        : {}),
    })
  }
  // 三泳道 spans 与 turn 刻度（宽松解析；旧宿主缺省为空 = 不渲染条带）。
  const spans: TraceSpanView[] = []
  if (Array.isArray(record.spans)) {
    for (const raw of record.spans) {
      if (typeof raw !== 'object' || raw === null) continue
      const span = raw as Record<string, unknown>
      if (typeof span.seq !== 'number' || typeof span.lane !== 'number') continue
      const kind = span.kind === 'user' || span.kind === 'assistant' || span.kind === 'tool' ? span.kind : null
      const lane = span.lane === 0 || span.lane === 1 || span.lane === 2 ? span.lane : null
      if (kind === null || lane === null) continue
      spans.push({
        seq: span.seq,
        kind,
        lane,
        ...(typeof span.name === 'string' ? { name: span.name } : {}),
        ...(span.mutating === true ? { mutating: true } : {}),
        ...(span.error === true ? { error: true } : {}),
      })
    }
  }
  const turnBoundaries = Array.isArray(record.turnBoundaries)
    ? record.turnBoundaries.filter((seq): seq is number => typeof seq === 'number')
    : []
  return { cwd: record.cwd, nodes, checkpoints, spans, turnBoundaries }
}

function parseRange(value: unknown): RangeResult | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if ((record.mode !== 'trace' && record.mode !== 'checkpoint')
    || typeof record.from !== 'string' || typeof record.to !== 'string'
    || typeof record.cwd !== 'string' || !Array.isArray(record.changes)) return null
  const changes: RangeChangeView[] = []
  for (const raw of record.changes) {
    if (typeof raw !== 'object' || raw === null) continue
    const change = raw as Record<string, unknown>
    if (typeof change.path !== 'string') continue
    const kind = change.kind === 'added' || change.kind === 'deleted' || change.kind === 'modified' ? change.kind : null
    if (kind === null) continue
    changes.push({
      path: change.path,
      kind,
      ...(change.before === null || typeof change.before === 'string' ? { before: change.before } : {}),
      ...(change.after === null || typeof change.after === 'string' ? { after: change.after } : {}),
      ...(typeof change.added === 'number' ? { added: change.added } : {}),
      ...(typeof change.removed === 'number' ? { removed: change.removed } : {}),
    })
  }
  return {
    mode: record.mode,
    from: record.from,
    to: record.to,
    cwd: record.cwd,
    changes,
    ...(Array.isArray(record.notes) ? { notes: record.notes.filter((note): note is string => typeof note === 'string') } : {}),
  }
}

// ── 全文懒取（快照对比模式；轨迹模式的全文随响应自带）────────────────────
// fetchCheckpointFileContent 复用 fs-diff-utils 的共享实现（含二进制守卫）。

// ── 组件 ────────────────────────────────────────────────────────────────

export function timelineApply(ctx: Context): void {
  ctx.effect(() => {
    if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = STYLE_ID
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'shadow-rewind-timeline: styles')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'shadow-rewind-timeline',
    order: 101,
  }, TimelineAction))
}

function TimelineAction({ sessionId }: { readonly sessionId: string }): React.ReactElement | null {
  const [open, setOpen] = React.useState(false)
  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      type: 'button',
      className: 'srw-tl-trigger',
      title: '文件时间线：快照检查点与工具调用轨迹的区间对比',
      onClick: () => setOpen(true),
    }, '时间线'),
    open && React.createElement(TimelinePanel, { sessionId, onClose: () => setOpen(false) }),
  )
}

/**
 * 横向拖选时间线条带（借鉴 dsh-checkpoint-diff 的 TraceTimeline 手势设计）：
 * 双轨模型——快照轨（检查点槽位）与调用轨（三泳道 spans）各自等宽投影，
 * 轨内拖选 ≥3px 提交选区对（同轨内吸附，天然不混类），单击锁定单节点。
 * 手势状态机：pointerdown 记锚点 → 窗口级 move/up（画布外释放同样收束），
 * draft 选区带实时渲染；Esc 交给面板（关闭），拖选天然随 pointerup 收束。
 */
function TraceStrip({ data, selection, onCommit, onSingle }: {
  readonly data: TimelineData
  readonly selection: readonly Selection[]
  readonly onCommit: (a: Selection, b: Selection) => void
  readonly onSingle: (entry: Selection) => void
}): React.ReactElement {
  const [draft, setDraft] = React.useState<{ track: 'snapshot' | 'trace'; left: number; right: number } | null>(null)
  const dragRef = React.useRef<{ track: 'snapshot' | 'trace'; anchorX: number; rect: DOMRect; moved: boolean } | null>(null)

  const cellCount = (track: 'snapshot' | 'trace'): number =>
    track === 'snapshot' ? data.checkpoints.length : data.spans.length

  const cellEntry = (track: 'snapshot' | 'trace', index: number): Selection | null => {
    if (track === 'snapshot') {
      const point = data.checkpoints[index]
      return point === undefined ? null : { kind: 'checkpoint', id: point.id }
    }
    const span = data.spans[index]
    return span === undefined ? null : { kind: 'trace', id: `trace:${String(span.seq)}` }
  }

  const startDrag = (track: 'snapshot' | 'trace', event: React.PointerEvent): void => {
    const count = cellCount(track)
    if (count === 0) return
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    dragRef.current = { track, anchorX: event.clientX, rect, moved: false }
    const indexFromX = (x: number): number => Math.max(0, Math.min(count - 1, Math.floor(((x - rect.left) / rect.width) * count)))
    const move = (ev: PointerEvent): void => {
      const drag = dragRef.current
      if (drag === null) return
      if (Math.abs(ev.clientX - drag.anchorX) >= 3) drag.moved = true
      if (drag.moved) {
        setDraft({
          track,
          left: indexFromX(Math.min(ev.clientX, drag.anchorX)),
          right: indexFromX(Math.max(ev.clientX, drag.anchorX)),
        })
      }
    }
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const drag = dragRef.current
      dragRef.current = null
      setDraft(null)
      if (drag === null) return
      const a = indexFromX(Math.min(ev.clientX, drag.anchorX))
      const b = indexFromX(Math.max(ev.clientX, drag.anchorX))
      const first = cellEntry(track, a)
      const second = cellEntry(track, b)
      if (first === null || second === null) return
      if (!drag.moved || a === b) {
        onSingle(first)
        return
      }
      onCommit(first, second)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // 已提交选区带（同轨成对时高亮显示）。
  const band = (track: 'snapshot' | 'trace'): { left: number; width: number } | null => {
    if (selection.length !== 2) return null
    const kind = track === 'snapshot' ? 'checkpoint' : 'trace'
    if (selection[0]!.kind !== kind || selection[1]!.kind !== kind) return null
    const indexOf = (sel: Selection): number => {
      if (track === 'snapshot') return data.checkpoints.findIndex((point) => point.id === sel.id)
      return data.spans.findIndex((span) => `trace:${String(span.seq)}` === sel.id)
    }
    const a = indexOf(selection[0]!)
    const b = indexOf(selection[1]!)
    if (a < 0 || b < 0) return null
    const left = Math.min(a, b)
    const right = Math.max(a, b)
    const count = cellCount(track)
    return { left: (left / count) * 100, width: ((right - left + 1) / count) * 100 }
  }

  const snapshotBand = band('snapshot')
  const traceBand = band('trace')
  const spanCount = data.spans.length

  return React.createElement('div', { className: 'srw-tl-strip' },
    // 快照轨。
    React.createElement('div', { className: 'srw-tl-track', 'data-track': 'snapshot', onPointerDown: (event: React.PointerEvent) => { startDrag('snapshot', event) } },
      React.createElement('span', { className: 'srw-tl-trackLabel' }, '快照'),
      React.createElement('div', { className: 'srw-tl-cells' },
        data.checkpoints.map((point) => React.createElement('span', {
          key: point.id,
          className: 'srw-tl-cell',
          'data-phase': point.phase === 'end' ? 'end' : 'start',
          'data-degraded': point.degraded === true,
          title: `轮 ${String(point.turn)} ${point.phase === 'end' ? '轮末' : '轮起'}${point.degraded === true ? '（内容不可读）' : ''}`,
        })),
      ),
      snapshotBand !== null && React.createElement('div', {
        className: 'srw-tl-band',
        style: { left: `${String(snapshotBand.left)}%`, width: `${String(snapshotBand.width)}%` },
      }),
    ),
    // 调用轨（三泳道）。
    React.createElement('div', { className: 'srw-tl-track', 'data-track': 'trace', onPointerDown: (event: React.PointerEvent) => { startDrag('trace', event) } },
      React.createElement('span', { className: 'srw-tl-trackLabel' }, '调用'),
      React.createElement('div', { className: 'srw-tl-cells srw-tl-lanes' },
        [0, 1, 2].map((lane) => React.createElement('div', { key: lane, className: 'srw-tl-lane' },
          data.spans.filter((span) => span.lane === lane).map((span) => {
            const index = data.spans.indexOf(span)
            return React.createElement('span', {
              key: `${String(span.seq)}`,
              className: 'srw-tl-span',
              'data-kind': span.kind,
              'data-mutating': span.mutating === true,
              'data-error': span.error === true,
              title: `${span.kind === 'tool' ? (span.name ?? 'tool') : span.kind === 'user' ? '用户消息' : '助手消息'}${span.error === true ? '（失败）' : ''}`,
              style: {
                left: `${String((index / Math.max(1, spanCount)) * 100)}%`,
                width: `calc(${String((1 / Math.max(1, spanCount)) * 100)}% - 1px)`,
              },
            })
          }),
        )),
        // turn 刻度：边界 seq 之后的首个 span 槽位画竖线。
        data.turnBoundaries.map((seq) => {
          const index = data.spans.findIndex((span) => span.seq >= seq)
          if (index < 0) return null
          return React.createElement('span', {
            key: `tick:${String(seq)}`,
            className: 'srw-tl-tick',
            style: { left: `${String((index / Math.max(1, spanCount)) * 100)}%` },
          })
        }),
      ),
      traceBand !== null && React.createElement('div', {
        className: 'srw-tl-band',
        style: { left: `${String(traceBand.left)}%`, width: `${String(traceBand.width)}%` },
      }),
    ),
    draft !== null && React.createElement('div', { className: 'srw-tl-draftHint' },
      `松开以对比选中的 ${String(draft.right - draft.left + 1)} 个节点`),
  )
}

function TimelinePanel({ sessionId, onClose }: { readonly sessionId: string; readonly onClose: () => void }): React.ReactElement {
  const [data, setData] = React.useState<TimelineData | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [selection, setSelection] = React.useState<readonly Selection[]>([])
  const [range, setRange] = React.useState<RangeResult | null>(null)
  const [rangeLoading, setRangeLoading] = React.useState(false)
  const [rangeError, setRangeError] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set())
  const [restoredHint, setRestoredHint] = React.useState(false)

  const load = React.useCallback(() => {
    let active = true
    setLoadError(null)
    fetchJson(`${PATH}?sessionId=${encodeURIComponent(sessionId)}`)
      .then((body) => {
        if (!active) return
        const parsed = parseTimeline(body)
        if (parsed === null) {
          setLoadError('时间线数据格式无法识别')
          return
        }
        setData(parsed)
        // 上次查看记忆：节点仍存在才恢复，失配（检查点被淘汰等）静默丢弃。
        const lastView = loadLastView(sessionId)
        if (lastView === null) return
        const exists = (sel: Selection): boolean => sel.kind === 'checkpoint'
          ? parsed.checkpoints.some((point) => point.id === sel.id)
          : parsed.nodes.some((node) => `trace:${String(node.seq)}` === sel.id)
        if (exists(lastView.from) && exists(lastView.to)) {
          setSelection([lastView.from, lastView.to])
          setRestoredHint(true)
        }
      })
      .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false }
  }, [sessionId])
  React.useEffect(() => load(), [load])

  // Esc 关闭（与消息回退对话框同一交互约定）。
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const mixed = selection.length === 2 && selection[0]!.kind !== selection[1]!.kind
  const ready = selection.length === 2 && !mixed

  const compare = React.useCallback(() => {
    if (data === null || selection.length !== 2 || mixed) return
    const [first, second] = selection as readonly [Selection, Selection]
    setRange(null)
    setRangeError(null)
    setExpanded(new Set())
    setRangeLoading(true)
    fetchJson(`${PATH}?sessionId=${encodeURIComponent(sessionId)}&from=${encodeURIComponent(first.id)}&to=${encodeURIComponent(second.id)}`)
      .then((body) => {
        const parsed = parseRange(body)
        if (parsed === null) {
          setRangeError('对比数据格式无法识别')
          return
        }
        setRange(parsed)
        saveLastView(sessionId, [first, second])
        setRestoredHint(false)
      })
      .catch((error: unknown) => setRangeError(error instanceof Error ? error.message : String(error)))
      .finally(() => setRangeLoading(false))
  }, [data, sessionId, selection, mixed])

  const toggleSelect = (entry: Selection) => {
    setRange(null)
    setRangeError(null)
    setRestoredHint(false)
    setSelection((current) => {
      const exists = current.some((item) => item.kind === entry.kind && item.id === entry.id)
      if (exists) return current.filter((item) => !(item.kind === entry.kind && item.id === entry.id))
      const next = [...current, entry]
      return next.length > 2 ? next.slice(next.length - 2) : next
    })
  }

  /** 下拉双槽写入：两槽模型（空槽填充、满槽替换/移除），与点选同一 state。 */
  const setSlot = (index: 0 | 1, entry: Selection | null) => {
    setRange(null)
    setRangeError(null)
    setRestoredHint(false)
    setSelection((current) => {
      const base = [...current]
      if (entry === null) {
        base.splice(index, 1)
        return base
      }
      if (index < base.length) base[index] = entry
      else if (base.length < 2) base.push(entry)
      else base[1] = entry
      return base
    })
  }

  const renderSelect = (label: string, slot: 0 | 1) => React.createElement('label', { className: 'srw-tl-select', key: label },
    React.createElement('span', null, label),
    React.createElement('select', {
      value: selection[slot]?.id ?? '',
      onChange: (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value
        if (value === '') {
          setSlot(slot, null)
          return
        }
        setSlot(slot, value.startsWith('rp_')
          ? { kind: 'checkpoint', id: value }
          : { kind: 'trace', id: value })
      },
    },
      // 空值选项必须在首位（React 受控 select 的 value='' 约定）。
      React.createElement('option', { value: '' }, '选择节点'),
      data === null ? [] : selectionOptions(data).map((option) => React.createElement('option', { key: option.value, value: option.value }, option.label)),
    ),
  )

  const toggleExpanded = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const newestId = data !== null && data.checkpoints.length > 0
    ? data.checkpoints.reduce((last, point) => ((point.createdAt ?? 0) >= (data.checkpoints.find((entry) => entry.id === last)?.createdAt ?? 0) ? point.id : last), data.checkpoints[0]!.id)
    : undefined

  return React.createElement('div', {
    className: 'srw-overlay',
    onPointerDown: (event: React.PointerEvent) => { if (event.target === event.currentTarget) onClose() },
  },
    React.createElement('div', { className: 'srw-tl-dialog' },
      React.createElement('div', { className: 'srw-tl-head' },
        React.createElement('span', null, '文件时间线'),
        React.createElement('button', { type: 'button', className: 'srw-tl-close', onClick: onClose, 'aria-label': '关闭' }, '×'),
      ),
      React.createElement('div', { className: 'srw-tl-bar' },
        React.createElement('span', null,
          mixed ? '快照检查点与轨迹节点不可混选'
            : selection.length === 2 ? '已选两点，点击「对比」查看区间差异'
              : selection.length === 1 ? '再点选一个同类节点作为区间另一端'
                : '点选两个节点（快照检查点或工具调用）做区间对比'),
        React.createElement('button', { type: 'button', onClick: compare, disabled: !ready || rangeLoading },
          rangeLoading ? '对比中…' : '对比'),
        React.createElement('button', { type: 'button', onClick: () => { setSelection([]); setRange(null); setRangeError(null); setRestoredHint(false) }, disabled: selection.length === 0 }, '清除选区'),
      ),
      data !== null && React.createElement('div', { className: 'srw-tl-selects', key: 'selects' },
        renderSelect('起', 0),
        renderSelect('终', 1),
      ),
      restoredHint && React.createElement('p', { className: 'srw-tl-status', key: 'restored' }, '已恢复上次查看的位置；重新选择后将更新记忆。'),
      loadError !== null && React.createElement('p', { className: 'srw-tl-error' }, `时间线加载失败：${loadError}`),
      React.createElement('div', { className: 'srw-tl-body' },
        data === null && loadError === null && React.createElement('p', { className: 'srw-tl-status' }, '加载中…'),
        data !== null && [
          React.createElement(TraceStrip, {
            key: 'strip',
            data,
            selection,
            onCommit: (a: Selection, b: Selection) => {
              setSelection([a, b])
              setRange(null)
              setRangeError(null)
              setRestoredHint(false)
            },
            onSingle: (entry: Selection) => {
              setSelection([entry])
              setRange(null)
              setRangeError(null)
              setRestoredHint(false)
            },
          }),
          React.createElement('span', { className: 'srw-tl-section', key: 'cp-title' }, '快照检查点（每轮起/轮末自动捕获）'),
          data.checkpoints.length === 0 && React.createElement('p', { className: 'srw-tl-status', key: 'cp-empty' }, '暂无检查点（可能未开启自动检查点）。'),
          React.createElement('div', { className: 'srw-tl-list', key: 'cp-list' },
            data.checkpoints.map((point) => React.createElement('div', {
              key: point.id,
              className: 'srw-tl-row',
              'data-selected': selection.some((item) => item.kind === 'checkpoint' && item.id === point.id),
              'data-degraded': point.degraded === true,
              'data-head': point.id === newestId,
              onClick: () => toggleSelect({ kind: 'checkpoint', id: point.id }),
            },
              React.createElement('span', { className: 'srw-tl-dot' }),
              React.createElement('span', { className: 'srw-tl-main' },
                React.createElement('code', null,
                  `轮 ${String(point.turn)} ${point.phase === 'end' ? '轮末' : '轮起'}`,
                  point.degraded === true ? ' ⚠ 内容不可读' : '',
                  point.id === newestId ? ' (head)' : ''),
                (point.intent ?? []).map((item) => React.createElement('span', {
                  key: `${item.seq}`,
                  className: 'srw-tl-chip',
                  title: `${item.tool} ${item.path}`,
                }, `${item.tool} ${item.path}`)),
              ),
              React.createElement('span', { className: 'srw-tl-meta' },
                `${String(point.fileCount ?? 0)} 文件`,
                typeof point.createdAt === 'number' ? ` · ${new Date(point.createdAt).toLocaleTimeString()}` : ''),
            ))),
          React.createElement('span', { className: 'srw-tl-section', key: 'tr-title' }, '工具调用轨迹（内容重放区间；终端与外部写盘不可见）'),
          data.nodes.length === 0 && React.createElement('p', { className: 'srw-tl-status', key: 'tr-empty' }, '本会话还没有工具调用。'),
          React.createElement('div', { className: 'srw-tl-list', key: 'tr-list' },
            data.nodes.map((node) => React.createElement('div', {
              key: `trace:${String(node.seq)}`,
              className: 'srw-tl-row',
              'data-mutating': node.mutating,
              'data-error': node.error === true,
              'data-selected': selection.some((item) => item.kind === 'trace' && item.id === `trace:${String(node.seq)}`),
              onClick: () => toggleSelect({ kind: 'trace', id: `trace:${String(node.seq)}` }),
            },
              React.createElement('span', { className: 'srw-tl-dot' }),
              React.createElement('span', { className: 'srw-tl-main' },
                React.createElement('code', null, `#${String(node.seq)} ${node.name}`, node.path === undefined ? '' : ` ${node.path}`),
                node.error === true && React.createElement('span', { className: 'srw-tl-chip' }, '失败')),
            ))),
        ],
        range !== null && React.createElement(RangeView, { key: 'range', result: range, expanded, onToggle: toggleExpanded }),
      ),
    ),
  )
}

/** 区间对比结果：轨迹模式全文自带，快照模式逐文件懒取。 */
function RangeView({ result, expanded, onToggle }: {
  readonly result: RangeResult
  readonly expanded: ReadonlySet<string>
  readonly onToggle: (key: string) => void
}): React.ReactElement {
  if (result.changes.length === 0) {
    return React.createElement('p', { className: 'srw-tl-status' }, '区间内没有文件变更。')
  }
  return React.createElement('div', { className: 'srw-tl-diff' },
    result.mode === 'trace' && (result.notes ?? []).map((note, index) =>
      React.createElement('p', { className: 'srw-tl-notes', key: String(index) }, note)),
    result.changes.map((change) => {
      const key = `${result.mode}:${change.path}`
      const isOpen = expanded.has(key)
      const counts = change.added === undefined && change.removed === undefined
        ? ''
        : ` +${String(change.added ?? 0)} −${String(change.removed ?? 0)}`
      return React.createElement('div', { className: 'srw-tl-file', key },
        React.createElement('div', { className: 'srw-tl-file-head', onClick: () => onToggle(key) },
          React.createElement('code', null, change.path),
          React.createElement('span', { className: 'srw-tl-meta' },
            `${kindLabel(change.kind)}${counts}`,
            result.mode === 'checkpoint' && !isOpen ? ' · 点击加载全文' : '')),
        isOpen && React.createElement('div', { className: 'srw-tl-file-body' },
          React.createElement(FileDiff, { result, change })),
      )
    }),
  )
}

function FileDiff({ result, change }: { readonly result: RangeResult; readonly change: RangeChangeView }): React.ReactElement | null {
  const [diff, setDiff] = React.useState<readonly ProducedFileDiff[] | 'unavailable' | null>(null)
  React.useEffect(() => {
    let active = true
    setDiff(null)
    if (result.mode === 'trace') {
      // 轨迹模式：全文随响应自带；before/after 缺失 = 二进制或超限。
      if (change.before === null && change.after === null) {
        setDiff('unavailable')
        return
      }
      setDiff([{ path: change.path, oldText: change.before ?? null, newText: change.after ?? '' }])
      return
    }
    // 快照模式：懒取两侧全文（方向 = from → to，与 fs-changes 一致）。
    void Promise.all([
      change.kind === 'added' ? Promise.resolve(null) : fetchCheckpointFileContent(result.from, change.path, result.cwd),
      change.kind === 'deleted' ? Promise.resolve('') : fetchCheckpointFileContent(result.to, change.path, result.cwd),
    ]).then(([before, after]) => {
      if (!active) return
      if (before === null && after === null) setDiff('unavailable')
      else setDiff([{ path: change.path, oldText: before, newText: after ?? '' }])
    })
    return () => { active = false }
  }, [result, change])
  if (diff === null) return React.createElement('p', { className: 'srw-tl-status' }, '加载全文…')
  if (diff === 'unavailable') return React.createElement('p', { className: 'srw-tl-status' }, '内容不可用（二进制文件或超出预览上限）。')
  return React.createElement(UnifiedDiff, {
    diffs: diff,
    contextLines: 3,
    showCopyButton: true,
    navigation: true,
    labels: {
      copy: '复制差异',
      copied: '已复制',
      showUnchanged: (count: number) => `显示 ${String(count)} 行未变更内容`,
      hideUnchanged: (count: number) => `折叠 ${String(count)} 行未变更内容`,
      hunkN: (n: number) => `块 ${String(n)}`,
      hunkInclude: '勾选的块参与撤销/重做',
    },
  })
}

function kindLabel(kind: string): string {
  if (kind === 'added') return '新增'
  if (kind === 'deleted') return '删除'
  return '修改'
}
