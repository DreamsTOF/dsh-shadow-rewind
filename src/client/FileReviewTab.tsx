// FileReviewTab: the better-sidebar tab body. It lists every file the agent
// changed in THIS session (grouped by turn), renders line-level red/green
// diffs inline, and offers per-turn / per-file undo+reapply through the
// package's Host file-review Typert remote. All derivation rides the client
// runtime's finalized conversation snapshot — nothing is injected into the
// chat flow (that was the style-conflict source this port removes).

import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions, SessionFace, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FileReviewAction, FileReviewFileState, FileReviewRequest, FileReviewResult,
  RecordedMutation, RecordedRequest, RecordedResult,
} from '../file-review/change-types.ts'
import {
  basename, deriveSessionChanges, deriveSessionRoots, mergeRecordedTurns,
  resolveSessionPath, type SessionFileChange, type TurnFileChanges,
} from './session-changes.ts'
import { summarizeDiffs, UnifiedDiff, type UnifiedDiffStats } from './UnifiedDiff.tsx'
import { fetchSubsetPlan, pathsTooLong } from './subset-plan.ts'
import { t } from './locales.ts'
import css from './FileReviewTab.module.css'

const SUCCESS_NOTICE_DURATION = 3000
const ERROR_NOTICE_DURATION = 8000

/** Tab component props (a narrowing of better-sidebar's TabComponentProps). */
export interface FileReviewTabProps {
  readonly ctx: Context
  readonly sessionId: string
  readonly cwd: string | undefined
  /** Active tab + open panel; live status inspection pauses while false. */
  readonly visible: boolean
  /**
   * The sidebar tab handle. `meta.expandPaths` (string[]) is the deep link
   * the chat turn-tail row writes via updateTab/openTab: a fresh meta
   * reference replays as "expand those files' diffs and scroll to the first".
   */
  readonly tab: { readonly meta?: unknown }
}

interface FileReviewRemote {
  status(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
  apply(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
  recorded(request: RecordedRequest): Promise<RemoteResult<RecordedResult>>
}

interface Notice {
  readonly seq: number
  readonly tone: 'success' | 'error'
  readonly text: string
}

/** One flattened (turn, file) change unit used for status requests. */
interface FlatChange {
  readonly turn: number
  readonly path: string
  readonly diffs: SessionFileChange['diffs']
  /** Deleted paths stay listed but never reach the Host inspector. */
  readonly deleted?: true
}

/** State map key for one (turn, file) change group. */
function stateKey(turn: number, path: string): string {
  return `${turn}|${path}`
}

/** Deep-link scroll target: the turn group for whole-turn links, else the row. */
interface PendingScroll {
  /** File-row stateKey: the precise target and the section fallback. */
  readonly rowKey: string
  /** Turn number whose group tops the viewport for multi-file links. */
  readonly turn: number | null
}

/** 一个文件在本会话某轮的改动记录（文件级时间线节点；按轮升序累积）。 */
interface FileTurnEntry {
  readonly turn: number
  readonly live: boolean
  readonly deleted?: true
  readonly diffs: SessionFileChange['diffs']
}

/** 恢复窗口内一个路径的累计统计与最近改动轮次（恢复对话框 +/− 跳转用）。 */
interface PathWindowStats {
  readonly stats: UnifiedDiffStats
  readonly latestTurn: number
}

/** A change group is reversible only with complete contextual hunks. */
function isReversible(file: SessionFileChange): boolean {
  return file.diffs.length > 0 && file.diffs.every(diff =>
    diff.path === file.path
    && diff.oldText !== null
    && diff.oldText !== diff.newText
    && (diff.oldText !== '' || diff.oldStart !== undefined)
    && (diff.newText !== '' || diff.newStart !== undefined))
}

function addStats(left: UnifiedDiffStats, right: UnifiedDiffStats): UnifiedDiffStats {
  return { added: left.added + right.added, removed: left.removed + right.removed }
}

function Stats({ stats }: { readonly stats: UnifiedDiffStats }) {
  return (
    <span className={css.stats} aria-label={t('stats', {
      added: String(stats.added), removed: String(stats.removed),
    })}>
      <span className={css.added}>+{stats.added}</span>
      <span className={css.removed}>-{stats.removed}</span>
    </span>
  )
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="M8 5 4 9l4 4M4 9h7a5 5 0 0 1 5 5v1" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="m12 5 4 4-4 4M16 9H9a5 5 0 0 0-5 5v1" />
    </svg>
  )
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`${css.chevron} ${open ? css.chevronOpen : ''}`}
    >
      <path d="m7 5 5 5-5 5" />
    </svg>
  )
}

/** Per-(turn,file) host-inspected state badge; nothing renders for 'applied'. */
function StateBadge({ state }: { readonly state: FileReviewFileState | undefined }) {
  if (state === undefined || state === 'applied') return null
  const label = state === 'undone'
    ? t('stateUndone')
    : state === 'conflict'
      ? t('stateConflict')
      : state === 'unsupported'
        ? t('stateUnsupported')
        : t('stateError')
  const tone = state === 'undone'
    ? css.badgeUndone
    : state === 'unsupported'
      ? css.badgeMuted
      : css.badgeError
  return <span className={`${css.stateBadge} ${tone}`}>{label}</span>
}

/** Mounts the heavy diff renderer only when the row nears the viewport. */
function LazyDiff({ children }: { children: ReactNode }) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (inView) return
    const element = holderRef.current
    if (element === null) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setInView(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px 0px' })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [inView])
  return <div ref={holderRef}>{inView ? children : <div style={{ minHeight: '96px' }} />}</div>
}

// ── 每轮「从快照恢复此轮」对话框（走本插件宿主的 /shadow-rewind?turn= 分支）──

