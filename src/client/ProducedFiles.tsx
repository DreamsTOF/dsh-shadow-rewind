/**
 * ProducedFiles —— 一轮结束后收尾的审查卡片。路径与 hunks 一律来自变更工具
 * 的**结果**，绝不是收尾文风。
 *
 * 侧边栏 tab 移植：原先的 Review DRAWER（劫持宿主网格的细节列）已移除——它
 * 跟 better-sidebar 面板争同一块屏幕边缘。现在「审查」按钮与单文件 chip 改
 * 打开本插件的 better-sidebar `file-review` tab，把整轮路径（或点中的那一个
 * 路径）作为 `meta.expandPaths` 带上，tab 据此精确展开那些 diff。
 * 撤销/重新应用开关保持不变。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  FileReviewAction, FileReviewChange, FileReviewFileState, FileReviewRequest, FileReviewResult,
} from '../file-review/change-types.ts'
import { basename, type ProducedFileReview } from './turn-deliverables.ts'
import type { NS } from './chat-locales.ts'
import { cachedFsTurnFor, fsTurnReviews, ensureFsFileDiff, subscribeFsCache } from './fs-diff-utils.ts'
import type { FsChangeTurn } from './fs-diff-utils.ts'
import { DiffPopover, type PopoverAnchorRect } from './diff-popover.tsx'
import { summarizeDiffs, type UnifiedDiffStats } from './UnifiedDiff.tsx'
import { buildDirTree, countLeafFiles, type DirTreeNode } from './dir-tree.ts'
import css from './ProducedFiles.module.css'

const SUCCESS_NOTICE_DURATION = 2000
const ERROR_NOTICE_DURATION = 5000

interface NoticeFile {
  readonly path: string
}

interface ToggleNotice {
  readonly seq: number
  readonly tone: 'success' | 'error'
  readonly title: string
  readonly description?: string | undefined
  readonly files: readonly NoticeFile[]
}

/**
 * Registration-side helpers (dsh 0.1.2 起轮尾链槽位的 inject 为零参工厂，不
 * 再携带 sessionId——会话身份由组件的标准 props `sessionId` 提供，这里的
 * 回调都以 sessionId 为首参在调用点绑定）。
 */
export interface ProducedFilesInjected {
  /** 会话工作区根（预留字段；聊天卡片按工具原样展示路径）。 */
  projectRootFor: (sessionId: string) => string | undefined
  inspectChanges: (sessionId: string, request: FileReviewRequest) => Promise<FileReviewResult>
  applyChanges: (sessionId: string, request: FileReviewRequest) => Promise<FileReviewResult>
  /**
   * 用给定路径预展开地打开本插件的侧边栏 tab（「审查」按钮传全部产出路径，
   * 单个文件 chip 传它自己的）。所属轮号随行，让 tab 只展开这一轮的行——在
   * 其它轮反复出现的路径在那里保持折叠。
   */
  openInSidebarTab: (sessionId: string, paths: readonly string[], turn?: number) => void
}

/** 匹配到的文件审查，加上轮尾槽供给的 opener 与 locale。 */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile' | 'turn'> & {
  matched: readonly ProducedFileReview[]
  /** 框架解析出的会话标识（session 作用域槽位的标准 props）。 */
  sessionId: SessionId
} & InjectFace<ProducedFilesInjected> & PropsLocale<typeof NS>

/** 注入缺席时的占位巡检/操作：如实报告「宿主不可用」，绝不假装成功。 */
const unavailableChanges = async (request: FileReviewRequest): Promise<FileReviewResult> => ({
  files: request.files.map(file => ({
    path: file.path,
    state: 'unsupported',
    changed: false,
    reason: 'Host file toggle is unavailable',
  })),
})

const unavailableSessionChanges = async (
  _sessionId: string,
  request: FileReviewRequest,
): Promise<FileReviewResult> => unavailableChanges(request)

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.icon}>
      <path d="M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" />
      <path d="M11.25 2.75v3.5h3.5M7 10h5M7 13h5" />
    </svg>
  )
}

function ReviewIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="M4.5 3.5h8a1 1 0 0 1 1 1v3M6.5 6.5h4M6.5 9.5h2.25" />
      <path d="m10.5 13 1.5 1.5 3.5-4" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.closeIcon}>
      <path d="m5.5 5.5 9 9m0-9-9 9" />
    </svg>
  )
}

function FileUndoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="M8 5 4 9l4 4M4 9h7a5 5 0 0 1 5 5v1" />
    </svg>
  )
}

function FileRedoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="m12 5 4 4-4 4M16 9H9a5 5 0 0 0-5 5v1" />
    </svg>
  )
}

function SuccessIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.noticeIconSvg}>
      <path d="m5 10 3.25 3.25L15 6.5" />
    </svg>
  )
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.noticeIconSvg}>
      <circle cx="10" cy="10" r="6.5" />
      <path d="m7.5 7.5 5 5m0-5-5 5" />
    </svg>
  )
}

function ResultToast({
  notice, closeLabel, dismissLabel, fileListLabel, fileOpenLabel, openFile, onDone,
}: {
  readonly notice: ToggleNotice
  readonly closeLabel: string
  readonly dismissLabel: string
  readonly fileListLabel: string
  readonly fileOpenLabel: (path: string) => string
  readonly openFile: (path: string) => void
  readonly onDone: () => void
}) {
  useEffect(() => {
    const duration = notice.tone === 'success'
      ? SUCCESS_NOTICE_DURATION
      : ERROR_NOTICE_DURATION
    const timer = window.setTimeout(onDone, duration)
    return () => { window.clearTimeout(timer) }
  }, [notice.tone, onDone])
  return (
    <div
      className={`${css.toast} ${notice.tone === 'success' ? css.toastSuccess : css.toastError}`}
      role="alert"
    >
      <div className={css.toastHeader}>
        <span className={css.noticeIcon}>
          {notice.tone === 'success' ? <SuccessIcon /> : <ErrorIcon />}
        </span>
        <div className={css.toastCopy}>
          <strong className={css.toastTitle}>{notice.title}</strong>
          {notice.description !== undefined && (
            <span className={css.toastDescription}>{notice.description}</span>
          )}
        </div>
        <button
          type="button"
          className={css.toastCloseButton}
          aria-label={closeLabel}
          onClick={onDone}
        >
          <CloseIcon />
        </button>
      </div>
      {notice.files.length > 0 && (
        <div className={css.noticeFiles}>
          <span className={css.noticeFileListLabel}>{fileListLabel}</span>
          <ul className={css.noticeFileList}>
            {notice.files.map(file => (
              <li key={file.path}>
                <button
                  type="button"
                  className={css.noticeFileButton}
                  aria-label={fileOpenLabel(file.path)}
                  onClick={() => { openFile(file.path) }}
                >
                  <span className={css.noticeFilePath}>{basename(file.path)}</span>
                  <span className={css.noticeFileArrow} aria-hidden="true">↗</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {notice.tone === 'error' && (
        <button type="button" className={css.noticeDismissButton} onClick={onDone}>
          {dismissLabel}
        </button>
      )}
    </div>
  )
}

function addStats(left: UnifiedDiffStats, right: UnifiedDiffStats): UnifiedDiffStats {
  return { added: left.added + right.added, removed: left.removed + right.removed }
}

function Stats({ stats, label }: { readonly stats: UnifiedDiffStats; readonly label: string }) {
  return (
    <span className={css.stats} aria-label={label}>
      <span className={css.added}>+{stats.added}</span>
      <span className={css.removed}>-{stats.removed}</span>
    </span>
  )
}

/** 增/删比例色条（GitHub 式红绿两段条）：数字之外的即时视觉印象。 */
function StatBar({ stats }: { readonly stats: UnifiedDiffStats }) {
  const total = stats.added + stats.removed
  if (total <= 0) return null
  const addedPct = Math.round((stats.added / total) * 100)
  return (
    <span className={css.statBar} aria-hidden="true">
      {stats.added > 0 && <span className={css.statBarAdded} style={{ width: `${String(addedPct)}%` }} />}
      {stats.removed > 0 && <span className={css.statBarRemoved} style={{ width: `${String(100 - addedPct)}%` }} />}
    </span>
  )
}

/** 把一轮的产出文件渲染成摘要卡片，并提供打开侧边栏 tab 的入口。 */
export function ProducedFiles({
  matched: matchedReviews, openFile, turn: turnLocation,
  sessionId,
  projectRootFor,
  inspectChanges: inspectChangesFor = unavailableSessionChanges, applyChanges: applyChangesFor = unavailableSessionChanges,
  openInSidebarTab: openInSidebarTabFor, t,
}: ProducedFilesProps) {
  // dsh 0.1.2：注入的回调以 sessionId 为首参；在组件内绑定本卡会话后沿用
  // 原有变量名，正文零改动。
  const projectRoot = projectRootFor(sessionId)
  const inspectChanges = useCallback(
    (request: FileReviewRequest) => inspectChangesFor(sessionId, request),
    [inspectChangesFor, sessionId],
  )
  const applyChanges = useCallback(
    (request: FileReviewRequest) => applyChangesFor(sessionId, request),
    [applyChangesFor, sessionId],
  )
  const openInSidebarTab = useCallback(
    (paths: readonly string[], turn?: number) => openInSidebarTabFor(sessionId, paths, turn),
    [openInSidebarTabFor, sessionId],
  )
  // 所属轮号（TurnLocation.turn）随每个深链同行，让侧边栏 tab 只展开这一轮的
  // 行。
  const turnNumber = turnLocation.turn
  const [toggleAction, setToggleAction] = useState<FileReviewAction>('undo')
  const [statusPending, setStatusPending] = useState(true)
  const [togglePending, setTogglePending] = useState(false)
  // 单文件撤销：路径 → 巡检/操作返回的当前状态；fileBusy = 正在操作的路径。
  const [fileStates, setFileStates] = useState<ReadonlyMap<string, FileReviewFileState>>(() => new Map())
  const [fileBusy, setFileBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<ToggleNotice | null>(null)
  const toastSeqRef = useRef(0)
  // 文件系统级变更（PowerShell 等终端写盘）：select 以空 match claim 后，
  // 卡片在这里按 turn/start seq 从缓存取本轮条目。条目先以「零全文 + 服务端
  // 行数」的占位形态渲染，全文只在悬停/撤销时经 ensureFsFileDiff 按需补齐
  // （先前每轮 warm 通知都全量拉全文，一轮 30 个文件 = 60 个请求/次）。
  const [fsReviews, setFsReviews] = useState<readonly ProducedFileReview[]>([])
  const fsTurnRef = useRef<FsChangeTurn | undefined>(undefined)
  const lastFsJsonRef = useRef('')
  const startSeq = turnLocation.start?.seq

  useEffect(() => {
    if (startSeq === undefined || projectRoot === undefined) {
      fsTurnRef.current = undefined
      lastFsJsonRef.current = ''
      setFsReviews([])
      return
    }
    let active = true
    const refresh = () => {
      const fsTurn = cachedFsTurnFor(startSeq)
      if (fsTurn === undefined || fsTurn.turn !== turnNumber) {
        if (lastFsJsonRef.current !== '') {
          lastFsJsonRef.current = ''
          fsTurnRef.current = undefined
          if (active) setFsReviews([])
        }
        return
      }
      // 本卡无变化：不重转、不重渲染（warm 的通知对所有挂载卡片广播）。
      const serialized = JSON.stringify(fsTurn)
      if (serialized === lastFsJsonRef.current) return
      lastFsJsonRef.current = serialized
      fsTurnRef.current = fsTurn
      if (active) setFsReviews(fsTurnReviews(fsTurn))
    }
    refresh()
    const unsubscribe = subscribeFsCache(refresh)
    return () => {
      active = false
      unsubscribe()
    }
  }, [startSeq, turnNumber, projectRoot])

  // 工具变更 + 文件系统变更合并；同路径工具优先（fs 条目跳过）。
  const reviews = useMemo(() => {
    if (fsReviews.length === 0) return matchedReviews
    const seen = new Set(matchedReviews.map(review => review.path))
    return [...matchedReviews, ...fsReviews.filter(review => !seen.has(review.path))]
  }, [matchedReviews, fsReviews])
  // 悬停 diff 浮层：chip 上停留片刻才弹出，移入浮层可滚动查看。
  // 锚点是卡片框架的 rect——浮层宽度/左缘与卡片对齐（live 条同一套逻辑）。
  const [popover, setPopover] = useState<{ review: ProducedFileReview; rect: PopoverAnchorRect } | null>(null)
  const cardRef = useRef<HTMLElement | null>(null)
  const showTimerRef = useRef<number | null>(null)
  const hideTimerRef = useRef<number | null>(null)

  const clearPopoverTimers = useCallback((which: 'show' | 'hide' | 'both') => {
    if ((which === 'show' || which === 'both') && showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current)
      showTimerRef.current = null
    }
    if ((which === 'hide' || which === 'both') && hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }
  }, [])

  useEffect(() => () => { clearPopoverTimers('both') }, [clearPopoverTimers])

  const schedulePopoverShow = useCallback((review: ProducedFileReview) => {
    if (review.dir === true) return
    if (review.diffs.length === 0 && review.origin !== 'fs') return
    clearPopoverTimers('both')
    showTimerRef.current = window.setTimeout(() => {
      const frame = cardRef.current?.getBoundingClientRect()
      if (frame === undefined) return
      const rect: PopoverAnchorRect = { top: frame.top, bottom: frame.bottom, left: frame.left, width: frame.width }
      void (async () => {
        let resolved = review
        // fs 占位条目：浮层首次展示前补齐全文（结果记忆化，此后瞬时）。
        if (resolved.diffs.length === 0 && resolved.origin === 'fs'
          && fsTurnRef.current !== undefined && projectRoot !== undefined) {
          const ensured = await ensureFsFileDiff(fsTurnRef.current, resolved.path, projectRoot)
          if (ensured === null) return
          resolved = { ...resolved, diffs: ensured.diffs }
          setFsReviews(current => current.map(entry => entry.path === resolved.path && entry.origin === 'fs'
            ? { ...entry, diffs: ensured.diffs }
            : entry))
        }
        if (resolved.diffs.length === 0) return
        setPopover({ review: resolved, rect })
      })()
    }, 300)
  }, [clearPopoverTimers, projectRoot])

  const schedulePopoverHide = useCallback(() => {
    clearPopoverTimers('both')
    hideTimerRef.current = window.setTimeout(() => { setPopover(null) }, 200)
  }, [clearPopoverTimers])

  const cancelPopoverHide = useCallback(() => { clearPopoverTimers('hide') }, [clearPopoverTimers])

  // fs 占位条目（懒加载全文前）用服务端行数；工具条目按 hunks 汇总。
  const statsForReview = useCallback((review: ProducedFileReview): UnifiedDiffStats => (
    review.counts ?? summarizeDiffs(review.diffs)
  ), [])
  const reviewsWithStats = useMemo(() => reviews.map(review => ({
    review,
    stats: statsForReview(review),
  })), [reviews, statsForReview])
  const totalStats = useMemo(
    () => reviewsWithStats.reduce<UnifiedDiffStats>(
      (total, item) => addStats(total, item.stats),
      { added: 0, removed: 0 },
    ),
    [reviewsWithStats],
  )
  // 终端删除的路径没有 hunks、不能巡检也不能开关——它们只是 chip 上的展示
  // 词汇。**文件系统级**的删除则带着整文件 diff、可以开关（宿主 fs 语义会把
  // 文件还原回来）。
  // 已补齐全文的条目才参与巡检与整轮提交；fs 占位条目在操作时按需补齐。
  const inspectFiles = useMemo(() => reviews
    .filter(review => review.diffs.length > 0)
    .map(review => ({
      path: review.path,
      diffs: review.diffs,
      ...(review.origin !== undefined ? { origin: review.origin } : {}),
    })), [reviews])
  const reversiblePaths = useMemo(() => new Set(reviews.filter(review =>
    // 目录条目天生可逆（mkdir/rmdir 互逆），占位形态即可判定。
    review.dir === true
    // mode-only fs 条目：内容两侧相同、权限位不同（补齐全文后方可判定）。
    || (review.origin === 'fs' && review.diffs.length === 1
      && review.diffs[0] !== undefined
      && review.diffs[0].path === review.path
      && review.diffs[0].oldText !== null
      && review.diffs[0].oldText === review.diffs[0].newText
      && review.diffs[0].oldMode !== undefined && review.diffs[0].newMode !== undefined
      && review.diffs[0].oldMode !== review.diffs[0].newMode)
    || (review.diffs.length > 0 && (
      // fs 形状：单条整文件 diff（added：无旧侧；deleted：新侧为空）。
      (review.diffs.length === 1
        && review.diffs[0] !== undefined
        && review.diffs[0].path === review.path
        && (review.diffs[0].oldText === null
          || (review.diffs[0].newText === '' && review.diffs[0].oldText !== '')))
      || review.diffs.every(diff =>
        diff.path === review.path
        && diff.oldText !== null
        && diff.oldText !== diff.newText
        && (diff.oldText !== '' || diff.oldStart !== undefined)
        && (diff.newText !== '' || diff.newStart !== undefined))))
  ).map(review => review.path)), [reviews])
  const hasReversibleFiles = reversiblePaths.size > 0
  // 整轮开关的可操作性：有可逆条目，或存在 fs 条目（全文在提交时按需补齐）。
  const hasToggleableFiles = useMemo(() => reviews.some(review =>
    review.diffs.length > 0 || review.origin === 'fs'), [reviews])
  const allPaths = useMemo(() => reviews.map(review => review.path), [reviews])
  // 只删了文件的一轮读作「删除摘要」而不是「编辑摘要」。
  const allDeleted = reviews.length > 0 && reviews.every(review => review.deleted === true)
  const statsMatter = totalStats.added > 0 || totalStats.removed > 0

  const showToast = useCallback((notice: Omit<ToggleNotice, 'seq'>) => {
    toastSeqRef.current += 1
    setToast({ seq: toastSeqRef.current, ...notice })
  }, [])

  const phaseForResult = useCallback((
    result: FileReviewResult,
    currentAction: FileReviewAction,
  ): FileReviewAction => {
    if (reversiblePaths.size === 0) return 'undo'
    const byPath = new Map(result.files.map(file => [file.path, file]))
    const target = currentAction === 'undo' ? 'undone' : 'applied'
    return [...reversiblePaths].every(path => byPath.get(path)?.state === target)
      ? (currentAction === 'undo' ? 'redo' : 'undo')
      : currentAction
  }, [reversiblePaths])

  // 巡检（挂载/条目变化时）：确定每个文件当前是 applied 还是 undone。
  // 依赖用内容签名而非数组身份——上游 slot 每次渲染都换 inspectChanges 与
  // matched 的身份，按身份依赖会让巡检（连带按钮禁用窗口）反复重放。
  const inspectRef = useRef(inspectChanges)
  inspectRef.current = inspectChanges
  const inspectKey = useMemo(() => JSON.stringify(inspectFiles), [inspectFiles])
  const reversibleKey = useMemo(() => [...reversiblePaths].sort().join('\n'), [reversiblePaths])

  useEffect(() => {
    let active = true
    if (inspectFiles.length === 0) {
      setFileStates(new Map())
      setStatusPending(false)
      return () => { active = false }
    }
    setStatusPending(true)
    void inspectRef.current({ action: 'undo', files: inspectFiles }).then((result) => {
      if (!active) return
      setFileStates(new Map(result.files.map(file => [file.path, file.state])))
      const allUndone = reversiblePaths.size > 0
        && [...reversiblePaths].every(path =>
          result.files.find(file => file.path === path)?.state === 'undone')
      setToggleAction(allUndone ? 'redo' : 'undo')
    }).catch(() => {
      // 巡检瞬时失败后动作仍保持可用：真正执行时宿主会再做同样的校验。
    }).finally(() => {
      if (active) setStatusPending(false)
    })
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectKey, reversibleKey])

  const runToggle = useCallback(() => {
    if (statusPending || togglePending || !hasToggleableFiles) return
    const action = toggleAction
    setTogglePending(true)
    let requestedPaths: readonly string[] = []
    void (async () => {
      // fs 占位条目先补齐全文再提交（零全文条目宿主无法回放）。
      const files: FileReviewChange[] = []
      for (const review of reviews) {
        if (review.deleted === true && review.diffs.length === 0 && review.dir !== true) continue
        if (review.diffs.length > 0) {
          files.push({
            path: review.path,
            diffs: review.diffs,
            ...(review.origin !== undefined ? { origin: review.origin } : {}),
            ...(review.dir === true
              ? { dirKind: review.deleted === true ? 'deleted' as const : 'added' as const }
              : {}),
          })
          continue
        }
        if (review.origin !== 'fs' || fsTurnRef.current === undefined || projectRoot === undefined) continue
        const ensured = await ensureFsFileDiff(fsTurnRef.current, review.path, projectRoot)
        if (ensured !== null) {
          files.push({
            path: ensured.path,
            diffs: ensured.diffs,
            origin: 'fs',
            ...(ensured.dir === true
              ? { dirKind: ensured.deleted === true ? 'deleted' as const : 'added' as const }
              : {}),
          })
        }
      }
      requestedPaths = files.map(file => file.path)
      return files.length === 0 ? null : applyChanges({ action, files })
    })().then((result) => {
      if (result === null) return
      // 整轮操作后同步每文件状态，chip 上的单文件按钮随之翻转。
      setFileStates((current) => {
        const next = new Map(current)
        for (const file of result.files) next.set(file.path, file.state)
        return next
      })
      setToggleAction(phaseForResult(result, action))
      const targetState = action === 'undo' ? 'undone' : 'applied'
      const byPath = new Map(result.files.map(file => [file.path, file]))
      const failures: NoticeFile[] = requestedPaths.flatMap((path) => {
        const outcome = byPath.get(path)
        if (outcome?.state === targetState) return []
        return [{ path }]
      })
      if (failures.length === 0) {
        showToast({
          tone: 'success',
          title: t(action === 'undo' ? 'produced.undoSuccess' : 'produced.redoSuccess'),
          files: [],
        })
        return
      }
      showToast({
        tone: 'error',
        title: t(action === 'undo' ? 'produced.undoPartial' : 'produced.redoPartial'),
        description: t(action === 'undo'
          ? 'produced.undoPartialDescription'
          : 'produced.redoPartialDescription'),
        files: failures,
      })
    }).catch((error: unknown) => {
      showToast({
        tone: 'error',
        title: t(action === 'undo' ? 'produced.undoError' : 'produced.redoError'),
        description: error instanceof Error ? error.message : String(error),
        files: [],
      })
    }).finally(() => { setTogglePending(false) })
  }, [
    applyChanges, hasToggleableFiles, phaseForResult, projectRoot, reviews, showToast, t,
    statusPending, toggleAction, togglePending,
  ])

  /** 单文件撤销/重新应用：整文件粒度（提交该文件本轮的全部 hunks；hunk 子集
   * 选择只在侧边栏 diff 视图里）。状态来自挂载巡检与每次操作结果，零额外请求。
   * fs 占位条目先按需补齐全文再提交。 */
  const runFileToggle = useCallback((review: ProducedFileReview) => {
    const path = review.path
    if (statusPending || togglePending || fileBusy !== null) return
    if (!reversiblePaths.has(path) && review.origin !== 'fs') return
    const action: FileReviewAction = fileStates.get(path) === 'undone' ? 'redo' : 'undo'
    const target: FileReviewFileState = action === 'undo' ? 'undone' : 'applied'
    setFileBusy(path)
    void (async () => {
      let diffs = review.diffs
      let dirFlag = review.dir === true
      if (diffs.length === 0) {
        if (review.origin !== 'fs' || fsTurnRef.current === undefined || projectRoot === undefined) return null
        const ensured = await ensureFsFileDiff(fsTurnRef.current, path, projectRoot)
        if (ensured === null) return null
        diffs = ensured.diffs
        dirFlag = ensured.dir === true
        // 补齐后的全文回填占位条目：popover/整轮提交不再重复拉取。
        setFsReviews(current => current.map(entry => entry.path === path && entry.origin === 'fs'
          ? { ...entry, diffs: ensured.diffs }
          : entry))
      }
      return applyChanges({
        action,
        files: [{
          path,
          diffs,
          ...(review.origin !== undefined ? { origin: review.origin } : {}),
          ...(dirFlag
            ? { dirKind: review.deleted === true ? 'deleted' as const : 'added' as const }
            : {}),
        }],
      })
    })().then((result) => {
      if (result === null) {
        showToast({
          tone: 'error',
          title: t(action === 'undo' ? 'produced.undoError' : 'produced.redoError'),
          files: [],
        })
        return
      }
      const outcome = result.files.find(file => file.path === path)
      const next = new Map(fileStates)
      next.set(path, outcome?.state ?? 'unsupported')
      setFileStates(next)
      // 整轮开关与 chips 保持同一事实：按最新状态重算整轮是否已全部撤销。
      const allUndoneNow = reversiblePaths.size > 0
        && [...reversiblePaths].every(p => next.get(p) === 'undone')
      setToggleAction(allUndoneNow ? 'redo' : 'undo')
      if (outcome?.state === target) {
        showToast({
          tone: 'success',
          title: t(action === 'undo' ? 'produced.undoSuccess' : 'produced.redoSuccess'),
          files: [],
        })
        return
      }
      showToast({
        tone: 'error',
        title: t(action === 'undo' ? 'produced.undoPartial' : 'produced.redoPartial'),
        description: t(action === 'undo'
          ? 'produced.undoPartialDescription'
          : 'produced.redoPartialDescription'),
        files: [{ path }],
      })
    }).catch((error: unknown) => {
      showToast({
        tone: 'error',
        title: t(action === 'undo' ? 'produced.undoError' : 'produced.redoError'),
        description: error instanceof Error ? error.message : String(error),
        files: [],
      })
    }).finally(() => { setFileBusy(null) })
  }, [
    applyChanges, fileBusy, fileStates, projectRoot, reversiblePaths, showToast, t,
    statusPending, togglePending,
  ])

  // 目录折叠（借鉴 dsh-checkpoint-diff 的 tree.js）：扁平清单 → 折叠目录树；
  // 目录行可开合，叶子行 = 原有 fileRow（深链 + 悬停浮层 + 单文件撤销）。
  const [collapsedDirs, setCollapsedDirs] = useState<ReadonlySet<string>>(() => new Set())
  const dirTree = useMemo(
    () => buildDirTree(reviewsWithStats.map((entry) => entry.review.path)),
    [reviewsWithStats],
  )
  const itemByPath = useMemo(
    () => new Map(reviewsWithStats.map((entry) => [entry.review.path, entry])),
    [reviewsWithStats],
  )
  const toggleDir = useCallback((dirPath: string) => {
    setCollapsedDirs((current) => {
      const next = new Set(current)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  const renderFileLeaf = (review: ProducedFileReview, stats: UnifiedDiffStats, depth: number) => {
    const reversible = reversiblePaths.has(review.path)
    const fileAction: FileReviewAction = fileStates.get(review.path) === 'undone' ? 'redo' : 'undo'
    return (
      <div className={css.fileRow} key={review.path} title={review.path}>
        <button
          type="button"
          className={css.fileLink}
          aria-label={t('produced.review', { name: review.path })}
          onMouseEnter={() => { schedulePopoverShow(review) }}
          onMouseLeave={schedulePopoverHide}
          onFocus={() => { schedulePopoverShow(review) }}
          onBlur={schedulePopoverHide}
          onClick={() => {
            setPopover(null)
            clearPopoverTimers('both')
            openInSidebarTab?.([review.path], turnNumber)
          }}
        >
          {depth > 0 && <span className={css.dirIndent} aria-hidden="true" style={{ width: depth * 14 }} />}
          <span className={css.fileName}>{basename(review.path)}</span>
          {review.deleted === true
            ? <span className={css.deletedBadge}>{t('produced.deleted')}</span>
            : review.dir === true
              ? <span className={css.deletedBadge}>{t('produced.dir')}</span>
              : (
                <>
                  <StatBar stats={stats} />
                  <Stats
                    stats={stats}
                    label={t('review.stats', {
                      added: String(stats.added), removed: String(stats.removed),
                    })}
                  />
                </>
              )}
        </button>
        {/* fs 占位条目（全文未补齐）也给出撤销按钮：点击时按需补齐再提交。 */}
        {(review.deleted !== true || review.diffs.length > 0 || review.dir === true) && (reversible || review.origin === 'fs') && (
          <button
            type="button"
            className={css.fileUndoButton}
            disabled={statusPending || togglePending || fileBusy !== null}
            aria-label={t(fileAction === 'undo' ? 'produced.undoFile' : 'produced.redoFile')}
            title={t(fileAction === 'undo' ? 'produced.undoFile' : 'produced.redoFile')}
            onClick={() => { runFileToggle(review) }}
          >
            {fileAction === 'undo' ? <FileUndoIcon /> : <FileRedoIcon />}
          </button>
        )}
      </div>
    )
  }

  const renderDirNodes = (nodes: readonly DirTreeNode[], depth: number): ReactNode[] => nodes.flatMap((node) => {
    if (node.children === undefined) {
      const item = itemByPath.get(node.path)
      return item === undefined ? [] : [renderFileLeaf(item.review, item.stats, depth)]
    }
    const isCollapsed = collapsedDirs.has(node.path)
    return [
      (
        <button
          type="button"
          key={`dir:${node.path}`}
          className={css.dirRow}
          onClick={() => { toggleDir(node.path) }}
          aria-expanded={!isCollapsed}
        >
          {depth > 0 && <span className={css.dirIndent} aria-hidden="true" style={{ width: depth * 14 }} />}
          <span className={css.dirToggle}>{isCollapsed ? '▸' : '▾'}</span>
          <span className={css.dirName}>{node.name}/</span>
          <span className={css.dirCount}>{String(countLeafFiles(node.children))}</span>
        </button>
      ),
      ...(isCollapsed ? [] : renderDirNodes(node.children, depth + 1)),
    ]
  })

  return (
    <>
      <section ref={cardRef} className={css.card} aria-label={t('produced.summary')}>
        <header className={css.cardHeader}>
          <span className={css.fileIconWrap}><FileIcon /></span>
          <div className={css.cardTitleBlock}>
            <span className={css.cardTitle}>
              {allDeleted
                ? (reviews.length === 1
                  ? t('produced.deletedOne')
                  : t('produced.deletedAll', { count: String(reviews.length) }))
                : reviews.length === 1
                  ? t('produced.editedOne')
                  : t('produced.edited', { count: String(reviews.length) })}
            </span>
            {statsMatter && (
              <Stats
                stats={totalStats}
                label={t('review.stats', {
                  added: String(totalStats.added), removed: String(totalStats.removed),
                })}
              />
            )}
            {statsMatter && <StatBar stats={totalStats} />}
          </div>
          <button
            type="button"
            className={css.toggleButton}
            disabled={statusPending || togglePending || !hasToggleableFiles}
            title={!hasToggleableFiles ? t('produced.toggleUnavailable') : undefined}
            aria-label={toggleAction === 'undo' ? t('produced.undo') : t('produced.redo')}
            onClick={runToggle}
          >
            {togglePending
              ? (toggleAction === 'undo' ? t('produced.undoing') : t('produced.redoing'))
              : (toggleAction === 'undo' ? t('produced.undo') : t('produced.redo'))}
          </button>
          <button
            type="button"
            className={css.reviewButton}
            aria-label={t('produced.reviewAll')}
            onClick={() => { openInSidebarTab?.(allPaths, turnNumber) }}
          >
            <ReviewIcon />
            {t('review.title')}
          </button>
        </header>
        <div className={css.fileList}>
          {renderDirNodes(dirTree, 0)}
        </div>
      </section>

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
          onEnter={cancelPopoverHide}
          onLeave={schedulePopoverHide}
        />
      )}

      {toast !== null && (
        <ResultToast
          key={toast.seq}
          notice={toast}
          closeLabel={t('produced.noticeClose')}
          dismissLabel={t('produced.noticeDismiss')}
          fileListLabel={t('produced.skippedFiles', { count: String(toast.files.length) })}
          fileOpenLabel={path => t('produced.open', { name: basename(path) })}
          openFile={openFile}
          onDone={() => { setToast(current => current?.seq === toast.seq ? null : current) }}
        />
      )}
    </>
  )
}
