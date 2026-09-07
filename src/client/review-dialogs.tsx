/**
 * 文件审查侧栏 tab·辅助对话框。
 *
 *  - MultiSessionConfirmDialog：提交批次含 owner === 'multi'（真多会话冲突）
 *    时的确认弹窗；纯同步确认，无 fetch 状态机。
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

export interface MultiSessionConfirmProps {
  /** 已过提交闸（显式勾选）的待提交批次。 */
  readonly items: readonly FlatChange[]
  readonly action: FileReviewAction
  /** 其它会话 id → displayTitle（列表快照查不到时回落原始 id）。 */
  readonly sessionTitle: (id: string) => string | undefined
  readonly onCancel: () => void
  /** 改为手动勾选：关弹窗 + 展开冲突行并滚动到位。 */
  readonly onManual: () => void
  readonly onProceed: () => void
}

/** 多会话确认弹窗：真冲突（multi）逐行列出，其余他会话条目汇总提示。 */
export function MultiSessionConfirmDialog({ items, action, sessionTitle, onCancel, onManual, onProceed }: MultiSessionConfirmProps) {
  const conflicts = items.filter(item => item.owner === 'multi')
  const others = items.filter((item): item is FlatChange & { readonly owner: string } =>
    item.owner !== undefined && item.owner !== 'target'
    && item.owner !== 'multi' && item.owner !== 'unknown')
  return (
    <div className="srw-overlay" role="dialog" aria-modal="true">
      <div className="srw-dialog">
        <div className="srw-dialog-head">
          <strong>{t('multiConfirmTitle')}</strong>
          <button type="button" className="srw-trigger" onClick={onCancel} aria-label={t('close')}>✕</button>
        </div>
        <div className="srw-content">
          <div className="srw-body">
            <p className="srw-warning">{t('multiConfirmWarn')}</p>
            <div className="srw-files">
              {conflicts.map(item => (
                <div className="srw-file" key={stateKey(item.turn, item.path)}>
                  <code>{item.path}</code>
                  <span className="srw-kind">{t('ownerMulti')}</span>
                </div>
              ))}
            </div>
            {others.length > 0 && (
              <p className="srw-status">
                {t('multiConfirmOthers')}
                {others.map((item, index) => (
                  <span key={stateKey(item.turn, item.path)}>
                    {index > 0 ? '、' : ' '}
                    {sessionTitle(item.owner) ?? item.owner}
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
        <div className="srw-foot">
          <button type="button" onClick={onCancel}>{t('cancel')}</button>
          <button type="button" onClick={onManual}>{t('multiConfirmManual')}</button>
          <button type="button" onClick={onProceed}>
            {t(action === 'undo' ? 'multiConfirmProceedUndo' : 'multiConfirmProceedRedo')}
          </button>
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