interface TurnRewindDialogProps {
  readonly sessionId: string
  readonly turn: number
  /** 恢复窗口（该轮起）内本会话对每个路径的累计 +/-；其它会话写入的路径没有
   * 客户端 diff 数据，因此没有条目（对话框里这些行不显示统计）。 */
  readonly windowStats: ReadonlyMap<string, PathWindowStats>
  /** 点击某路径的 +/-：跳到该文件最近一轮的差异（父级负责关闭对话框）。 */
  readonly onJumpToDiff: (turn: number, path: string) => void
  readonly onClose: () => void
  /** 恢复成功后回调（刷新 tab 的状态巡检）。 */
  readonly onRestored: () => void
}

/** `/shadow-rewind?turn=` 预览的浏览器侧形态（宽松解析）。 */
interface TurnRewindPreview {
  readonly status: 'ready' | 'pending' | 'skipped' | 'failed' | 'missing'
  readonly checkpointId?: string
  readonly planId?: string
  readonly confirmation?: string
  /** 恢复语义模式：current-wins=以当前为准（整树），symmetric=对称（勾选式子集）。 */
  readonly mode?: 'current-wins' | 'symmetric'
  readonly totalChanges: number
  readonly changes: readonly {
    readonly path: string
    readonly kind: string
    /** 对称模式归属：'target' | 'multi' | 'unknown' | 其它会话 id。 */
    readonly owner?: string
    /** 对称模式默认勾选（只属于目标会话的路径）。 */
    readonly autoSelect?: boolean
  }[]
  readonly activeSessionIds: readonly string[]
  /** 写入闸开启时的分诊：真正阻塞恢复的会话（请求者自身 / 当前所有者）。 */
  readonly restoreBlocked?: boolean
  readonly gatedSessionIds?: readonly string[]
  readonly skippedPaths: readonly { readonly path: string; readonly reason: string }[]
  readonly reason?: string
  readonly error?: string
  /** 分页（对称模式拉全清单时使用）。 */
  readonly truncated?: boolean
  readonly offset?: number
}

