/**
 * LiveChangesBar —— 会话累计文件变更条：注册在 `conversation.input.dock`
 * （输入卡上方那一行座位）。
 *
 * 语义（自适应）：展示**本会话到目前为止**仍生效的全部文件改动——5 轮改了
 * 10 个文件就显示 10 行；回滚掉其中 2 轮、撤销 5 个文件的更改后只剩 5 行。
 * 「已回滚」的扣减来自 rewound-changes 的恢复标记（条目 seq ≤ 恢复屏障且
 * 路径被恢复 → 遮蔽），轮号本身无法区分恢复前后，故不按轮过滤。
 *
 * 职责（原轮尾审查卡片移除后的接管面）：
 *  - 行内撤销/重做：每行一个按钮，hunk 级，与审查界面同一宿主服务
 *    （fileReview apply），结果经 review-state 双向同步；
 *  - 头部「审查」按钮 + 点行：打开 AuditOverlay（文件审查全屏对话框，
 *    逐轮 diff + hunk 撤销 + 每轮快照恢复），点行时深链展开该文件。
 *
 * 两个数据源在这里合流：工具侧的改动来自会话快照（`deriveSessionChanges`
 * 的全部轮，按路径合并），终端 / PowerShell 写盘来自 warm 过的 fs-changes
 * 缓存（全部轮的占位条目，工具条目优先）。没有任何可见改动时渲染空。
 *
 * 样式：宽度对齐输入对话框（宿主 dock 的共享几何变量），文件列表最多
 * 8 行超出滚动；悬停某行弹出与本框对齐的共用 DiffPopover。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { Context } from '@deepseek-ai/cordis'
import type { NS } from './chat-locales.ts'
import type { FileReviewAction, FileReviewChange, ProducedFileDiff } from '../file-review/change-types.ts'
import { basename, type ProducedFileReview } from './turn-deliverables.ts'
import {
  deriveSessionChanges, filterRewoundTurns, pathKey, reversibleOf,
} from './session-changes.ts'
import {
  cachedFsTurnForSessionTurn, cachedFsTurnsForSession, ensureFsFileDiff, fsTurnReviews,
  subscribeFsCache, warmFsChanges, type FsChangeTurn,
} from './fs-diff-utils.ts'
import { isFsTurnRewound, rewoundMarksOf, subscribeRewound } from './rewound-changes.ts'
import { invokeFileReview } from './remote-access.ts'
import { nextReviewAction, setReviewRows, subscribeReviewRows } from './review-state.ts'
import { AuditOverlay } from './audit-overlay.tsx'
import { UndoIcon, RedoIcon } from './review-widgets.tsx'
import { DiffPopover, type PopoverAnchorRect } from './diff-popover.tsx'
import { summarizeDiffs } from './UnifiedDiff.tsx'
import css from './ProducedFiles.module.css'

/**
 * Owner share of the input-zone slot（dsh 0.1.2 `InputZone`：会话生命周期
 * 快照 + 输入机状态），外加 session 槽位的标准 props——`useChat` 由 ui-chat
 * 并入 SessionStandardProps，组件用它读取本会话的 Chat 快照（会话变更
 * 推导的数据源；旧 runtime 的 ConversationSnapshot 随包移除）。
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

/** live 条的一行：按路径合并后的会话累计改动。 */
interface LiveRow {
  readonly path: string
  readonly diffs: ProducedFileDiff[]
  readonly deleted?: true
  /** fs 条目（终端写盘）：悬停补全文与撤销提交要带 origin/dirKind。 */
  readonly origin?: 'fs'
  readonly dir?: true
  readonly counts?: { readonly added: number; readonly removed: number }
  /** fs-only 行的所属轮缓存条目（悬停浮层补全文用）。 */
  readonly fsTurn?: FsChangeTurn
}

/** 行内操作的结果气泡（简版：单行文字，自动消失）。 */
interface BarNotice {
  readonly tone: 'success' | 'error'
  readonly text: string
}

