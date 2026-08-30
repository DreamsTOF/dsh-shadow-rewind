/**
 * LiveChangesBar: ambient readout of the IN-PROGRESS turn's file changes,
 * registered into `conversation.input.dock` (the one-line seat above the
 * composer card). Tool-derived changes come straight from the session
 * snapshot (deriveSessionChanges' live turn); terminal/PowerShell writes come
 * from the warmed fs-changes cache (live-tail entry). Renders nothing when
 * the turn is idle or changed nothing — the completed-turn card takes over.
 *
 * Same interaction contract as the turn-tail card: the file list shows up to
 * four rows and scrolls beyond; hovering a row pops the shared DiffPopover
 * aligned to this frame; clicking a row opens the sidebar audit on that file.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationSnapshot, ISessions, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { NS } from './chat-locales.ts'
import { basename, type ProducedFileReview } from './turn-deliverables.ts'
import { deriveSessionChanges } from './session-changes.ts'
import {
  cachedFsTurnForSessionTurn, ensureFsFileDiff, fsTurnReviews, subscribeFsCache, warmFsChanges,
} from './fs-diff-utils.ts'
import { DiffPopover, type PopoverAnchorRect } from './diff-popover.tsx'
import { summarizeDiffs } from './UnifiedDiff.tsx'
import css from './ProducedFiles.module.css'

/** Owner share of the input-zone slots: point-in-time snapshots, re-rendered by the skeleton. */
interface LiveBarOwner {
  readonly session: ConversationSnapshot
  readonly input: unknown
}

export type LiveChangesBarProps = LiveBarOwner & PropsLocale<typeof NS>

// The input.dock seat has no inject face; the sessions handle and the sidebar
// opener ride module bindings set once by applyFileReview.
let sessionsRef: ISessions | undefined
let openSidebarRef: ((sessionId: string, paths: readonly string[], turn?: number) => void) | undefined

/** Called once from applyFileReview so the bar can resolve the session cwd. */
export function bindLiveBarSessions(sessions: ISessions): void {
  sessionsRef = sessions
}

/** Called once from applyFileReview so row clicks open the sidebar audit. */
export function bindLiveBarOpenSidebar(
  opener: (sessionId: string, paths: readonly string[], turn?: number) => void,
): void {
  openSidebarRef = opener
}

function liveBarCwd(sessionId: string): string | undefined {
  return sessionsRef?.list.getSnapshot().byId[sessionId as SessionId]?.cwd
}