function decodeTurnPreview(value: unknown): TurnRewindPreview {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const status = record.status === 'ready' || record.status === 'pending'
    || record.status === 'skipped' || record.status === 'failed' || record.status === 'missing'
    ? record.status
    : 'missing'
  const changes = Array.isArray(record.changes)
    ? record.changes.map((entry) => {
      const item = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {}
      return {
        path: typeof item.path === 'string' ? item.path : '',
        kind: typeof item.kind === 'string' ? item.kind : 'modified',
        ...(typeof item.owner === 'string' ? { owner: item.owner } : {}),
        ...(item.autoSelect === true ? { autoSelect: true as const } : {}),
      }
    }).filter(change => change.path !== '')
    : []
  return {
    status,
    ...(typeof record.checkpointId === 'string' ? { checkpointId: record.checkpointId } : {}),
    ...(typeof record.planId === 'string' ? { planId: record.planId } : {}),
    ...(typeof record.confirmation === 'string' ? { confirmation: record.confirmation } : {}),
    ...(record.mode === 'symmetric' || record.mode === 'current-wins' ? { mode: record.mode } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    ...(typeof record.restoreBlocked === 'boolean' ? { restoreBlocked: record.restoreBlocked } : {}),
    ...(Array.isArray(record.gatedSessionIds)
      ? { gatedSessionIds: record.gatedSessionIds.filter((id): id is string => typeof id === 'string') }
      : {}),
    totalChanges: typeof record.totalChanges === 'number' ? record.totalChanges : changes.length,
    changes,
    truncated: record.truncated === true,
    ...(typeof record.offset === 'number' ? { offset: record.offset } : {}),
    activeSessionIds: Array.isArray(record.activeSessionIds)
      ? record.activeSessionIds.filter((id): id is string => typeof id === 'string')
      : [],
    skippedPaths: Array.isArray(record.skippedPaths)
      ? record.skippedPaths.map((entry) => {
        const item = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
          ? entry as Record<string, unknown>
          : {}
        return {
          path: typeof item.path === 'string' ? item.path : '',
          reason: typeof item.reason === 'string' ? item.reason : '',
        }
      }).filter(skip => skip.path !== '')
      : [],
  }
}

/** 快照跳过原因的用户文案。 */
function skipReasonLabel(reason: string): string {
  if (reason === 'too-large') return t('skipTooLarge')
  if (reason === 'unsupported-type') return t('skipUnsupportedType')
  if (reason === 'read-failed') return t('skipReadFailed')
  return reason
}

/** 快照差异类别的用户文案（与回退对话框的 kindLabel 语义一致）。 */
function snapshotKindLabel(kind: string): string {
  switch (kind) {
    case 'added': return t('kindAdded')
    case 'deleted': return t('kindDeleted')
    case 'modified': return t('kindModified')
    case 'mode-changed': return t('kindModeChanged')
    case 'type-changed': return t('kindTypeChanged')
    default: return kind
  }
}

function TurnRewindDialog({ sessionId, turn, windowStats, onJumpToDiff, onClose, onRestored }: TurnRewindDialogProps) {
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<TurnRewindPreview | null>(null)
  const [applying, setApplying] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // 对称模式的勾选集（null = 非对称模式，整树恢复）。
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setStale(false)
    setError(null)
    setDone(false)
    try {
      const response = await fetch(`/shadow-rewind?sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}`, {
        headers: { accept: 'application/json' }, cache: 'no-store',
      })
      const value: unknown = await response.json()
      if (!response.ok) {
        const record = typeof value === 'object' && value !== null && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        if (record.code === 'RESTORE_POINT_NOT_FOUND') {
          setPreview(null)
          setError(t('snapshotMissing'))
          return
        }
        throw new Error(typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`)
      }
      const first = decodeTurnPreview(value)
      // 对称模式：勾选清单必须覆盖全部变更——自动按页拉全（带归属标签），
      // 然后以「只属于目标会话」的路径为默认勾选。
      if (first.status === 'ready' && first.mode === 'symmetric' && first.truncated) {
        const collected = [...first.changes]
        let offset = collected.length
        while (first.totalChanges > offset) {
          const pageResponse = await fetch(`/shadow-rewind?sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}&details=1&offset=${String(offset)}&limit=200`, {
            headers: { accept: 'application/json' }, cache: 'no-store',
          })
          const pageValue: unknown = await pageResponse.json()
          if (!pageResponse.ok) {
            const pageRecord = typeof pageValue === 'object' && pageValue !== null && !Array.isArray(pageValue)
              ? pageValue as Record<string, unknown> : {}
            throw new Error(typeof pageRecord.error === 'string' ? pageRecord.error : `HTTP ${String(pageResponse.status)}`)
          }
          const page = decodeTurnPreview(pageValue)
          if (page.status !== 'ready' || page.checkpointId !== first.checkpointId || page.offset !== offset) {
            throw new Error(t('snapshotStale'))
          }
          collected.push(...page.changes)
          offset += page.changes.length
          if (page.changes.length === 0) break
        }
        const merged: TurnRewindPreview = { ...first, changes: collected, truncated: false }
        setPreview(merged)
        setSelected(new Set(merged.changes.filter(change => change.autoSelect === true).map(change => change.path)))
        return
      }
      setPreview(first)
      setSelected(first.status === 'ready' && first.mode === 'symmetric'
        ? new Set(first.changes.filter(change => change.autoSelect === true).map(change => change.path))
        : null)
    } catch (caught) {
      setError(`${t('snapshotFailed')}: ${caught instanceof Error ? caught.message : String(caught)}`)
    } finally {
      setLoading(false)
    }
  }, [sessionId, turn])

  useEffect(() => { void load() }, [load])

  const ready = preview !== null && preview.status === 'ready' ? preview : null
  // 阻塞判定：优先用服务端的写入闸分诊（restoreBlocked），旧协议回退到
  // activeSessionIds 计数。
  const blocked = ready !== null
    && (ready.restoreBlocked ?? ready.activeSessionIds.length > 0)
  const gatedRunning = ready?.gatedSessionIds?.length ?? 0
  const symmetric = ready?.mode === 'symmetric'
  const selectedCount = selected?.size ?? 0
  const allSelected = symmetric && ready !== null && selected !== null
    && selected.size >= ready.changes.length && ready.changes.length > 0

  const togglePath = useCallback((path: string) => {
    setSelected((current) => {
      if (current === null) return current
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const setAllPaths = useCallback((selectAll: boolean) => {
    setSelected((current) => {
      if (current === null) return current
      if (!selectAll) return new Set<string>()
      const readyNow = preview !== null && preview.status === 'ready' ? preview : null
      return readyNow === null ? current : new Set(readyNow.changes.map(change => change.path))
    })
  }, [preview])

  const canApply = ready !== null && !loading && !applying && !done && !stale && !blocked
    && ready.totalChanges > 0
    && (!symmetric || selectedCount > 0)
    && ready.checkpointId !== undefined && ready.planId !== undefined && ready.confirmation !== undefined

  const apply = useCallback(async () => {
    if (ready === null || !canApply) return
    if (ready.checkpointId === undefined || ready.planId === undefined || ready.confirmation === undefined) return
    setApplying(true)
    setError(null)
    try {
      let planId = ready.planId
      let confirmation = ready.confirmation
      // 对称模式且未全选：先铸造只覆盖勾选路径的子集计划（全套安全闸
      // 原样保留——确认串、TTL、逐路径 CAS 都随新计划走）。
      if (selected !== null && selected.size < ready.totalChanges) {
        const paths = ready.changes.filter(change => selected.has(change.path)).map(change => change.path)
        if (paths.length === 0) return
        if (pathsTooLong(paths)) throw new Error(t('pathsTooLong'))
        const subset = await fetchSubsetPlan(`sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}`, paths)
        planId = subset.planId
        confirmation = subset.confirmation
      }
      const response = await fetch('/shadow-rewind', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'code',
          sessionId,
          turn,
          checkpointId: ready.checkpointId,
          planId,
          confirmation,
        }),
      })
      const value: unknown = await response.json()
      if (!response.ok) {
        const record = typeof value === 'object' && value !== null && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        if (record.code === 'PLAN_STALE' || record.code === 'WORKSPACE_IN_USE') setStale(true)
        throw new Error(typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`)
      }
      setDone(true)
      onRestored()
    } catch (caught) {
      setError(`${t('snapshotFailed')}: ${caught instanceof Error ? caught.message : String(caught)}`)
    } finally {
      setApplying(false)
    }
  }, [ready, canApply, selected, sessionId, turn, onRestored])

  // srw-* 对话框样式由本插件的会话回退面（rewind.ts）全局注入，直接复用，
  // 保证两个恢复入口的视觉与交互一致。
  return (
    <div className="srw-overlay" role="dialog" aria-modal="true">
      <div className="srw-dialog">
        <div className="srw-dialog-head">
          <strong>{t('snapshotDialogTitle')}</strong>
          <button type="button" className="srw-trigger" onClick={onClose} aria-label={t('close')}>✕</button>
        </div>
        <div className="srw-content">
          <div className="srw-body">
            {loading && <p className="srw-status">{t('snapshotLoading')}</p>}
            {(preview?.status === 'pending') && <p className="srw-status">{t('snapshotLoading')}</p>}
            {(preview?.status === 'missing' || preview?.status === 'skipped') && (
              <p className="srw-error">{t('snapshotMissing')}</p>
            )}
            {preview?.status === 'failed' && (
              <p className="srw-error">{t('snapshotFailed')}: {preview.error ?? preview.reason ?? ''}</p>
            )}
            {ready !== null && [
              <p className="srw-warning" key="warn">{t('snapshotDialogWarn', { n: turn })}</p>,
              <div className="srw-summary" key="summary">
                <strong>
                  {symmetric
                    ? t('snapshotTotalSelected', { count: selectedCount, total: ready.totalChanges })
                    : t('snapshotTotal', { count: ready.totalChanges })}
                </strong>
              </div>,
              symmetric && <p className="srw-status" key="hint">{t('modeSymmetricHint')}</p>,
              blocked && <p className="srw-error" key="blocked">{t('snapshotBlocked')}</p>,
              gatedRunning > 0 && <p className="srw-warning" key="gated">{t('snapshotGatedRunning', { n: gatedRunning })}</p>,
              ready.skippedPaths.length > 0 && (
                <div className="srw-skipped" key="skipped">
                  <div>{t('snapshotSkipped')}</div>
                  {ready.skippedPaths.map(skip => (
                    <div key={skip.path}>
                      <code>{skip.path}</code>（{skipReasonLabel(skip.reason)}）
                    </div>
                  ))}
                </div>
              ),
              stale && <p className="srw-error" key="stale">{t('snapshotStale')}</p>,
              ready.totalChanges === 0 && <p className="srw-status" key="nochanges">{t('snapshotNoChanges')}</p>,
              ready.changes.length > 0 && (
                <div className="srw-files" key="files">
                  {symmetric && (
                    <label className="srw-select-all" key="selectall">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(event) => { setAllPaths(event.target.checked) }}
                      />
                      {t('selectAll')}
                    </label>
                  )}
                  {ready.changes.map(change => {
                    const badge = change.owner === undefined || change.owner === 'target'
                      ? null
                      : change.owner === 'multi'
                        ? t('ownerMulti')
                        : change.owner === 'unknown'
                          ? t('ownerUnknown')
                          : t('ownerSession', { id: change.owner.length > 12 ? `${change.owner.slice(0, 12)}…` : change.owner })
                    const windowEntry = windowStats.get(change.path)
                    return (
                      <div className="srw-file" key={change.path}>
                        {symmetric && (
                          <input
                            type="checkbox"
                            checked={selected?.has(change.path) ?? false}
                            onChange={() => { togglePath(change.path) }}
                          />
                        )}
                        <code>{change.path}</code>
                        {badge !== null && <span className="srw-kind">{badge}</span>}
                        <span className="srw-kind">{snapshotKindLabel(change.kind)}</span>
                        {windowEntry !== undefined && (
                          <button
                            type="button"
                            className={css.statsButton}
                            title={t('viewDiff', { n: windowEntry.latestTurn })}
                            onClick={(event) => {
                              event.stopPropagation()
                              onJumpToDiff(windowEntry.latestTurn, change.path)
                            }}
                          >
                            <Stats stats={windowEntry.stats} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ),
            ]}
            {done && <p className="srw-status">{t('snapshotDone')}</p>}
            {error !== null && <p className="srw-error">{error}</p>}
            {!loading && (ready === null || stale || blocked) && !done && (
              <button type="button" className="srw-retry" onClick={() => { void load() }}>
                {t('snapshotRetry')}
              </button>
            )}
          </div>
        </div>
        <div className="srw-foot">
          <button type="button" onClick={onClose} disabled={applying}>{t('cancel')}</button>
          <button type="button" onClick={() => { void apply() }} disabled={!canApply}>
            {applying ? t('snapshotApplying') : done ? t('close') : t('snapshotApply')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 文件级时间线：一个文件在本会话被改动的每一轮；点 +/- 跳到该轮差异 ──

interface FileTimelineDialogProps {
  readonly path: string
  /** 该文件的逐轮改动（轮次升序）。 */
  readonly entries: readonly FileTurnEntry[]
  /** 点击某轮的 +/- 统计：父级关闭对话框并滚动到那一轮的差异。 */
  readonly onPick: (turn: number) => void
  readonly onClose: () => void
}

function FileTimelineDialog({ path, entries, onPick, onClose }: FileTimelineDialogProps) {
  return (
    <div className="srw-overlay" role="dialog" aria-modal="true">
      <div className="srw-dialog">
        <div className="srw-dialog-head">
          <strong>{t('timelineTitle')}</strong>
          <button type="button" className="srw-trigger" onClick={onClose} aria-label={t('close')}>✕</button>
        </div>
        <div className="srw-content">
          <div className="srw-body">
            <p className={css.timelinePath}>{path}</p>
            {entries.length === 0
              ? <p className="srw-status">{t('timelineEmpty')}</p>
              : [
                <p className="srw-status" key="hint">{t('timelineHint')}</p>,
                <ul className={css.timelineList} key="list">
                  {[...entries].reverse().map((entry) => {
                    const stats = summarizeDiffs(entry.diffs)
                    return (
                      <li className={css.timelineItem} key={entry.turn}>
                        <span className={css.timelineDot} aria-hidden="true" />
                        <span className={css.turnTitle}>{t('turn', { n: entry.turn })}</span>
                        {entry.live && <span className={css.liveBadge}>{t('turnLive')}</span>}
                        {entry.deleted === true
                          ? <span className={css.deletedBadge}>{t('deleted')}</span>
                          : entry.diffs.length === 0
                            ? <span className={css.turnCount}>{t('timelineNoDiff')}</span>
                            : (
                              <button
                                type="button"
                                className={css.statsButton}
                                title={t('viewDiff', { n: entry.turn })}
                                onClick={() => { onPick(entry.turn) }}
                              >
                                <Stats stats={stats} />
                              </button>
                            )}
                      </li>
                    )
                  })}
                </ul>,
              ]}
          </div>
        </div>
        <div className="srw-foot">
          <button type="button" onClick={onClose}>{t('close')}</button>
        </div>
      </div>
    </div>
  )
}

/** The sidebar tab body: per-turn change groups with inline diffs and undo. */
export function FileReviewTab({ ctx, sessionId, cwd, visible, tab }: FileReviewTabProps) {
  const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
  const [states, setStates] = useState<ReadonlyMap<string, FileReviewFileState>>(() => new Map())
  const [statusPending, setStatusPending] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [tick, setTick] = useState(0)
  // 块级选择：stateKey → 选中 hunk 下标集合；缺省（无条目）= 隐式全选。
  const [hunkSelection, setHunkSelection] = useState<ReadonlyMap<string, ReadonlySet<number>>>(() => new Map())
  // 打开「从快照恢复此轮」对话框的回合号；null = 关闭。
  const [rewindTurn, setRewindTurn] = useState<number | null>(null)
  // 打开文件级时间线对话框的路径；null = 关闭。
  const [timelinePath, setTimelinePath] = useState<string | null>(null)
  const noticeSeqRef = useRef(0)
  const noticeTimerRef = useRef<number | null>(null)

  // Live conversation snapshot for THIS session (uSES over the Session face).
  const session: SessionFace | undefined = sessions.binding(sessionId as SessionId)?.session
  const subscribe = useCallback(
    (listener: () => void) => session?.subscribe(listener) ?? (() => {}),
    [session],
  )
  const snapshot = useSyncExternalStore(subscribe, () => session?.getSnapshot() ?? null)

  // Code Mode (run_code) roots and their Host-recorded mutations: nested
  // dispatches carry no reuseable views, so each root's file changes are
  // fetched async and merged into the snapshot-derived turns below. The
  // fetch re-arms on the root set (a new run_code turn) or a manual refresh.
  const roots = useMemo(
    () => (snapshot === null ? [] : deriveSessionRoots(snapshot)),
    [snapshot],
  )
  const rootsKey = useMemo(
    () => roots.map(root => root.rootCallId).join('|'),
    [roots],
  )
  const [recorded, setRecorded] = useState<readonly RecordedMutation[]>(() => [])
  useEffect(() => {
    if (!visible || roots.length === 0) return
    let active = true
    const timer = window.setTimeout(() => {
      const scope = sessions.scope(sessionId as SessionId)
      const remote = scope?.get('remote.fileReview') as FileReviewRemote | undefined
      if (scope === undefined || remote === undefined) { active = false; return }
      remote.recorded({ rootCallIds: roots.map(root => root.rootCallId) })
        .then((result) => {
          if (!result.ok || !active) return
          setRecorded(result.value.mutations)
        })
        .catch(() => {
          // Transient fetch failure: keep the previous record; the next
          // snapshot / refresh round retries.
        })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rootsKey, tick, sessions, sessionId])

  const turns = useMemo(
    () => mergeRecordedTurns(deriveSessionChanges(snapshot), roots, recorded),
    [snapshot, roots, recorded],
  )
  const flat = useMemo<FlatChange[]>(
    () => turns.flatMap(turn => turn.files.map(file => ({
      turn: turn.turn, path: file.path, diffs: file.diffs,
      ...(file.deleted === true ? { deleted: true as const } : {}),
    }))),
    [turns],
  )
  // Deleted entries have nothing to inspect or toggle on the Host side.
  const inspectable = useMemo(
    () => flat.filter(item => item.deleted !== true),
    [flat],
  )
  // Stable content key: the inspect effect re-fires only when the change SET
  // changes, not on every token-flush snapshot identity bump.
  const flatKey = useMemo(
    () => flat.map(item => `${item.turn}|${item.path}|${item.diffs.length}`).join(';'),
    [flat],
  )
  const flatRef = useRef(flat)
  flatRef.current = flat

  // Deep-link plumbing: file-row elements by stateKey and turn-group sections
  // by turn number for scrollIntoView, the last replayed meta reference, and a
  // pending scroll target.
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const turnRefs = useRef(new Map<number, HTMLElement>())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const lastMetaRef = useRef<unknown>(undefined)
  const pendingScrollRef = useRef<PendingScroll | null>(null)

  // Sidebar-tab deep link: the chat row's 审查 button (and per-file chips)
  // land here as `tab.meta.expandPaths`. A NEW meta reference replays the
  // expansion — merging into the user's own expanded set, never replacing it
  // — and queues a scroll that lands the link's target at the top of the tab
  // body. An unchanged reference (re-renders from unrelated sidebar state)
  // never re-grabs the user's manual expand/collapse state.
  useEffect(() => {
    const meta = tab.meta
    if (meta === lastMetaRef.current) return
    lastMetaRef.current = meta
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return
    const raw = (meta as { expandPaths?: unknown; turn?: unknown }).expandPaths
    if (!Array.isArray(raw)) return
    const paths = raw.filter((value): value is string => typeof value === 'string')
    if (paths.length === 0) return
    const turnNo = (meta as { turn?: unknown }).turn
    const targetTurn = typeof turnNo === 'number' && Number.isInteger(turnNo) ? turnNo : undefined
    // With a turn anchor only THAT turn's rows expand — a path that recurs in
    // other turns stays collapsed there; without one, every occurrence expands
    // (legacy meta shape).
    const matches = (item: FlatChange): boolean =>
      paths.includes(item.path) && (targetTurn === undefined || item.turn === targetTurn)
    setExpanded((current) => {
      const next = new Set(current)
      for (const item of flatRef.current) {
        if (matches(item)) next.add(stateKey(item.turn, item.path))
      }
      return next
    })
    const first = flatRef.current.find(item => matches(item))
    // Multi-path links (the 审查 button) target the turn group so the whole
    // review leads the viewport; single-path links (a file chip) target that
    // file's row. An unmatched link leaves nothing pending.
    pendingScrollRef.current = first === undefined ? null : {
      rowKey: stateKey(first.turn, first.path),
      turn: paths.length > 1 ? first.turn : null,
    }
  }, [tab.meta])

  // Scroll the deep-linked target to the TOP of the tab body — aligning to
  // the center left long reviews straddling the viewport, reading like a
  // miss. Whole-turn links resolve to the turn group (its header first);
  // single-file links to that file's row, which is also the fallback when
  // the section is not mounted. The target stays pending while its element
  // cannot be found (the session snapshot may still be streaming in), so
  // `flatKey` re-arms the scroll once the rows mount, and `visible` defers
  // it while the panel is still opening. The delayed second call covers the
  // diff bodies mounting one layout pass after the expansion commit.
  //
  // The scroll is computed and dispatched on the tab's OWN body only:
  // element.scrollIntoView({ block: 'start' }) scrolls EVERY scrollable
  // ancestor by specification, and in the sidebar panel that drags outer
  // containers along — the panel's tab-strip header rides above the body
  // inside one of them and gets scrolled out of view (issue #4). Manual
  // container math can never move anything but this body.
  useEffect(() => {
    if (!visible) return
    const pending = pendingScrollRef.current
    if (pending === null) return
    const element = (pending.turn !== null ? turnRefs.current.get(pending.turn) : undefined)
      ?? rowRefs.current.get(pending.rowKey)
    if (element === undefined) return
    pendingScrollRef.current = null
    const scroll = () => {
      const container = bodyRef.current
      if (container === null) return
      const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top
      container.scrollTo({ top: container.scrollTop + delta - 8, behavior: 'smooth' })
    }
    scroll()
    const timer = window.setTimeout(scroll, 150)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, expanded, tab.meta, flatKey])

  const showNotice = useCallback((tone: Notice['tone'], text: string) => {
    noticeSeqRef.current += 1
    const seq = noticeSeqRef.current
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(
      () => { setNotice(current => current?.seq === seq ? null : current) },
      tone === 'success' ? SUCCESS_NOTICE_DURATION : ERROR_NOTICE_DURATION,
    )
    setNotice({ seq, tone, text })
  }, [])

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  // 写入闸运行时开关（宿主全局，不持久化；重启回到配置初值）。
  // 挂载时读取宿主状态；端点不可用（旧版宿主）时按钮保持禁用。
  const [gateOn, setGateOn] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    fetch('/shadow-rewind/gate', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then((response) => response.json())
      .then((value: unknown) => {
        if (!active) return
        const record = typeof value === 'object' && value !== null && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        if (typeof record.enabled === 'boolean') setGateOn(record.enabled)
      })
      .catch(() => { /* 端点不可用：按钮保持禁用 */ })
    return () => { active = false }
  }, [])
  const toggleGate = useCallback(() => {
    const next = !(gateOn ?? true)
    fetch('/shadow-rewind/gate', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      return response.json() as Promise<unknown>
    }).then((value) => {
      const record = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown> : {}
      if (typeof record.enabled !== 'boolean') throw new Error('invalid response')
      setGateOn(record.enabled)
      showNotice('success', record.enabled ? t('gateTitleOn') : t('gateTitleOff'))
    }).catch((error: unknown) => {
      showNotice('error', `${t('gateToggleFailed')}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }, [gateOn, showNotice])

  // The Remote invocation path mirrors dsh-file-review: session scopes are
  // minted by the client runtime and cannot statically inject namespaces
  // contributed later, so the namespace rides ctx.get on the session scope.
  const invoke = useCallback(async (
    method: 'status' | 'apply',
    request: FileReviewRequest,
  ): Promise<FileReviewResult> => {
    const scope = sessions.scope(sessionId as SessionId)
    if (scope === undefined) throw new Error(t('sessionUnavailable'))
    const remote = scope.get('remote.fileReview') as FileReviewRemote | undefined
    if (remote === undefined) throw new Error(t('remoteUnavailable'))
    const result = await remote[method](request)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }, [sessions, sessionId])

  // Host-side state inspection: which recorded changes are still applied,
  // already undone, or in conflict. Paused while the tab is not visible.
  useEffect(() => {
    if (!visible || flat.length === 0) return
    let active = true
    setStatusPending(true)
    // Debounce trailing-edge: streaming turns keep bumping flatKey per hunk;
    // only one host round-trip survives a 300ms quiet window.
    const timer = window.setTimeout(() => {
      const request: FileReviewRequest = {
        action: 'undo',
        files: inspectable.map(item => ({ path: item.path, diffs: item.diffs })),
      }
      invoke('status', request).then((result) => {
        if (!active) return
        setStates(() => {
          const next = new Map<string, FileReviewFileState>()
          inspectable.forEach((item, index) => {
            const file = result.files[index]
            if (file !== undefined) next.set(stateKey(item.turn, item.path), file.state)
          })
          return next
        })
      }).catch(() => {
        // Transient inspection failure: the buttons stay usable — apply runs
        // the same Host-side checks again before touching disk.
      }).finally(() => {
        if (active) setStatusPending(false)
      })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, flatKey, tick, invoke])

  const mergeResultStates = useCallback((
    items: readonly FlatChange[],
    result: FileReviewResult,
  ) => {
    setStates((current) => {
      const next = new Map(current)
      items.forEach((item, index) => {
        const file = result.files[index]
        if (file !== undefined) next.set(stateKey(item.turn, item.path), file.state)
      })
      return next
    })
  }, [])

  /** Toggle one change set (a whole turn, or one file) undo ↔ redo. */
  const runToggle = useCallback((
    key: string,
    items: readonly FlatChange[],
    action: FileReviewAction,
  ) => {
    if (busyKey !== null || items.length === 0) return
    setBusyKey(key)
    invoke('apply', {
      action,
      files: items.map(item => ({ path: item.path, diffs: item.diffs })),
    }).then((result) => {
      mergeResultStates(items, result)
      const target = action === 'undo' ? 'undone' : 'applied'
      const failures = result.files.filter(file => file.state !== target)
      if (failures.length === 0) {
        showNotice('success', t(action === 'undo' ? 'undoSuccess' : 'redoSuccess'))
      } else {
        showNotice('error', t(action === 'undo' ? 'undoPartial' : 'redoPartial'))
      }
    }).catch((error: unknown) => {
      showNotice('error', `${t('toggleError')}: ${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => { setBusyKey(null) })
  }, [busyKey, invoke, mergeResultStates, showNotice])

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /** 更新一个 (turn, path) 的 hunk 勾选；回到全选时清除条目（隐式全选）。 */
  const changeHunkSelection = useCallback((key: string, total: number, next: ReadonlySet<number>) => {
    setHunkSelection((current) => {
      const map = new Map(current)
      if (next.size >= total) map.delete(key)
      else map.set(key, next)
      return map
    })
  }, [])

  /** 每文件按钮实际提交的 hunks：勾选子集（空子集时按钮已被禁用，不会到达）。 */
  const hunksForRequest = useCallback((file: SessionFileChange, key: string): SessionFileChange['diffs'] => {
    const selection = hunkSelection.get(key)
    if (selection === undefined) return file.diffs
    const subset = file.diffs.filter((_, index) => selection.has(index))
    return subset.length > 0 ? subset : file.diffs
  }, [hunkSelection])

  const selectedHunkCount = useCallback((file: SessionFileChange, key: string): number => {
    const selection = hunkSelection.get(key)
    return selection === undefined ? file.diffs.length : selection.size
  }, [hunkSelection])

  const openInEditor = useCallback((path: string) => {
    const absolute = resolveSessionPath(cwd, path)
    const sidebar = (ctx as unknown as {
      betterSidebar?: { openFile(scope: { sessionId: string; cwd?: string }, path: string, title?: string): void }
    }).betterSidebar
    sidebar?.openFile({ sessionId, ...(cwd !== undefined ? { cwd } : {}) }, absolute, basename(absolute))
  }, [ctx, cwd, sessionId])

  const totalStats = useMemo(() => flat.reduce<UnifiedDiffStats>(
    (total, item) => addStats(total, summarizeDiffs(item.diffs)),
    { added: 0, removed: 0 },
  ), [flat])

  // 文件级时间线数据：路径 → 逐轮改动（turns 本身按轮升序，逐条追加即升序）。
  const timelineForPath = useMemo(() => {
    const map = new Map<string, FileTurnEntry[]>()
    for (const turn of turns) {
      for (const file of turn.files) {
        const list = map.get(file.path) ?? []
        list.push({
          turn: turn.turn, live: turn.live, diffs: file.diffs,
          ...(file.deleted === true ? { deleted: true as const } : {}),
        })
        map.set(file.path, list)
      }
    }
    return map
  }, [turns])
  const timelineEntries = timelinePath === null ? [] : timelineForPath.get(timelinePath) ?? []

  // 按轮恢复窗口（第 rewindTurn 轮起）内本会话各路径的累计 +/- 与最近改动轮次。
  const windowStats = useMemo(() => {
    const map = new Map<string, PathWindowStats>()
    if (rewindTurn === null) return map
    for (const entry of flat) {
      if (entry.turn < rewindTurn) continue
      const existing = map.get(entry.path)
      const stats = summarizeDiffs(entry.diffs)
      map.set(entry.path, {
        stats: existing === undefined ? stats : addStats(existing.stats, stats),
        latestTurn: existing === undefined ? entry.turn : Math.max(existing.latestTurn, entry.turn),
      })
    }
    return map
  }, [flat, rewindTurn])

  /** 从时间线/恢复对话框跳到某个（轮, 文件）的差异：关掉浮层、展开该行并滚动
   * 到位（setExpanded 总是产生新 Set，滚动副作用必然重放）。 */
  const jumpToFile = useCallback((turn: number, path: string) => {
    setTimelinePath(null)
    setRewindTurn(null)
    const key = stateKey(turn, path)
    setExpanded((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })
    pendingScrollRef.current = { rowKey: key, turn: null }
  }, [])

  /** Render one turn group (latest turn first). */
  const renderTurn = (turn: TurnFileChanges) => {
    const turnStats = turn.files.reduce<UnifiedDiffStats>(
      (total, file) => addStats(total, summarizeDiffs(file.diffs)),
      { added: 0, removed: 0 },
    )
    const reversible = turn.files.filter(isReversible)
    const allUndone = reversible.length > 0
      && reversible.every(file => states.get(stateKey(turn.turn, file.path)) === 'undone')
    const turnAction: FileReviewAction = allUndone ? 'redo' : 'undo'
    const turnKey = `turn:${turn.turn}`
    const turnBusy = busyKey === turnKey
    return (
      <section
        key={turn.turn}
        ref={(element) => {
          if (element === null) turnRefs.current.delete(turn.turn)
          else turnRefs.current.set(turn.turn, element)
        }}
        className={css.turnGroup}
      >
        <header className={css.turnHeader}>
          <span className={css.turnTitle}>{t('turn', { n: turn.turn })}</span>
          {turn.live && <span className={css.liveBadge}>{t('turnLive')}</span>}
          <span className={css.turnCount}>
            {turn.files.length === 1 ? t('filesOne') : t('files', { count: turn.files.length })}
          </span>
          <Stats stats={turnStats} />
          <button
            type="button"
            className={css.actionButton}
            disabled={statusPending || busyKey !== null || reversible.length === 0}
            title={reversible.length === 0 ? t('toggleUnavailable') : undefined}
            onClick={() => {
              runToggle(turnKey, turn.files.filter(file => file.deleted !== true).map(file => ({
                turn: turn.turn, path: file.path, diffs: file.diffs,
              })), turnAction)
            }}
          >
            {turnAction === 'undo' ? <UndoIcon /> : <RedoIcon />}
            {turnBusy
              ? t(turnAction === 'undo' ? 'undoing' : 'redoing')
              : t(turnAction === 'undo' ? 'undoTurn' : 'redoTurn')}
          </button>
          <button
            type="button"
            className={css.smallButton}
            disabled={busyKey !== null}
            title={t('snapshotRestoreTitle')}
            onClick={(event) => {
              event.stopPropagation()
              setRewindTurn(turn.turn)
            }}
          >
            {t('snapshotRestore')}
          </button>
        </header>
        <ul className={css.fileList}>
          {turn.files.map(file => renderFile(turn, file))}
        </ul>
      </section>
    )
  }

  /** Render one changed file row plus its inline diff when expanded. */
  const renderFile = (turn: TurnFileChanges, file: SessionFileChange) => {
    const key = stateKey(turn.turn, file.path)
    const isOpen = expanded.has(key)
    const state = states.get(key)
    const reversible = isReversible(file)
    const fileAction: FileReviewAction = state === 'undone' ? 'redo' : 'undo'
    const fileBusy = busyKey === key
    const stats = summarizeDiffs(file.diffs)
    const selectedCount = selectedHunkCount(file, key)
    return (
      <li
        key={file.path}
        className={css.fileItem}
        ref={(element) => {
          if (element === null) rowRefs.current.delete(key)
          else rowRefs.current.set(key, element)
        }}
      >
        <div
          className={css.fileRow}
          role="button"
          tabIndex={0}
          title={file.path}
          aria-expanded={isOpen}
          onClick={() => { toggleExpanded(key) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggleExpanded(key)
            }
          }}
        >
          <Chevron open={isOpen} />
          <span className={css.fileName}>{basename(file.path)}</span>
          {file.deleted === true
            ? <span className={css.deletedBadge}>{t('deleted')}</span>
            : <Stats stats={stats} />}
          {file.deleted !== true && <StateBadge state={state} />}
          <button
            type="button"
            className={css.smallButton}
            title={t('timelineTitle')}
            onClick={(event) => {
              event.stopPropagation()
              setTimelinePath(file.path)
            }}
          >
            {t('timeline')}
          </button>
          {file.deleted !== true && (
            <button
              type="button"
              className={css.smallButton}
              onClick={(event) => {
                event.stopPropagation()
                openInEditor(file.path)
              }}
            >
              {t('openInEditor')}
            </button>
          )}
          <button
            type="button"
            className={css.smallButton}
            disabled={statusPending || busyKey !== null || !reversible || selectedCount === 0}
            title={file.deleted === true
              ? t('deletedHint')
              : (!reversible
                ? t('toggleUnavailable')
                : selectedCount === 0 ? t('hunkNoneSelected') : undefined)}
            onClick={(event) => {
              event.stopPropagation()
              runToggle(key, [{ turn: turn.turn, path: file.path, diffs: hunksForRequest(file, key) }], fileAction)
            }}
          >
            {fileBusy
              ? t(fileAction === 'undo' ? 'undoing' : 'redoing')
              : t(fileAction === 'undo' ? 'undo' : 'redo')}
          </button>
        </div>
        {isOpen && (
          <div className={css.diffWrap}>
            <LazyDiff>
              {file.deleted === true
                ? <p className={css.diffUnavailable}>{t('deletedHint')}</p>
                : file.diffs.length === 0
                  ? <p className={css.diffUnavailable}>{t('unavailable')}</p>
                  : (
                  <UnifiedDiff
                    diffs={file.diffs}
                    contextLines={3}
                    showCopyButton
                    showFileHeaders={false}
                    selectable
                    selectedHunks={hunkSelection.get(key)}
                    onSelectedHunksChange={(next) => { changeHunkSelection(key, file.diffs.length, next) }}
                    labels={{
                      copy: t('copy'),
                      copied: t('copied'),
                      showUnchanged: count => t('showUnchanged', { count }),
                      hideUnchanged: count => t('hideUnchanged', { count }),
                      hunkN: n => t('hunkN', { n }),
                      hunkInclude: t('hunkInclude'),
                    }}
                    className={css.reviewDiff}
                  />
                )}
            </LazyDiff>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className={css.root}>
      <header className={css.header}>
        <span className={css.headerTitle}>{t('tabTitle')}</span>
        {flat.length > 0 && <Stats stats={totalStats} />}
        <button
          type="button"
          className={css.smallButton}
          disabled={gateOn === null}
          title={gateOn === false ? t('gateTitleOff') : t('gateTitleOn')}
          onClick={toggleGate}
        >
          {gateOn === null ? t('gateUnknown') : gateOn ? t('gateOn') : t('gateOff')}
        </button>
        <button
          type="button"
          className={css.refreshButton}
          disabled={statusPending}
          title={t('refresh')}
          onClick={() => { setTick(value => value + 1) }}
        >
          ⟳
        </button>
      </header>
      {notice !== null && (
        <div
          className={`${css.notice} ${notice.tone === 'success' ? css.noticeSuccess : css.noticeError}`}
          role="alert"
        >
          {notice.text}
        </div>
      )}
      <div className={css.body} ref={bodyRef}>
        {turns.length === 0
          ? <div className={css.empty}>{t('empty')}</div>
          : [...turns].reverse().map(renderTurn)}
      </div>
      {rewindTurn !== null && (
        <TurnRewindDialog
          sessionId={sessionId}
          turn={rewindTurn}
          windowStats={windowStats}
          onJumpToDiff={jumpToFile}
          onClose={() => { setRewindTurn(null) }}
          onRestored={() => {
            setTick(value => value + 1)
            showNotice('success', t('snapshotDone'))
          }}
        />
      )}
      {timelinePath !== null && (
        <FileTimelineDialog
          path={timelinePath}
          entries={timelineEntries}
          onPick={(turn) => { jumpToFile(turn, timelinePath) }}
          onClose={() => { setTimelinePath(null) }}
        />
      )}
    </div>
  )
}
