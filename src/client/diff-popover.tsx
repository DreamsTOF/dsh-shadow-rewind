/**
 * DiffPopover: shared hover preview for the turn-tail card AND the live bar.
 * The anchor is the host frame's rect (card or live bar), so the popover is
 * exactly as wide as the frame and left-aligned with it — both surfaces get
 * the same look by construction.
 */
import type { ProducedFileReview } from './turn-deliverables.ts'
import type { UnifiedDiffStats } from './UnifiedDiff.tsx'
import { UnifiedDiff } from './UnifiedDiff.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './chat-locales.ts'
import css from './ProducedFiles.module.css'

/** Host frame rect (viewport coordinates) the popover aligns to. */
export interface PopoverAnchorRect {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly width: number
}

export interface DiffPopoverProps {
  readonly review: ProducedFileReview
  readonly anchor: PopoverAnchorRect
  readonly stats: UnifiedDiffStats
  readonly statsLabel: string
  readonly t: PropsLocale<typeof NS>['t']
  readonly onEnter: () => void
  readonly onLeave: () => void
}

export function DiffPopover({
  review, anchor, stats, statsLabel, t, onEnter, onLeave,
}: DiffPopoverProps) {
  // Above the frame when there is room, below otherwise; width/left follow
  // the frame so the popover reads as an extension of the card or live bar.
  const above = anchor.top > 300
  const width = Math.min(anchor.width, window.innerWidth - 16)
  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8)
  return (
    <div
      className={css.diffPopover}
      style={{
        width,
        left,
        ...(above
          ? { bottom: window.innerHeight - anchor.top + 8 }
          : { top: anchor.bottom + 8 }),
      }}
      role="tooltip"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <header className={css.diffPopoverHeader}>
        <span className={css.diffPopoverPath} title={review.path}>{review.path}</span>
        <span className={css.stats} aria-label={statsLabel}>
          <span className={css.added}>+{stats.added}</span>
          <span className={css.removed}>-{stats.removed}</span>
        </span>
      </header>
      <div className={css.diffPopoverBody}>
        <UnifiedDiff
          diffs={review.diffs}
          contextLines={3}
          showFileHeaders={false}
          labels={{
            copy: t('review.copy'),
            copied: t('review.copied'),
            showUnchanged: count => t('review.showUnchanged', { count: String(count) }),
            hideUnchanged: count => t('review.hideUnchanged', { count: String(count) }),
            hunkN: n => t('review.hunkN', { n: String(n) }),
            hunkInclude: t('review.hunkInclude'),
          }}
          className={css.reviewDiff}
        />
      </div>
    </div>
  )
}
