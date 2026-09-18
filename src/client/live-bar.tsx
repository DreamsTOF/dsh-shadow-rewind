/**
 * LiveChangesBar —— 会话累计文件变更条：注册在 `conversation.input.dock`
 * （输入卡上方那一行座位）。
 *
 * **单一数据源**：宿主 `/shadow-rewind/fs-changes` 的 `cumulative` 清单——
 * 服务端按检查点把同一路径跨轮的净变化算好（最早触碰轮的轮起检查点 →
 * 最后一次触碰的轮末检查点或当前磁盘），客户端不再做「工具 hunks / fs 占位 /
 * Code Mode 录制」三方合流，也不再跨轮拼接近似行数。
 *
 * 职责：
 *  - 行内 hunk 级撤销/重做（检查点 hunks 经宿主 fileReview 服务回放，与审查
 *    界面同一事实、双向同步）；
 *  - 点行 / 头部「审查」按钮打开 AuditOverlay 全屏审查界面（点行深链展开该文件）；
 *  - 悬停弹对齐本框的共用 DiffPopover（全文按需懒加载）。
 *
 * 回滚遮蔽：整树恢复后，最早触碰轮早于恢复屏障的条目按路径遮蔽（rewound-changes），
 * 「撤销本次恢复」弹出标记即还原。
 */
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { Context } from '@deepseek-ai/cordis'
import type { NS } from './chat-locales.ts'
import type { FileReviewAction, ProducedFileDiff } from '../file-review/change-types.ts'
import { basename } from './path-keys.ts'
import {
  cachedCumulativeForSession, ensureCumulativeFileDiff, subscribeFsCache, warmFsChanges,
  type FsCumulativeChange,
} from './fs-diff-utils.ts'
import { isFsTurnRewound, rewoundMarksOf, subscribeRewound } from './rewound-changes.ts'
import { nextReviewAction, setReviewRows, subscribeReviewRows } from './review-state.ts'
import { applyFileChanges, applyOutcome, buildApplyRequest } from './apply-core.ts'
import { AuditOverlay } from './audit-overlay.tsx'
import { subscribeOpenAudit } from './audit-open.ts'
import { UndoIcon, RedoIcon } from './review-widgets.tsx'
import { DiffPopover, type PopoverAnchorRect } from './diff-popover.tsx'
import { summarizeDiffs } from './UnifiedDiff.tsx'
import { statsOf, summarizeStats } from './file-review-tab-types.ts'
import css from './ProducedFiles.module.css'

/**
 * Owner share of the input-zone slot（dsh 0.1.2 `InputZone`：会话生命周期
 * 快照 + 输入机状态），外加 session 槽位的标准 props——`useChat` 由 ui-chat
 * 并入 SessionStandardProps，组件用它读取本会话的 Chat 快照（warm 信号源）。
 */
interface LiveBarOwner {
  readonly session: SessionSnapshot
  readonly input: InputState
}

export type LiveChangesBarProps = LiveBarOwner & {
  /** 框架解析出的会话标识（session 作用域槽位的标准 props）。 */
  readonly sessionId: SessionId
  /** 选取当前 Conversation 绑定之 Chat 目标的 selector hook。 */
  readonly useChat: UseChat
} & PropsLocale<typeof NS>

// input.dock 这个座位没有 inject 面：会话句柄与客户端上下文只能靠模块级
// 绑定带进来，由 applyFileReview 设置一次。
let sessionsRef: ISessions | undefined
let ctxRef: Context | undefined

/** 由 applyFileReview 调用一次，让 live 条能解析出会话工作区目录。 */
export function bindLiveBarSessions(sessions: ISessions): void {
  sessionsRef = sessions
}

/** 由 applyFileReview 调用一次：行内撤销与新界面都经客户端上下文调宿主服务。 */
export function bindLiveBarContext(ctx: Context): void {
  ctxRef = ctx
}

/** 读会话 cwd；绑定缺席时返回 undefined（调用方一律当作「无法解析」处理）。 */
function liveBarCwd(sessionId: string): string | undefined {
  return sessionsRef?.list.getSnapshot().byId[sessionId as SessionId]?.cwd
}

/** live 条的一行：一条会话累计净变化（服务端按检查点算好）。 */
type LiveRow = FsCumulativeChange

/** AuditOverlay 渲染错误隔离：全屏审查崩溃只丢审查界面，绝不连带把 live 条
 * （同 dock 条目）整个卸载——否则「点审查整条消失」无从排查。 */
