// ProducedFiles: the review card a finished turn ends with. Paths and hunks
// come from mutation-tool results, never from the closing prose.
//
// Sidebar-tab port: the original Review DRAWER (a host-grid details-column
// hijack) is removed — it fought the better-sidebar panel for the same screen
// edge. The 审查 button and the per-file chips now open the plugin's
// better-sidebar 'file-review' tab instead, carrying the turn's paths (or the
// one clicked path) as `meta.expandPaths` so the tab expands exactly those
// diffs. The Undo/Reapply toggle is unchanged.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  FileReviewAction, FileReviewChange, FileReviewFileState, FileReviewRequest, FileReviewResult,
} from '../file-review/change-types.ts'
import { basename, type ProducedFileReview } from './turn-deliverables.ts'
import type { NS } from './chat-locales.ts'
import { cachedFsTurnFor, fsTurnReviews, ensureFsFileDiff, subscribeFsCache } from './fs-diff-utils.ts'
import type { FsChangeTurn } from './fs-diff-utils.ts'
import { DiffPopover, type PopoverAnchorRect } from './diff-popover.tsx'
import { summarizeDiffs, type UnifiedDiffStats } from './UnifiedDiff.tsx'
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

/** Matched file reviews plus the opener and locale supplied by the turn-tail slot. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile' | 'turn'> & {
  matched: readonly ProducedFileReview[]
  /** Session workspace root (reserved; the chat card shows tool paths verbatim). */
  projectRoot?: string | undefined
  inspectChanges?: (request: FileReviewRequest) => Promise<FileReviewResult>
  applyChanges?: (request: FileReviewRequest) => Promise<FileReviewResult>
  /**
   * Open the plugin's sidebar tab with the given paths pre-expanded
   * (the 审查 button passes every produced path; a file chip passes its own).
   * The owning turn number rides along so the tab expands only this turn's
   * rows — a path that recurs in other turns stays collapsed there.
   */
  openInSidebarTab?: (paths: readonly string[], turn?: number) => void
} & PropsLocale<typeof NS>

const unavailableChanges = async (request: FileReviewRequest): Promise<FileReviewResult> => ({
  files: request.files.map(file => ({
    path: file.path,
    state: 'unsupported',
    changed: false,
    reason: 'Host file toggle is unavailable',
  })),
})

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

/** Render one turn's produced files as a summary card opening the sidebar tab. */
export function ProducedFiles({
  matched: matchedReviews, openFile, turn: turnLocation,
  projectRoot,
  inspectChanges = unavailableChanges, applyChanges = unavailableChanges,
  openInSidebarTab, t,
}: ProducedFilesProps) {
  // The owning turn number (TurnLocation.turn) rides every deep link so the
  // sidebar tab expands this turn's rows only.
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
  // Deleted paths carry no hunks and cannot be inspected or toggled; they are
  // display vocabulary on the chips only. Fs-level deletions DO carry a
  // whole-file diff and are toggleable (host fs semantics restore the file).
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
      // fs shapes: single whole-file diff (added: no before; deleted: empty after).
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
  // A turn that only deleted files reads as a deletion summary, not an edit.
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
      // The action remains usable after a transient inspection failure; execution
      // performs the same Host-side checks again.
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
          {reviewsWithStats.map(({ review, stats }) => {
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
                  <span className={css.fileName}>{basename(review.path)}</span>
                  {review.deleted === true
                    ? <span className={css.deletedBadge}>{t('produced.deleted')}</span>
                    : review.dir === true
                      ? <span className={css.deletedBadge}>{t('produced.dir')}</span>
                      : (
                        <Stats
                          stats={stats}
                          label={t('review.stats', {
                            added: String(stats.added), removed: String(stats.removed),
                          })}
                        />
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
          })}
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