export function LiveChangesBar({ session, sessionId, useChat, t }: LiveChangesBarProps) {
  // 会话变更的数据源是 Chat 目标快照（标准 props 的 useChat hook）；
  // session（InputZone 的 SessionSnapshot）只提供生命周期刷新信号。
  const chat: ChatSnapshot = useChat((value) => value)
  const id = String(sessionId)
  const cwd = liveBarCwd(id)
  const [cacheTick, setCacheTick] = useState(0)
  const [rewoundTick, setRewoundTick] = useState(0)
  const [reviewTick, setReviewTick] = useState(0)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [notice, setNotice] = useState<BarNotice | null>(null)
  const [auditSeed, setAuditSeed] = useState<readonly string[] | null>(null)
  const noticeSeq = useRef(0)

  // 快照变化会让本组件重渲染（owner share 是时点值）；顺手搭一次 warm，
  // 让 fs 缓存跟上正在进行的这一轮。
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

  const turns = useMemo(() => deriveSessionChanges(chat), [chat])
  const liveTurnNumber = useMemo(() => turns.find(turn => turn.live)?.turn, [turns])
  const marks = useMemo(() => rewoundMarksOf(id), [id, rewoundTick])

  // 回滚遮蔽后的会话累计轮视图（工具侧条目，含 live 轮）。
  const visibleTurns = useMemo(() => filterRewoundTurns(turns, marks), [turns, marks])

  // fs 条目（终端写盘）：全部轮的占位形态，遮蔽近似按所属轮 turn/start seq 判定。
  const fsReviews = useMemo(() => {
    const rows: Array<ProducedFileReview & { readonly fsTurn: FsChangeTurn }> = []
    for (const fsTurn of cachedFsTurnsForSession(id)) {
      for (const review of fsTurnReviews(
        fsTurn,
        change => !isFsTurnRewound(marks, fsTurn.turnStartSeq, change.path),
      )) {
        rows.push({ ...review, fsTurn })
      }
    }
    return rows
    // cacheTick 只是订阅信号：缓存变化时 re-derive。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, marks, cacheTick])

  // 按路径合并成会话累计行：工具条目优先（带精确 hunk，diffs 跨轮拼接）；
  // fs-only 路径取其最新一轮的占位（同路径多轮写盘时行数以最接近当前磁盘
  // 的一轮为准）。TODO: fs 跨轮的精确净计数需要服务端按窗口聚合，当前为近似。
  const rows = useMemo<readonly LiveRow[]>(() => {
    const order: string[] = []
    const byKey = new Map<string, LiveRow>()
    for (const turn of visibleTurns) {
      for (const file of turn.files) {
        const key = pathKey(file.path)
        const existing = byKey.get(key)
        if (existing === undefined) {
          byKey.set(key, {
            path: file.path,
            diffs: [...file.diffs],
            ...(file.deleted === true ? { deleted: true } : {}),
            ...(file.dir === true ? { dir: true } : {}),
          })
          order.push(key)
        } else {
          existing.diffs.push(...file.diffs)
        }
      }
    }
    const fsByPath = new Map<string, ProducedFileReview & { readonly fsTurn: FsChangeTurn }>()
    for (const review of fsReviews) fsByPath.set(pathKey(review.path), review)
    for (const [key, review] of fsByPath) {
      if (byKey.has(key)) continue
      byKey.set(key, {
        path: review.path,
        diffs: [],
        origin: 'fs',
        ...(review.deleted === true ? { deleted: true } : {}),
        ...(review.dir === true ? { dir: true } : {}),
        ...(review.counts !== undefined ? { counts: review.counts } : {}),
        fsTurn: review.fsTurn,
      })
      order.push(key)
    }
    return order.map(key => byKey.get(key)!).filter(row => {
      // 工具条目存在即可显示；fs-only 行至少要有行数占位或目录/删除标记。
      return row.origin !== 'fs' || row.counts !== undefined || row.deleted === true || row.dir === true
    })
  }, [visibleTurns, fsReviews])

  // 悬停浮层锚定在**本框**上（与原卡片同一套契约）。
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

  const scheduleShow = useCallback((row: LiveRow) => {
    if (row.deleted === true) return
    if (row.diffs.length === 0 && row.origin !== 'fs') return
    clearTimers('both')
    showTimerRef.current = window.setTimeout(() => {
      const frame = barRef.current?.getBoundingClientRect()
      if (frame === undefined) return
      const rect: PopoverAnchorRect = { top: frame.top, bottom: frame.bottom, left: frame.left, width: frame.width }
      void (async () => {
        let resolved: ProducedFileReview = { path: row.path, diffs: [...row.diffs] }
        // fs 占位条目：浮层首次展示前补齐全文（模块级记忆化，此后瞬时）。
        if (resolved.diffs.length === 0 && row.origin === 'fs' && cwd !== undefined) {
          const fsTurn = row.fsTurn
            ?? cachedFsTurnForSessionTurn(sessionId, liveTurnNumber ?? -1)
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

  /**
   * 行内撤销/重做（原轮尾卡片的单文件开关，移植）：fs 占位行先补全文再提交；
   * conflict 不静默——提示去审查界面确认（那里的三选项弹窗承担授权）。
   */
  const toggleRow = useCallback((row: LiveRow) => {
    if (busyPath !== null || ctxRef === undefined) return
    const action: FileReviewAction = nextReviewAction(id, row.path)
    const targetState = action === 'undo' ? 'undone' : 'applied'
    void (async () => {
      setBusyPath(pathKey(row.path))
      try {
        let diffs = [...row.diffs]
        let dir = row.dir
        let deleted = row.deleted
        // fs 占位条目先补齐全文（零全文条目宿主无法回放）。
        if (diffs.length === 0 && row.origin === 'fs') {
          if (cwd === undefined || row.fsTurn === undefined) {
            showNotice('error', t('live.unavailable'))
            return
          }
          const ensured = await ensureFsFileDiff(row.fsTurn, row.path, cwd)
          if (ensured === null) {
            showNotice('error', t('live.unavailable'))
            return
          }
          diffs = [...ensured.diffs]
          dir = ensured.dir
          deleted = ensured.deleted
        }
        if (!reversibleOf({ path: row.path, diffs, origin: row.origin, dir })) {
          showNotice('error', t('live.notReversible'))
          return
        }
        // 目录条目带 dirKind（宿主走 mkdir/rmdir 语义）；kind 从所属轮读。
        const fsChange = row.origin === 'fs'
          ? row.fsTurn?.changes.find(change => pathKey(change.path) === pathKey(row.path))
          : undefined
        const file: FileReviewChange = {
          path: row.path,
          diffs,
          ...(row.origin !== undefined ? { origin: row.origin } : {}),
          ...(dir === true
            ? { dirKind: (deleted === true || fsChange?.kind === 'deleted' ? 'deleted' : 'added') as 'added' | 'deleted' }
            : {}),
        }
        const result = await invokeFileReview(ctxRef, sessionId, 'apply', { action, files: [file] })
        setReviewRows(id, result.files)
        const outcome = result.files.find(entry => entry.path === row.path)
        if (outcome?.state === targetState) {
          showNotice('success', t(action === 'undo' ? 'produced.undoSuccess' : 'produced.redoSuccess'))
          return
        }
        showNotice('error', outcome?.state === 'conflict'
          ? t('live.conflict')
          : outcome?.reason ?? t('live.failed'))
      } catch (error) {
        showNotice('error', error instanceof Error ? error.message : String(error))
      } finally {
        setBusyPath(null)
      }
    })()
  }, [busyPath, cwd, id, sessionId, showNotice, t])

  if (rows.length === 0) return null

  // fs 占位条目用服务端行数；工具条目按 hunks 汇总。
  const statsFor = (row: LiveRow): { added: number; removed: number } => (
    row.counts ?? summarizeDiffs(row.diffs)
  )
  const stats = rows.reduce(
    (total, row) => {
      const own = statsFor(row)
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
            {t('live.session', { count: String(rows.length) })}
          </span>
          <span className={css.stats}>
            <span className={css.added}>+{stats.added}</span>
            <span className={css.removed}>-{stats.removed}</span>
          </span>
          <button
            type="button"
            className={css.toolbarButton}
            onClick={() => { setAuditSeed(null) }}
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
            const own = statsFor(row)
            const action = nextReviewAction(id, row.path)
            const undone = action === 'redo'
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
                  {row.deleted === true && <span className={css.deletedBadge}>{t('live.deleted')}</span>}
                  {undone && <span className={css.deletedBadge}>{t('live.undone')}</span>}
                  <span className={css.stats}>
                    <span className={css.added}>+{own.added}</span>
                    <span className={css.removed}>-{own.removed}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={css.liveUndo}
                  disabled={busyPath === pathKey(row.path)}
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
        <AuditOverlay
          ctx={ctxRef}
          sessionId={id}
          cwd={cwd}
          seedPaths={auditSeed.length > 0 ? auditSeed : undefined}
          onClose={() => { setAuditSeed(null) }}
        />
      )}
    </>
  )
}
