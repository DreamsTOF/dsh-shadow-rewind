/**
 * 文件审查侧栏 tab·辅助对话框。
 *
 *  - ReviewConflictDialog：apply 返回 conflict（内容漂移）时的三选项授权弹窗。
 *  - FileTimelineDialog：文件级时间线——一个文件在本会话被改动的每一轮，
 *    点某轮的 +/- 跳到该轮差异。
 *
 * 骨架复刻 TurnRewindDialog 的 srw-* 样式（由会话回退面全局注入）。
 */

import type { FileReviewAction } from '../file-review/change-types.ts'
import { summarizeDiffs } from './UnifiedDiff.tsx'
import { t } from './locales.ts'
import { Stats } from './review-widgets.tsx'
import { stateKey, type FlatChange, type FileTurnEntry } from './file-review-tab-types.ts'
import css from './FileReviewTab.module.css'

export interface ReviewConflictProps {
  /** apply 批次里内容漂移（conflict）的条目。 */
  readonly items: readonly FlatChange[]
  readonly action: FileReviewAction
  readonly busy: boolean
  /** 拒绝：什么都不做（冲突路径保持原状）。 */
  readonly onAbort: () => void
  /** 只回滚正常部分：跳过冲突路径。 */
  readonly onPartial: () => void
  /** 全部回滚：force 重跑冲突条目，覆盖后续修改。 */
  readonly onForce: () => void
}

/** 冲突三选项弹窗（EXPECTED-DESIGN 1.2）：审查面 apply 返回 conflict 时
 * 授权「拒绝 / 全部回滚 / 只回滚正常部分」——与消息回退撤销同一套语义。 */
export function ReviewConflictDialog({ items, busy, onAbort, onPartial, onForce }: ReviewConflictProps) {
  return (
    <div className="srw-overlay" role="dialog" aria-modal="true">
      <div className="srw-dialog">
        <div className="srw-dialog-head">
          <strong>{t('conflictTitle')}</strong>
          <button type="button" className="srw-trigger" onClick={onAbort} disabled={busy} aria-label={t('close')}>✕</button>
        </div>
        <div className="srw-content">
          <div className="srw-body">
            <p className="srw-warning">{t('conflictHint')}</p>
            <div className="srw-files">
              {items.map(item => (
                <div className="srw-file" key={stateKey(item.turn, item.path)}>
                  <code>{item.path}</code>
                  <span className="srw-kind">{t('stateConflict')}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="srw-foot">
          <button type="button" onClick={onAbort} disabled={busy}>{t('conflictAbort')}</button>
          <button type="button" onClick={onPartial} disabled={busy}>{t('conflictPartial')}</button>
          <button type="button" onClick={onForce} disabled={busy}>{t('conflictForce')}</button>
        </div>
      </div>
    </div>
  )
}

export interface FileTimelineDialogProps {
  readonly path: string
  /** 该文件的逐轮改动（轮次升序）。 */
  readonly entries: readonly FileTurnEntry[]
  /** 点击某轮的 +/- 统计：父级关闭对话框并滚动到那一轮的差异。 */
  readonly onPick: (turn: number) => void
  readonly onClose: () => void
}

/** 文件级时间线：最新轮在前；无 diff 的轮显示占位文案。 */
export function FileTimelineDialog({ path, entries, onPick, onClose }: FileTimelineDialogProps) {
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
                    const stats = entry.counts ?? summarizeDiffs(entry.diffs)
                    return (
                      <li className={css.timelineItem} key={entry.turn}>
                        <span className={css.timelineDot} aria-hidden="true" />
                        <span className={css.turnTitle}>{t('turn', { n: entry.turn })}</span>
                        {entry.live && <span className={css.liveBadge}>{t('turnLive')}</span>}
                        {entry.deleted === true && <span className={css.deletedBadge}>{t('deleted')}</span>}
                        {entry.diffs.length === 0
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