export function LiveChangesBar({ session, t }: LiveChangesBarProps) {
  const snapshot = session
  const sessionId = String(snapshot.sessionId)
  const cwd = liveBarCwd(sessionId)
  const [cacheTick, setCacheTick] = useState(0)

  // Snapshot changes re-render this component (point-in-time owner share);
  // piggyback a throttled warm so the fs cache tracks the live turn.
  useEffect(() => {
    warmFsChanges(sessionId)
  }, [snapshot, sessionId])

  useEffect(() => subscribeFsCache(() => { setCacheTick(value => value + 1) }), [])

  const turns = useMemo(() => deriveSessionChanges(snapshot), [snapshot])
  const liveTurn = turns.find(turn => turn.live)
  const liveTurnNumber = liveTurn?.turn

  // fs 条目以「零全文 + 服务端行数」的占位形态同步渲染：缓存一变（cacheTick）
  // 立即反映，全文只在悬停浮层时按需补齐——live 期间不再有逐文件的全文 HTTP。
  const fsReviews = useMemo(() => {
    if (liveTurnNumber === undefined) return []
    const fsTurn = cachedFsTurnForSessionTurn(sessionId, liveTurnNumber)
    return fsTurn === undefined ? [] : fsTurnReviews(fsTurn)
    // cacheTick 只是订阅信号：缓存变化时 re-derive。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveTurnNumber, sessionId, cacheTick])

  // Hover popover anchored to THIS frame (same contract as the card).
  const [popover, setPopover] = useState<{ review: ProducedFileReview; rect: PopoverAnchorRect } | null>(null)
  const barRef = useRef<HTMLDivElement | null>(null)
  const showTimerRef = useRef<number | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  const clearTimers = useCallback((which: 'show' | 'hide' | 'both') => {
    if ((which === 'show' || which === 'both') && showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    if ((which === 'hide' || which === 'both') && hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  useEffect(() => () => { clearTimers('both') }, [clearTimers])

  const scheduleShow = useCallback((review: ProducedFileReview) => {
    if (review.dir === true) return
    if (review.diffs.length === 0 && review.origin !== 'fs') return
    clearTimers('both')
    showTimerRef.current = window.setTimeout(() => {
      const frame = barRef.current?.getBoundingClientRect()
      if (frame === undefined) return
      const rect: PopoverAnchorRect = { top: frame.top, bottom: frame.bottom, left: frame.left, width: frame.width }
      void (async () => {
        let resolved = review
        // fs 占位条目：浮层首次展示前补齐全文（模块级记忆化，此后瞬时）。
        if (resolved.diffs.length === 0 && resolved.origin === 'fs' && cwd !== undefined) {
          const fsTurn = cachedFsTurnForSessionTurn(sessionId, liveTurnNumber ?? -1)
          if (fsTurn === undefined) return
          const ensured = await ensureFsFileDiff(fsTurn, resolved.path, cwd)
          if (ensured === null) return
          resolved = { ...resolved, diffs: ensured.diffs }
        }
        if (resolved.diffs.length === 0) return
        setPopover({ review: resolved, rect })
      })()
    }, 300)
  }, [clearTimers, cwd, sessionId, liveTurnNumber])

  const scheduleHide = useCallback(() => {
    clearTimers('both')
    hideTimerRef.current = window.setTimeout(() => { setPopover(null) }, 200)
  }, [clearTimers])

  const cancelHide = useCallback(() => { clearTimers('hide') }, [clearTimers])

  if (liveTurn === undefined) return null

  // fs 占位条目用服务端行数；工具条目按 hunks 汇总。
  const statsFor = (file: ProducedFileReview): { added: number; removed: number } => (
    file.counts ?? summarizeDiffs(file.diffs)
  )
  const seen = new Set(liveTurn.files.map(file => file.path))
  const merged: readonly ProducedFileReview[] = [
    ...liveTurn.files,
    ...fsReviews.filter(file => !seen.has(file.path)),
  ]
  if (merged.length === 0) return null

  const stats = merged.reduce(
    (total, file) => {
      const own = statsFor(file)
      return { added: total.added + own.added, removed: total.removed + own.removed }
    },
    { added: 0, removed: 0 },
  )

  return (
    <>
      <div ref={barRef} className={css.liveBar} role="status">
        <div className={css.liveBarHeader}>
          <span className={css.liveDot} aria-hidden="true" />
          <span className={css.liveTitle}>
            {t('live.changes', { count: String(merged.length) })}
          </span>
          <span className={css.stats}>
            <span className={css.added}>+{stats.added}</span>
            <span className={css.removed}>-{stats.removed}</span>
          </span>
        </div>
        <div className={css.liveFiles}>
          {merged.map(file => {
            const own = statsFor(file)
            return (
              <button
                type="button"
                className={css.liveFileRow}
                key={file.path}
                title={file.path}
                onMouseEnter={() => { scheduleShow(file) }}
                onMouseLeave={scheduleHide}
                onFocus={() => { scheduleShow(file) }}
                onBlur={scheduleHide}
                onClick={() => {
                  setPopover(null)
                  clearTimers('both')
                  openSidebarRef?.(sessionId, [file.path], liveTurn.turn)
                }}
              >
                <span className={css.fileName}>{basename(file.path)}</span>
                {file.deleted === true && <span className={css.deletedBadge}>{t('live.deleted')}</span>}
                <span className={css.stats}>
                  <span className={css.added}>+{own.added}</span>
                  <span className={css.removed}>-{own.removed}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {popover !== null && (
        <DiffPopover
          review={popover.review}
          anchor={popover.rect}
          stats={summarizeDiffs(popover.review.diffs)}
          statsLabel={t('review.stats', {
            added: String(summarizeDiffs(popover.review.diffs).added),
            removed: String(summarizeDiffs(popover.review.diffs).removed),
          })}
          t={t}
          onEnter={cancelHide}
          onLeave={scheduleHide}
        />
      )}
    </>
  )
}
