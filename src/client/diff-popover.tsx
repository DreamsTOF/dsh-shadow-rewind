/**
 * DiffPopover —— 轮尾卡片与轮中 live 条**共用**的悬停预览浮层。
 *
 * 锚点是宿主框（卡片或 live 条）自身的 rect：浮层与框同宽、左对齐，于是两
 * 个面天然长得一样，不需要各自维护一套定位逻辑。上下方向按视口余量翻转。
 */
import type { ProducedFileReview } from './turn-deliverables.ts'
import type { UnifiedDiffStats } from './UnifiedDiff.tsx'
import { UnifiedDiff } from './UnifiedDiff.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './chat-locales.ts'
import css from './ProducedFiles.module.css'

/** 宿主框的 rect（视口坐标），浮层据此对齐与定宽。 */
export interface PopoverAnchorRect {
  readonly top: number
  readonly bottom: number
  readonly left: number
  readonly width: number
}

/** DiffPopover 的入参：一个文件的审查数据 + 锚点 + 已算好的行数字。 */
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
  // 上方放得下就朝上、否则朝下；宽与左边界都跟随宿主框，让浮层看起来
  // 就是卡片或 live 条的延伸。
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
