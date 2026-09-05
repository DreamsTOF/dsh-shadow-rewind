/**
 * LiveChangesBar —— 轮中 live 条：正在进行的那一轮的文件变更实时读数，
 * 注册在 `conversation.input.dock`（输入卡上方那一行座位）。
 *
 * 两个数据源在这里合流：工具侧的改动直接来自会话快照（`deriveSessionChanges`
 * 的 live 轮），终端 / PowerShell 写盘来自 warm 过的 fs-changes 缓存
 * （live-tail 条目）。回合空闲或没有任何改动时渲染空——轮结束后由轮尾卡片
 * 接手。
 *
 * 交互契约与轮尾卡片完全一致：文件列表最多露四行、超出滚动；悬停某行弹出
 * 与本框对齐的共用 DiffPopover；点击某行在侧边栏打开该文件的审计。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ISessions, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { NS } from './chat-locales.ts'
import { basename, type ProducedFileReview } from './turn-deliverables.ts'
import { deriveSessionChanges } from './session-changes.ts'
import {
  cachedFsTurnForSessionTurn, ensureFsFileDiff, fsTurnReviews, subscribeFsCache, warmFsChanges,
} from './fs-diff-utils.ts'
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

// input.dock 这个座位没有 inject 面：会话句柄与侧边栏 opener 只能靠模块级
// 绑定带进来，由 applyFileReview 设置一次。
let sessionsRef: ISessions | undefined
let openSidebarRef: ((sessionId: string, paths: readonly string[], turn?: number) => void) | undefined

/** 由 applyFileReview 调用一次，让 live 条能解析出会话工作区目录。 */
export function bindLiveBarSessions(sessions: ISessions): void {
  sessionsRef = sessions
}

/** 由 applyFileReview 调用一次，让点击行能在侧边栏打开审计。 */
export function bindLiveBarOpenSidebar(
  opener: (sessionId: string, paths: readonly string[], turn?: number) => void,
): void {
  openSidebarRef = opener
}

/** 读会话 cwd；绑定缺席时返回 undefined（调用方一律当作「无法解析」处理）。 */
function liveBarCwd(sessionId: string): string | undefined {
  return sessionsRef?.list.getSnapshot().byId[sessionId as SessionId]?.cwd
}

export function LiveChangesBar({ session, sessionId, useChat, t }: LiveChangesBarProps) {
  // 会话变更的数据源是 Chat 目标快照（标准 props 的 useChat hook）；
  // session（InputZone 的 SessionSnapshot）只提供生命周期刷新信号。
  const chat: ChatSnapshot = useChat((value) => value)
  const id = String(sessionId)
  const cwd = liveBarCwd(id)
  const [cacheTick, setCacheTick] = useState(0)

  // 快照变化会让本组件重渲染（owner share 是时点值）；顺手搭一次 warm，
  // 让 fs 缓存跟上正在进行的这一轮。
  useEffect(() => {
    warmFsChanges(id)
  }, [session, chat, id])

  useEffect(() => subscribeFsCache(() => { setCacheTick(value => value + 1) }), [])

  const turns = useMemo(() => deriveSessionChanges(chat), [chat])
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

  // 悬停浮层锚定在**本框**上（与卡片同一套契约）。
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