class OverlayBoundary extends Component<{
  readonly onError: (error: unknown) => void
  readonly children: ReactNode
}, { readonly failed: boolean }> {
  override state: { readonly failed: boolean } = { failed: false }

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(error)
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

/** 行内操作的结果气泡（简版：单行文字，自动消失）。 */
interface BarNotice {
  readonly tone: 'success' | 'error'
  readonly text: string
}

export function LiveChangesBar({ session, sessionId, useChat, t }: LiveChangesBarProps) {
  const chat: ChatSnapshot = useChat((value) => value)
  const id = String(sessionId)
  const cwd = liveBarCwd(id)
  const [cacheTick, setCacheTick] = useState(0)
  const [rewoundTick, setRewoundTick] = useState(0)
  // 开关结果回流只作为重渲染信号（行方向由 nextReviewAction 在渲染时现算）。
  const [, setReviewTick] = useState(0)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [notice, setNotice] = useState<BarNotice | null>(null)
  const [auditSeed, setAuditSeed] = useState<readonly string[] | null>(null)
  const noticeSeq = useRef(0)

  // 快照变化会让本组件重渲染（owner share 是时点值）；顺手搭一次 warm，
  // 让累计清单跟上正在进行的这一轮。
  useEffect(() => {
    warmFsChanges(id)
  }, [session, chat, id])

  useEffect(() => subscribeFsCache(() => { setCacheTick(value => value + 1) }), [])
  useEffect(() => subscribeRewound(() => { setRewoundTick(value => value + 1) }), [])
  // 审查界面的开关结果回流：行内按钮的 undo/redo 方向随之翻转。
  useEffect(() => subscribeReviewRows(() => { setReviewTick(value => value + 1) }), [])

  // 结果气泡自动消失（成功 3s / 失败 6s）。
  useEffect(() => {
    if (notice === null) return () => {}
    const seq = noticeSeq.current
    const timer = window.setTimeout(
      () => { setNotice((current) => current !== null && current.text === notice.text ? null : current) },
      notice.tone === 'success' ? 3000 : 6000,
    )
    return () => { if (noticeSeq.current === seq) window.clearTimeout(timer) }
  }, [notice])

  const showNotice = useCallback((tone: BarNotice['tone'], text: string) => {
    noticeSeq.current += 1
    setNotice({ tone, text })
  }, [])

  const marks = useMemo(() => rewoundMarksOf(id), [id, rewoundTick])
  // 回滚遮蔽：最早触碰轮早于恢复屏障且路径被恢复的条目不再显示。
  const rows = useMemo<readonly LiveRow[]>(() => {
    return cachedCumulativeForSession(id)
      .filter(item => !isFsTurnRewound(marks, item.turnStartSeq, item.path))
    // cacheTick / rewoundTick 只是订阅信号：缓存或恢复记录变化时 re-derive。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, marks, cacheTick])

  // 悬停浮层锚定在**本框**上。
  const [popover, setPopover] = useState<{ review: { path: string; diffs: readonly ProducedFileDiff[] }; rect: PopoverAnchorRect } | null>(null)
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

  // 统一恢复弹窗（消息旁）点 +/- 的深链：经总线打开全屏审查并展开该文件。
  useEffect(() => subscribeOpenAudit((paths) => {
    setPopover(null)
    clearTimers('both')
    setAuditSeed(paths)
  }), [clearTimers])

  const scheduleShow = useCallback((row: LiveRow) => {
    if (row.kind === 'deleted') return
    clearTimers('both')
    showTimerRef.current = window.setTimeout(() => {
      const frame = barRef.current?.getBoundingClientRect()
      if (frame === undefined || cwd === undefined) return
      const rect: PopoverAnchorRect = { top: frame.top, bottom: frame.bottom, left: frame.left, width: frame.width }
      void (async () => {
        const ensured = await ensureCumulativeFileDiff(row, cwd)
        if (ensured === null || ensured.diffs.length === 0) return
        setPopover({ review: { path: ensured.path, diffs: ensured.diffs }, rect })
      })()
    }, 300)
  }, [clearTimers, cwd])

  const scheduleHide = useCallback(() => {
    clearTimers('both')
    hideTimerRef.current = window.setTimeout(() => { setPopover(null) }, 200)
  }, [clearTimers])

  const cancelHide = useCallback(() => { clearTimers('hide') }, [clearTimers])

  /**
   * 行内撤销/重做：先按需补齐检查点全文（零全文条目宿主无法回放），再经
   * apply-core 装配/执行/分类。冲突不静默——提示去审查界面确认。
   */
  const toggleRow = useCallback((row: LiveRow) => {
    if (busyPath !== null || ctxRef === undefined || cwd === undefined) return
    const action: FileReviewAction = nextReviewAction(id, row.path, cwd)
    void (async () => {
      setBusyPath(row.path)
      try {
        const ensured = await ensureCumulativeFileDiff(row, cwd)
        if (ensured === null) {
          showNotice('error', t('live.unavailable'))
          return
        }
        const request = buildApplyRequest([{
          path: row.path,
          diffs: ensured.diffs,
          origin: 'fs',
          dir: row.dir === true,
          deleted: row.kind === 'deleted',
          fsKind: row.kind,
        }], action)
        const result = await applyFileChanges(ctxRef, sessionId, request)
        setReviewRows(id, result.files, cwd)
        const outcome = applyOutcome(result, action)
        if (outcome.ok) {
          showNotice('success', t(action === 'undo' ? 'produced.undoSuccess' : 'produced.redoSuccess'))
          return
        }
        showNotice('error', outcome.conflicts.length > 0
          ? t('live.conflict')
          : result.files[0]?.reason ?? t('live.failed'))
      } catch (error) {
        showNotice('error', error instanceof Error ? error.message : String(error))
      } finally {
        setBusyPath(null)
      }
    })()
  }, [busyPath, cwd, id, sessionId, showNotice, t])

  if (rows.length === 0) return null

  const stats = summarizeStats(rows)
  const ownerBadgeOf = (row: LiveRow): string | null => {
    if (row.owner === undefined || row.owner === 'target') return null
    if (row.owner === 'multi') return t('live.ownerMulti')
    if (row.owner === 'unknown') return t('live.ownerUnknown')
    return t('live.ownerSession', { id: row.owner.length > 12 ? `${row.owner.slice(0, 12)}…` : row.owner })
  }

  return (
    <>
      <div ref={barRef} className={css.liveBar} role="status">
        <div className={css.liveBarHeader}>
          <span className={css.liveDot} aria-hidden="true" />
          <span className={css.liveTitle}>
            {t('live.session', { count: String(rows.length) })}
          </span>
          <span className={css.stats}>
            <span className={css.added}>+{stats.added}</span>
            <span className={css.removed}>-{stats.removed}</span>
          </span>
          <button
            type="button"
            className={css.toolbarButton}
            onClick={() => {
              // 开关语义：关闭态点开全量审查界面（空 seed），开着点它收起。
              setPopover(null)
              clearTimers('both')
              setAuditSeed((current) => current === null ? [] : null)
            }}
          >
            {t('live.audit')}
          </button>
        </div>
        {notice !== null && (
          <div className={notice.tone === 'success' ? css.liveNoticeSuccess : css.liveNoticeError} role="alert">
            {notice.text}
          </div>
        )}
        <div className={css.liveFiles}>
          {rows.map(row => {
            const own = statsOf(row)
            const action = nextReviewAction(id, row.path, cwd)
            const undone = action === 'redo'
            const badge = ownerBadgeOf(row)
            return (
              <div className={css.liveFileRow} key={row.path}>
                <button
                  type="button"
                  className={css.liveFileMain}
                  title={row.path}
                  onMouseEnter={() => { scheduleShow(row) }}
                  onMouseLeave={scheduleHide}
                  onFocus={() => { scheduleShow(row) }}
                  onBlur={scheduleHide}
                  onClick={() => {
                    setPopover(null)
                    clearTimers('both')
                    setAuditSeed([row.path])
                  }}
                >
                  <span className={css.fileName}>{basename(row.path)}</span>
                  {row.kind === 'deleted' && <span className={css.deletedBadge}>{t('live.deleted')}</span>}
                  {row.dir === true && <span className={css.deletedBadge}>{t('produced.dir')}</span>}
                  {badge !== null && <span className={css.deletedBadge}>{badge}</span>}
                  {undone && <span className={css.deletedBadge}>{t('live.undone')}</span>}
                  <span className={css.stats}>
                    <span className={css.added}>+{own.added}</span>
                    <span className={css.removed}>-{own.removed}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={css.liveUndo}
                  disabled={busyPath === row.path}
                  title={t(action === 'undo' ? 'live.undoRow' : 'live.redoRow')}
                  aria-label={t(action === 'undo' ? 'live.undoRow' : 'live.redoRow')}
                  onClick={() => { toggleRow(row) }}
                >
                  {action === 'undo' ? <UndoIcon /> : <RedoIcon />}
                </button>
              </div>
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

      {auditSeed !== null && ctxRef !== undefined && (
        <OverlayBoundary
          key={auditSeed.join('|')}
          onError={(error) => {
            console.error('[dsh-shadow-rewind] audit overlay render error:', error)
            setAuditSeed(null)
            showNotice('error', t('live.failed'))
          }}
        >
          <AuditOverlay
            ctx={ctxRef}
            sessionId={id}
            cwd={cwd}
            seedPaths={auditSeed.length > 0 ? auditSeed : undefined}
            onClose={() => { setAuditSeed(null) }}
          />
        </OverlayBoundary>
      )}
    </>
  )
}