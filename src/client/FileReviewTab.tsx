/**
 * FileReviewTab —— better-sidebar tab 的本体：列出 agent 在**本会话**改过的
 * 每一个文件（按轮分组），行内渲染行级红/绿 diff，并经本包的宿主
 * file-review Typert remote 提供按轮 / 按文件的撤销 + 重新应用。全部推导都
 * 挂在客户端 runtime 的已定稿会话快照上——什么都不会注入聊天流（那正是本
 * 移植要消除的样式冲突源）。
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FileReviewAction, FileReviewFileState, FileReviewRequest, FileReviewResult,
  RecordedMutation, RecordedRequest, RecordedResult,
} from '../file-review/change-types.ts'
import {
  basename, deriveSessionChanges, deriveSessionRoots, mergeRecordedTurns,
  resolveSessionPath, type FsAttributionFields, type SessionFileChange, type TurnFileChanges,
} from './session-changes.ts'
import { ensureFsFileDiff, fetchAllFsChanges, fsAttributionOf, type FsChangeTurn } from './fs-diff-utils.ts'
import { summarizeDiffs, UnifiedDiff, type UnifiedDiffStats } from './UnifiedDiff.tsx'
import { fetchSubsetPlan, pathsTooLong } from './subset-plan.ts'
import { t } from './locales.ts'
import css from './FileReviewTab.module.css'

const SUCCESS_NOTICE_DURATION = 3000
const ERROR_NOTICE_DURATION = 8000

/** Tab 组件入参（better-sidebar 的 TabComponentProps 的收窄版）。 */
export interface FileReviewTabProps {
  readonly ctx: Context
  readonly sessionId: string
  readonly cwd: string | undefined
  /** 活跃 tab + 面板已打开；为 false 时暂停实时状态巡检。 */
  readonly visible: boolean
  /**
   * 侧边栏 tab 句柄。`meta.expandPaths`（string[]）就是聊天轮尾行经
   * updateTab / openTab 写入的深链：一份**新的** meta 引用会被重放成「展开
   * 这些文件的 diff 并滚到第一个」。
   */
  readonly tab: { readonly meta?: unknown }
}

/** 本 tab 用到的 fileReview 远端方法面。 */
interface FileReviewRemote {
  status(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
  apply(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
  recorded(request: RecordedRequest): Promise<RemoteResult<RecordedResult>>
}

/** 页内通知气泡（成功/失败短暂停留后自动消失）。 */
interface Notice {
  readonly seq: number
  readonly tone: 'success' | 'error'
  readonly text: string
}

/** 摊平后的 (轮, 文件) 变更单元，用于状态巡检与开关请求。 */
interface FlatChange extends FsAttributionFields {
  readonly turn: number
  readonly path: string
  readonly diffs: SessionFileChange['diffs']
  /** 终端删除的路径仍列出，但绝不送到宿主巡检器。 */
  readonly deleted?: true
  /** 条目来源：'fs' = 检查点对比派生（终端写盘）；缺省 = 工具结果视图。 */
  readonly origin?: 'fs'
  /** 空目录条目：提交时转成 dirKind，宿主走 mkdir/rmdir 语义。 */
  readonly dir?: true
  /** 服务端预算的行数（fs 条目懒加载全文前的显示用）。 */
  readonly counts?: { readonly added: number; readonly removed: number }
}

/** 一个 (轮, 文件) 变更组的状态映射键。 */
function stateKey(turn: number, path: string): string {
  return `${turn}|${path}`
}

/** ms epoch → HH:MM（归因徽标的写入时间展示）。 */
function formatClock(ms: number): string {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** fs 条目的归因徽标文案：开闸/旧宿主无归因（owner 缺省）→ 无徽标。
 * 命令级展示「命令 · 写入时间」；他会话展示会话标题；歧义/外部如实标注。 */
function fsOwnerBadge(file: SessionFileChange, sessionTitle: (id: string) => string | undefined): string | null {
  if (file.owner === undefined) return null
  if (file.attribution === 'command' && file.command !== undefined) {
    return `${file.command.tool} · ${formatClock(file.writtenAt ?? file.command.startedAt)}`
  }
  if (file.owner === 'multi') return t('ownerMulti')
  if (file.owner === 'unknown') return t('ownerUnknown')
  if (file.owner !== 'target') {
    const title = sessionTitle(file.owner)
    return title ?? t('ownerSession', {
      id: file.owner.length > 12 ? `${file.owner.slice(0, 12)}…` : file.owner,
    })
  }
  if (file.attribution === 'ambiguous') return t('attrAmbiguous')
  if (file.attribution === 'external') return t('attrExternal')
  return null
}

/** 深链的滚动目标：整轮链接滚到轮组，否则滚到文件行。 */
interface PendingScroll {
  /** 文件行的 stateKey：既是精确目标，也是所在节的回退目标。 */
  readonly rowKey: string
  /** 多文件链接时，其轮组的轮号——该轮组顶到视口顶部。 */
  readonly turn: number | null
}

/** 一个文件在本会话某轮的改动记录（文件级时间线节点；按轮升序累积）。 */
interface FileTurnEntry {
  readonly turn: number
  readonly live: boolean
  readonly deleted?: true
  readonly diffs: SessionFileChange['diffs']
  /** 服务端预算的行数（fs 条目懒加载全文前的显示用）。 */
  readonly counts?: { readonly added: number; readonly removed: number }
}

/** 恢复窗口内一个路径的累计统计与最近改动轮次（恢复对话框 +/− 跳转用）。 */
interface PathWindowStats {
  readonly stats: UnifiedDiffStats
  readonly latestTurn: number
}

/** 一组变更只有在 hunks 完整可逆时才判定为可撤销。 */
function isReversible(file: SessionFileChange): boolean {
  // 整文件 fs 变更形状（检查点对比）：单条 diff，要么是新增（无旧侧），要么
  // 是删除（新侧为空）。宿主按文件存在性翻转它们，不靠 hunk 回放。
  if (file.diffs.length === 1) {
    const only = file.diffs[0]
    if (only !== undefined && only.path === file.path) {
      if (only.oldText === null) return true
      if (only.newText === '' && only.oldText !== '') return true
    }
  }
  return file.diffs.length > 0 && file.diffs.every(diff =>
    diff.path === file.path
    && diff.oldText !== null
    && diff.oldText !== diff.newText
    && (diff.oldText !== '' || diff.oldStart !== undefined)
    && (diff.newText !== '' || diff.newStart !== undefined))
}

function addStats(left: UnifiedDiffStats, right: UnifiedDiffStats): UnifiedDiffStats {
  return { added: left.added + right.added, removed: left.removed + right.removed }
}

function Stats({ stats }: { readonly stats: UnifiedDiffStats }) {
  return (
    <span className={css.stats} aria-label={t('stats', {
      added: String(stats.added), removed: String(stats.removed),
    })}>
      <span className={css.added}>+{stats.added}</span>
      <span className={css.removed}>-{stats.removed}</span>
    </span>
  )
}

function UndoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="M8 5 4 9l4 4M4 9h7a5 5 0 0 1 5 5v1" />
    </svg>
  )
}

function RedoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="m12 5 4 4-4 4M16 9H9a5 5 0 0 0-5 5v1" />
    </svg>
  )
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`${css.chevron} ${open ? css.chevronOpen : ''}`}
    >
      <path d="m7 5 5 5-5 5" />
    </svg>
  )
}

/** 每个 (轮, 文件) 的宿主巡检状态徽标；'applied' 时不渲染任何东西。 */
function StateBadge({ state }: { readonly state: FileReviewFileState | undefined }) {
  if (state === undefined || state === 'applied') return null
  const label = state === 'undone'
    ? t('stateUndone')
    : state === 'conflict'
      ? t('stateConflict')
      : state === 'unsupported'
        ? t('stateUnsupported')
        : t('stateError')
  const tone = state === 'undone'
    ? css.badgeUndone
    : state === 'unsupported'
      ? css.badgeMuted
      : css.badgeError
  return <span className={`${css.stateBadge} ${tone}`}>{label}</span>
}

/** 懒渲染：只有行接近视口时才挂载重的 diff 渲染器（200px 预读余量）。 */
function LazyDiff({ children }: { children: ReactNode }) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (inView) return
    const element = holderRef.current
    if (element === null) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setInView(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px 0px' })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [inView])
  return <div ref={holderRef}>{inView ? children : <div style={{ minHeight: '96px' }} />}</div>
}

// ── 每轮「从快照恢复此轮」对话框（走本插件宿主的 /shadow-rewind?turn= 分支）──

interface TurnRewindDialogProps {
  readonly sessionId: string
  readonly turn: number
  /** 恢复窗口（该轮起）内本会话对每个路径的累计 +/-；其它会话写入的路径没有
   * 客户端 diff 数据，因此没有条目（对话框里这些行不显示统计）。 */
  readonly windowStats: ReadonlyMap<string, PathWindowStats>
  /** 点击某路径的 +/-：跳到该文件最近一轮的差异（父级负责关闭对话框）。 */
  readonly onJumpToDiff: (turn: number, path: string) => void
  /** 其它会话 id → displayTitle（会话列表快照查不到时回落截断 id）。 */
  readonly sessionTitle: (id: string) => string | undefined
  readonly onClose: () => void
  /** 恢复成功后回调（刷新 tab 的状态巡检）。 */
  readonly onRestored: () => void
}

/** `/shadow-rewind?turn=` 预览的浏览器侧形态（宽松解析）。 */
interface TurnRewindPreview {
  readonly status: 'ready' | 'pending' | 'skipped' | 'failed' | 'missing'
  readonly checkpointId?: string
  readonly planId?: string
  readonly confirmation?: string
  /** 恢复语义模式：current-wins=以当前为准（整树），symmetric=对称（勾选式子集）。 */
  readonly mode?: 'current-wins' | 'symmetric'
  readonly totalChanges: number
  readonly changes: readonly {
    readonly path: string
    readonly kind: string
    /** 对称模式归属：'target' | 'multi' | 'unknown' | 其它会话 id。 */
    readonly owner?: string
    /** 对称模式默认勾选（只属于目标会话的路径）。 */
    readonly autoSelect?: boolean
  }[]
  readonly activeSessionIds: readonly string[]
  /** 写入闸开启时的分诊：真正阻塞恢复的会话（请求者自身 / 当前所有者）。 */
  readonly restoreBlocked?: boolean
  readonly gatedSessionIds?: readonly string[]
  readonly skippedPaths: readonly { readonly path: string; readonly reason: string }[]
  readonly reason?: string
  readonly error?: string
  /** 分页（对称模式拉全清单时使用）。 */
  readonly truncated?: boolean
  readonly offset?: number
  /** 下一轮检查点 ID（本轮的变更 = 本轮轮起检查点与该检查点对比）。 */
  readonly nextCheckpointId?: string
  /** 文件系统级别的变更（PowerShell 等终端命令创建/修改/删除的文件）。 */
  readonly fileSystemChanges?: readonly { readonly path: string; readonly kind: 'added' | 'modified' | 'deleted' }[]
}

function decodeTurnPreview(value: unknown): TurnRewindPreview {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const status = record.status === 'ready' || record.status === 'pending'
    || record.status === 'skipped' || record.status === 'failed' || record.status === 'missing'
    ? record.status
    : 'missing'
  const changes = Array.isArray(record.changes)
    ? record.changes.map((entry) => {
      const item = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {}
      return {
        path: typeof item.path === 'string' ? item.path : '',
        kind: typeof item.kind === 'string' ? item.kind : 'modified',
        ...(typeof item.owner === 'string' ? { owner: item.owner } : {}),
        ...(item.autoSelect === true ? { autoSelect: true as const } : {}),
      }
    }).filter(change => change.path !== '')
    : []
  return {
    status,
    ...(typeof record.checkpointId === 'string' ? { checkpointId: record.checkpointId } : {}),
    ...(typeof record.planId === 'string' ? { planId: record.planId } : {}),
    ...(typeof record.confirmation === 'string' ? { confirmation: record.confirmation } : {}),
    ...(record.mode === 'symmetric' || record.mode === 'current-wins' ? { mode: record.mode } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
    ...(typeof record.restoreBlocked === 'boolean' ? { restoreBlocked: record.restoreBlocked } : {}),
    ...(Array.isArray(record.gatedSessionIds)
      ? { gatedSessionIds: record.gatedSessionIds.filter((id): id is string => typeof id === 'string') }
      : {}),
    totalChanges: typeof record.totalChanges === 'number' ? record.totalChanges : changes.length,
    changes,
    truncated: record.truncated === true,
    ...(typeof record.offset === 'number' ? { offset: record.offset } : {}),
    activeSessionIds: Array.isArray(record.activeSessionIds)
      ? record.activeSessionIds.filter((id): id is string => typeof id === 'string')
      : [],
    skippedPaths: Array.isArray(record.skippedPaths)
      ? record.skippedPaths.map((entry) => {
        const item = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
          ? entry as Record<string, unknown>
          : {}
        return {
          path: typeof item.path === 'string' ? item.path : '',
          reason: typeof item.reason === 'string' ? item.reason : '',
        }
      }).filter(skip => skip.path !== '')
      : [],
    // 新增：文件系统差异（PowerShell 等终端命令创建的文件）
    ...(typeof record.nextCheckpointId === 'string' ? { nextCheckpointId: record.nextCheckpointId } : {}),
    ...(Array.isArray(record.fileSystemChanges)
      ? {
          fileSystemChanges: record.fileSystemChanges
            .map((entry): { readonly path: string; readonly kind: 'added' | 'modified' | 'deleted' } => {
              const item = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
                ? entry as Record<string, unknown>
                : {}
              const path = typeof item.path === 'string' ? item.path : ''
              const rawKind = typeof item.kind === 'string' ? item.kind : 'modified'
              const kind = (rawKind === 'added' || rawKind === 'modified' || rawKind === 'deleted')
                ? rawKind
                : 'modified'
              return { path, kind }
            })
            .filter(change => change.path !== ''),
        }
      : {}),
  }
}

/** 快照跳过原因的用户文案。 */
function skipReasonLabel(reason: string): string {
  if (reason === 'too-large') return t('skipTooLarge')
  if (reason === 'unsupported-type') return t('skipUnsupportedType')
  if (reason === 'read-failed') return t('skipReadFailed')
  return reason
}

/** 快照差异类别的用户文案（与回退对话框的 kindLabel 语义一致）。 */
function snapshotKindLabel(kind: string): string {
  switch (kind) {
    case 'added': return t('kindAdded')
    case 'deleted': return t('kindDeleted')
    case 'modified': return t('kindModified')
    case 'mode-changed': return t('kindModeChanged')
    case 'type-changed': return t('kindTypeChanged')
    default: return kind
  }
}

function TurnRewindDialog({ sessionId, turn, windowStats, onJumpToDiff, sessionTitle, onClose, onRestored }: TurnRewindDialogProps) {
  const [loading, setLoading] = useState(true)
  const [preview, setPreview] = useState<TurnRewindPreview | null>(null)
  const [applying, setApplying] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  // 对称模式的勾选集（null = 非对称模式，整树恢复）。
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setStale(false)
      setError(null)
      setDone(false)
    }
    try {
      const response = await fetch(`/shadow-rewind?sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}`, {
        headers: { accept: 'application/json' }, cache: 'no-store',
      })
      const value: unknown = await response.json()
      if (!response.ok) {
        const record = typeof value === 'object' && value !== null && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        if (record.code === 'RESTORE_POINT_NOT_FOUND') {
          setPreview(null)
          setError(t('snapshotMissing'))
          return
        }
        throw new Error(typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`)
      }
      const first = decodeTurnPreview(value)
      // 对称模式：勾选清单必须覆盖全部变更——自动按页拉全（带归属标签），
      // 然后以「只属于目标会话」的路径为默认勾选。
      if (first.status === 'ready' && first.mode === 'symmetric' && first.truncated) {
        const collected = [...first.changes]
        let offset = collected.length
        while (first.totalChanges > offset) {
          const pageResponse = await fetch(`/shadow-rewind?sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}&details=1&offset=${String(offset)}&limit=200`, {
            headers: { accept: 'application/json' }, cache: 'no-store',
          })
          const pageValue: unknown = await pageResponse.json()
          if (!pageResponse.ok) {
            const pageRecord = typeof pageValue === 'object' && pageValue !== null && !Array.isArray(pageValue)
              ? pageValue as Record<string, unknown> : {}
            throw new Error(typeof pageRecord.error === 'string' ? pageRecord.error : `HTTP ${String(pageResponse.status)}`)
          }
          const page = decodeTurnPreview(pageValue)
          if (page.status !== 'ready' || page.checkpointId !== first.checkpointId || page.offset !== offset) {
            throw new Error(t('snapshotStale'))
          }
          collected.push(...page.changes)
          offset += page.changes.length
          if (page.changes.length === 0) break
        }
        const merged: TurnRewindPreview = { ...first, changes: collected, truncated: false }
        setPreview(merged)
        setSelected(new Set(merged.changes.filter(change => change.autoSelect === true).map(change => change.path)))
        return
      }
      setPreview(first)
      setSelected(first.status === 'ready' && first.mode === 'symmetric'
        ? new Set(first.changes.filter(change => change.autoSelect === true).map(change => change.path))
        : null)
    } catch (caught) {
      // 静默重查失败不动已有预览（占用未解除是常态，不算错误）。
      if (!silent) setError(`${t('snapshotFailed')}: ${caught instanceof Error ? caught.message : String(caught)}`)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [sessionId, turn])

  useEffect(() => { void load() }, [load])

  const ready = preview !== null && preview.status === 'ready' ? preview : null
  // 阻塞判定：优先用服务端的写入闸分诊（restoreBlocked），旧协议回退到
  // activeSessionIds 计数。
  const blocked = ready !== null
    && (ready.restoreBlocked ?? ready.activeSessionIds.length > 0)

  // 占用自动重查：blocked 期间每 3s 静默重取预览，占用解除的瞬间按钮就地
  // 变活——否则 blocked 时的预览不带 planId/confirmation，恢复按钮会一直
  // 死在禁用态，只能靠用户手点「重新检查」。
  useEffect(() => {
    if (!blocked || done || applying) return
    const timer = window.setInterval(() => { void load(true) }, 3000)
    return () => { window.clearInterval(timer) }
  }, [blocked, done, applying, load])
  const gatedRunning = ready?.gatedSessionIds?.length ?? 0
  const symmetric = ready?.mode === 'symmetric'
  const selectedCount = selected?.size ?? 0
  const allSelected = symmetric && ready !== null && selected !== null
    && selected.size >= ready.changes.length && ready.changes.length > 0

  const togglePath = useCallback((path: string) => {
    setSelected((current) => {
      if (current === null) return current
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const setAllPaths = useCallback((selectAll: boolean) => {
    setSelected((current) => {
      if (current === null) return current
      if (!selectAll) return new Set<string>()
      const readyNow = preview !== null && preview.status === 'ready' ? preview : null
      return readyNow === null ? current : new Set(readyNow.changes.map(change => change.path))
    })
  }, [preview])

  const canApply = ready !== null && !loading && !applying && !done && !stale && !blocked
    && ready.totalChanges > 0
    && (!symmetric || selectedCount > 0)
    && ready.checkpointId !== undefined && ready.planId !== undefined && ready.confirmation !== undefined

  const apply = useCallback(async () => {
    if (ready === null || !canApply) return
    if (ready.checkpointId === undefined || ready.planId === undefined || ready.confirmation === undefined) return
    setApplying(true)
    setError(null)
    try {
      let planId = ready.planId
      let confirmation = ready.confirmation
      // 对称模式且未全选：先铸造只覆盖勾选路径的子集计划（全套安全闸
      // 原样保留——确认串、TTL、逐路径 CAS 都随新计划走）。
      if (selected !== null && selected.size < ready.totalChanges) {
        const paths = ready.changes.filter(change => selected.has(change.path)).map(change => change.path)
        if (paths.length === 0) return
        if (pathsTooLong(paths)) throw new Error(t('pathsTooLong'))
        const subset = await fetchSubsetPlan(`sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}`, paths)
        planId = subset.planId
        confirmation = subset.confirmation
      }
      const response = await fetch('/shadow-rewind', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'code',
          sessionId,
          turn,
          checkpointId: ready.checkpointId,
          planId,
          confirmation,
        }),
      })
      const value: unknown = await response.json()
      if (!response.ok) {
        const record = typeof value === 'object' && value !== null && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        if (record.code === 'PLAN_STALE' || record.code === 'WORKSPACE_IN_USE') setStale(true)
        throw new Error(typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`)
      }
      setDone(true)
      onRestored()
    } catch (caught) {
      setError(`${t('snapshotFailed')}: ${caught instanceof Error ? caught.message : String(caught)}`)
    } finally {
      setApplying(false)
    }
  }, [ready, canApply, selected, sessionId, turn, onRestored])

  // srw-* 对话框样式由本插件的会话回退面（rewind.ts）全局注入，直接复用，
  // 保证两个恢复入口的视觉与交互一致。
  return (
    <div className="srw-overlay" role="dialog" aria-modal="true">
      <div className="srw-dialog">
        <div className="srw-dialog-head">
          <strong>{t('snapshotDialogTitle')}</strong>
          <button type="button" className="srw-trigger" onClick={onClose} aria-label={t('close')}>✕</button>
        </div>
        <div className="srw-content">
          <div className="srw-body">
            {loading && <p className="srw-status">{t('snapshotLoading')}</p>}
            {(preview?.status === 'pending') && <p className="srw-status">{t('snapshotLoading')}</p>}
            {(preview?.status === 'missing' || preview?.status === 'skipped') && (
              <p className="srw-error">{t('snapshotMissing')}</p>
            )}
            {preview?.status === 'failed' && (
              <p className="srw-error">{t('snapshotFailed')}: {preview.error ?? preview.reason ?? ''}</p>
            )}
            {ready !== null && [
              <p className="srw-warning" key="warn">{t('snapshotDialogWarn', { n: turn })}</p>,
              <div className="srw-summary" key="summary">
                <strong>
                  {symmetric
                    ? t('snapshotTotalSelected', { count: selectedCount, total: ready.totalChanges })
                    : t('snapshotTotal', { count: ready.totalChanges })}
                </strong>
              </div>,
              symmetric && <p className="srw-status" key="hint">{t('modeSymmetricHint')}</p>,
              blocked && <p className="srw-error" key="blocked">{t('snapshotBlocked')}</p>,
              gatedRunning > 0 && <p className="srw-warning" key="gated">{t('snapshotGatedRunning', { n: gatedRunning })}</p>,
              ready.skippedPaths.length > 0 && (
                <div className="srw-skipped" key="skipped">
                  <div>{t('snapshotSkipped')}</div>
                  {ready.skippedPaths.map(skip => (
                    <div key={skip.path}>
                      <code>{skip.path}</code>（{skipReasonLabel(skip.reason)}）
                    </div>
                  ))}
                </div>
              ),
              stale && <p className="srw-error" key="stale">{t('snapshotStale')}</p>,
              ready.totalChanges === 0 && <p className="srw-status" key="nochanges">{t('snapshotNoChanges')}</p>,
              ready.changes.length > 0 && (
                <div className="srw-files" key="files">
                  {symmetric && (
                    <label className="srw-select-all" key="selectall">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={(event) => { setAllPaths(event.target.checked) }}
                      />
                      {t('selectAll')}
                    </label>
                  )}
                  {ready.changes.map(change => {
                    const badge = change.owner === undefined || change.owner === 'target'
                      ? null
                      : change.owner === 'multi'
                        ? t('ownerMulti')
                        : change.owner === 'unknown'
                          ? t('ownerUnknown')
                          : sessionTitle(change.owner)
                            ?? t('ownerSession', { id: change.owner.length > 12 ? `${change.owner.slice(0, 12)}…` : change.owner })
                    const windowEntry = windowStats.get(change.path)
                    return (
                      <div className="srw-file" key={change.path}>
                        {symmetric && (
                          <input
                            type="checkbox"
                            checked={selected?.has(change.path) ?? false}
                            onChange={() => { togglePath(change.path) }}
                          />
                        )}
                        <code>{change.path}</code>
                        {badge !== null && <span className="srw-kind">{badge}</span>}
                        <span className="srw-kind">{snapshotKindLabel(change.kind)}</span>
                        {windowEntry !== undefined && (
                          <button
                            type="button"
                            className={css.statsButton}
                            title={t('viewDiff', { n: windowEntry.latestTurn })}
                            onClick={(event) => {
                              event.stopPropagation()
                              onJumpToDiff(windowEntry.latestTurn, change.path)
                            }}
                          >
                            <Stats stats={windowEntry.stats} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ),
            ]}
            {done && <p className="srw-status">{t('snapshotDone')}</p>}
            {error !== null && <p className="srw-error">{error}</p>}
            {!loading && (ready === null || stale || blocked) && !done && (
              <button type="button" className="srw-retry" onClick={() => { void load() }}>
                {t('snapshotRetry')}
              </button>
            )}
          </div>
        </div>
        <div className="srw-foot">
          <button type="button" onClick={onClose} disabled={applying}>{t('cancel')}</button>
          <button type="button" onClick={() => { void apply() }} disabled={!canApply}>
            {applying ? t('snapshotApplying') : done ? t('close') : t('snapshotApply')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 多会话确认弹窗：提交批次含 owner === 'multi'（真冲突）才弹 ──

interface MultiSessionConfirmProps {
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

/** 骨架复刻 TurnRewindDialog 的 srw-* 样式；纯同步确认，无 fetch 状态机。 */
function MultiSessionConfirmDialog({ items, action, sessionTitle, onCancel, onManual, onProceed }: MultiSessionConfirmProps) {
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

// ── 文件级时间线：一个文件在本会话被改动的每一轮；点 +/- 跳到该轮差异 ──

interface FileTimelineDialogProps {
  readonly path: string
  /** 该文件的逐轮改动（轮次升序）。 */
  readonly entries: readonly FileTurnEntry[]
  /** 点击某轮的 +/- 统计：父级关闭对话框并滚动到那一轮的差异。 */
  readonly onPick: (turn: number) => void
  readonly onClose: () => void
}

function FileTimelineDialog({ path, entries, onPick, onClose }: FileTimelineDialogProps) {
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

/** 侧边栏 tab 本体：逐轮变更组 + 行内 diff + 撤销。 */
export function FileReviewTab({ ctx, sessionId, cwd, visible, tab }: FileReviewTabProps) {
  const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
  const [states, setStates] = useState<ReadonlyMap<string, FileReviewFileState>>(() => new Map())
  const [statusPending, setStatusPending] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [tick, setTick] = useState(0)
  // 块级选择：stateKey → 选中 hunk 下标集合；缺省（无条目）= 隐式全选。
  const [hunkSelection, setHunkSelection] = useState<ReadonlyMap<string, ReadonlySet<number>>>(() => new Map())
  // 打开「从快照恢复此轮」对话框的回合号；null = 关闭。
  const [rewindTurn, setRewindTurn] = useState<number | null>(null)
  // 打开文件级时间线对话框的路径；null = 关闭。
  const [timelinePath, setTimelinePath] = useState<string | null>(null)
  // 多会话确认弹窗的待提交批次（批次含 owner === 'multi' 时暂存）；null = 关闭。
  const [pendingConfirm, setPendingConfirm] = useState<{
    key: string
    items: readonly FlatChange[]
    action: FileReviewAction
  } | null>(null)
  const noticeSeqRef = useRef(0)
  const noticeTimerRef = useRef<number | null>(null)

  // 本会话的 Live Chat 快照（dsh 0.1.2：会话变更推导的数据源从
  // runtime 会话快照换成 uiConversation 会话绑定的 `chat` 目标快照）。
  const uiConversation = (ctx as unknown as {
    readonly uiConversation?: {
      binding(source: string): {
        target(target: 'chat'): { subscribe(listener: () => void): () => void; getSnapshot(): ChatSnapshot | undefined }
      }
    }
  }).uiConversation
  const chatSource = useMemo(
    () => uiConversation?.binding(sessionId).target('chat'),
    [uiConversation, sessionId],
  )
  const subscribe = useCallback(
    (listener: () => void) => chatSource?.subscribe(listener) ?? (() => {}),
    [chatSource],
  )
  const snapshot: ChatSnapshot | null = useSyncExternalStore(
    subscribe,
    () => chatSource?.getSnapshot() ?? null,
  )

  // 会话标题查询（归因徽标把「他会话 id」升级成可读标题；缺省回落 id 截断）。
  const sessionList = useSyncExternalStore(
    useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions]),
    () => sessions.list.getSnapshot(),
  )
  const sessionTitle = useCallback(
    (id: string) => sessionList.byId[id as SessionId]?.displayTitle,
    [sessionList],
  )

  // Code Mode（run_code）根调用及其宿主录制的变更：嵌套派发没有可复用的视图，
  // 所以每个根的变更要异步拉取，再并入下面快照推导出的各轮。拉取在根集合
  // 变化（新一轮 run_code）或手动刷新时重新触发。
  const roots = useMemo(
    () => (snapshot === null ? [] : deriveSessionRoots(snapshot)),
    [snapshot],
  )
  const rootsKey = useMemo(
    () => roots.map(root => root.rootCallId).join('|'),
    [roots],
  )
  const [recorded, setRecorded] = useState<readonly RecordedMutation[]>(() => [])
  // 经检查点对比发现的文件系统级变更（PowerShell 等终端写盘）：宿主的
  // /shadow-rewind/fs-changes 端点把每一轮的轮起检查点与**下一轮**的轮起
  // 检查点配对（= 轮末树状态），并预算好每文件的增/删行数。全文（整文件
  // diff）按需懒加载：展开 diff、撤销提交、恢复窗口统计时才拉，且按
  // (turn, path) 记忆。
  const [fsRaw, setFsRaw] = useState<readonly FsChangeTurn[]>([])
  const [ensuredFs, setEnsuredFs] = useState<ReadonlyMap<string, SessionFileChange>>(() => new Map())
  const fsRawRef = useRef(fsRaw)
  fsRawRef.current = fsRaw
  const ensuredFsRef = useRef(ensuredFs)
  ensuredFsRef.current = ensuredFs

  useEffect(() => {
    if (!visible || cwd === undefined || cwd.trim() === '') {
      setFsRaw([])
      return
    }

    let active = true

    fetchAllFsChanges(sessionId).then((payload) => {
      if (!active) return
      setFsRaw(payload.turns)
    }).catch(() => {
      if (!active) return
      setFsRaw([])
    })

    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tick, sessionId, cwd])

  /** 按需补齐 fs 条目全文（展开 diff、撤销提交、恢复窗口统计共用）。 */
  const ensureFsTurnFiles = useCallback(async (turn: number, paths?: readonly string[]): Promise<void> => {
    if (cwd === undefined) return
    const fsTurn = fsRawRef.current.find(entry => entry.turn === turn)
    if (fsTurn === undefined) return
    const wanted = fsTurn.changes.filter(change => (paths === undefined || paths.includes(change.path))
      && !ensuredFsRef.current.has(`${String(turn)}|${change.path}`))
    if (wanted.length === 0) return
    const settled = await Promise.all(wanted.map(async (change) => [
      `${String(turn)}|${change.path}`,
      await ensureFsFileDiff(fsTurn, change.path, cwd),
    ] as const))
    setEnsuredFs((current) => {
      const next = new Map(current)
      for (const [key, value] of settled) if (value !== null) next.set(key, value)
      return next
    })
    // 自动勾选：归因非本会话（autoSelect === false）的条目此时才知道 hunk 数，
    // 初始化为显式空勾选（行按钮默认禁用，须显式勾选才提交）；本会话写入与
    // 无归因条目保持隐式全选；已有用户选择绝不覆盖。
    setHunkSelection((current) => {
      let changed = false
      const next = new Map(current)
      for (const [key, value] of settled) {
        if (value === null || value.autoSelect !== false || next.has(key)) continue
        next.set(key, new Set<number>())
        changed = true
      }
      return changed ? next : current
    })
  }, [cwd])

  // fs 占位（计数）→ 已补齐条目的合并视图：同 (turn, path) 优先用懒加载全文。
  const fsTurns = useMemo<TurnFileChanges[]>(() => {
    const result: TurnFileChanges[] = []
    for (const fsTurn of fsRaw) {
      const files: SessionFileChange[] = []
      for (const change of fsTurn.changes) {
        const ensured = ensuredFs.get(`${String(fsTurn.turn)}|${change.path}`)
        if (ensured !== undefined) {
          files.push(ensured)
          continue
        }
        files.push({
          path: change.path,
          diffs: [],
          origin: 'fs',
          ...(change.dir === true ? { dir: true as const } : {}),
          ...(change.added !== undefined || change.removed !== undefined
            ? { counts: { added: change.added ?? 0, removed: change.removed ?? 0 } }
            : {}),
          ...(change.kind === 'deleted' ? { deleted: true as const } : {}),
          ...fsAttributionOf(change),
        })
      }
      if (files.length > 0) result.push({ turn: fsTurn.turn, live: false, files })
    }
    return result
  }, [fsRaw, ensuredFs])
  
  useEffect(() => {
    if (!visible || roots.length === 0) return
    let active = true
    const timer = window.setTimeout(() => {
      const scope = sessions.scope(sessionId as SessionId)
      const remote = scope?.remote.fileReview as FileReviewRemote | undefined
      if (scope === undefined || remote === undefined) { active = false; return }
      remote.recorded({ rootCallIds: roots.map(root => root.rootCallId) })
        .then((result) => {
          if (!result.ok || !active) return
          setRecorded(result.value.mutations)
        })
        .catch(() => {
          // 瞬时拉取失败：保留上一次的记录；下一轮快照 / 手动刷新会重试。
        })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rootsKey, tick, sessions, sessionId])

  const turns = useMemo(
    () => {
      const base = mergeRecordedTurns(deriveSessionChanges(snapshot), roots, recorded)
      // 把文件系统级变更（PowerShell 等）并入轮列表：同轮的组按文件逐个合并，
      // 保证同一轮绝不被渲染两遍。
      if (fsTurns.length === 0) return base
      const byTurn = new Map<number, TurnFileChanges>()
      for (const turn of base) byTurn.set(turn.turn, turn)
      for (const fsTurn of fsTurns) {
        const existing = byTurn.get(fsTurn.turn)
        if (existing === undefined) {
          byTurn.set(fsTurn.turn, fsTurn)
          continue
        }
        const files = [...existing.files]
        for (const fsFile of fsTurn.files) {
          const index = files.findIndex(f => f.path === fsFile.path)
          if (index === -1) files.push(fsFile)
          // 同路径的工具视图条目已经带着 hunks，保留它们。
        }
        byTurn.set(fsTurn.turn, { turn: existing.turn, live: existing.live, files })
      }
      return [...byTurn.values()].sort((a, b) => a.turn - b.turn)
    },
    [snapshot, roots, recorded, fsTurns],
  )
  const flat = useMemo<FlatChange[]>(
    () => turns.flatMap(turn => turn.files.map(file => ({
      turn: turn.turn, path: file.path, diffs: file.diffs,
      ...(file.deleted === true ? { deleted: true as const } : {}),
      ...(file.origin !== undefined ? { origin: file.origin } : {}),
      ...(file.counts !== undefined ? { counts: file.counts } : {}),
      ...fsAttributionOf(file),
    }))),
    [turns],
  )
  // 没有 diffs 的删除条目（rm 命令记录）没东西可巡检或开关；fs 级删除带着
  // 整文件 diff，**可以**开关。
  // fs 占位条目（全文未补齐）同样不参与巡检——补齐后经 flatKey 自动加入。
  const inspectable = useMemo(
    () => flat.filter(item => (item.deleted !== true || item.diffs.length > 0)
      && !(item.origin === 'fs' && item.diffs.length === 0)),
    [flat],
  )
  // 稳定的内容键：巡检 effect 只在变更**集合**变化时才重触发，而不是每次
  // token 刷新的快照身份变化都重触发。
  const flatKey = useMemo(
    () => flat.map(item => `${item.turn}|${item.path}|${item.diffs.length}`).join(';'),
    [flat],
  )
  const flatRef = useRef(flat)
  flatRef.current = flat

  // 深链管道：按 stateKey 收集文件行元素、按轮号收集轮组元素供
  // scrollIntoView，另记上一次重放过的 meta 引用与待滚动的目标。
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const turnRefs = useRef(new Map<number, HTMLElement>())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const lastMetaRef = useRef<unknown>(undefined)
  const pendingScrollRef = useRef<PendingScroll | null>(null)

  // 侧边栏 tab 的深链：聊天行的「审查」按钮（与单文件 chip）以
  // `tab.meta.expandPaths` 落到这里。一份**新的** meta 引用会重放展开——
  // 并入用户自己的展开集，绝不替换它——并排一个把链接目标滚到 tab 体顶部
  // 的滚动。引用未变（由无关侧栏状态引起的重渲染）时绝不会重夺用户手工的
  // 展开 / 折叠状态。
  useEffect(() => {
    const meta = tab.meta
    if (meta === lastMetaRef.current) return
    lastMetaRef.current = meta
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return
    const raw = (meta as { expandPaths?: unknown; turn?: unknown }).expandPaths
    if (!Array.isArray(raw)) return
    const paths = raw.filter((value): value is string => typeof value === 'string')
    if (paths.length === 0) return
    const turnNo = (meta as { turn?: unknown }).turn
    const targetTurn = typeof turnNo === 'number' && Number.isInteger(turnNo) ? turnNo : undefined
    // 带轮锚点时只有**那一轮**的行展开——在其它轮反复出现的路径保持折叠；
    // 不带锚点则每一处出现都展开（旧版 meta 形状）。
    const matches = (item: FlatChange): boolean =>
      paths.includes(item.path) && (targetTurn === undefined || item.turn === targetTurn)
    setExpanded((current) => {
      const next = new Set(current)
      for (const item of flatRef.current) {
        if (matches(item)) next.add(stateKey(item.turn, item.path))
      }
      return next
    })
    const first = flatRef.current.find(item => matches(item))
    // 多路径链接（「审查」按钮）以轮组为目标，让整段审查领先视口；单路径
    // 链接（文件 chip）以该文件行为目标。匹配不到的链接不留下任何待办。
    pendingScrollRef.current = first === undefined ? null : {
      rowKey: stateKey(first.turn, first.path),
      turn: paths.length > 1 ? first.turn : null,
    }
  }, [tab.meta])

  // 把深链目标滚到 tab 体**顶部**——居中会让长审查横跨视口、读起来像没滚
  // 到位。整轮链接解析到轮组（其头部领先），单文件链接到该文件行；当所在
  // 节还没挂载时后者也是回退目标。元素一时找不到（会话快照可能还在流式
  // 进来）目标就保持 pending，于是 `flatKey` 在行挂载后重新触发滚动，
  // `visible` 在面板还在打开时推迟它。延迟的第二跳覆盖「diff 体在展开提交
  // 后一个布局周期才挂载」的情况。
  //
  // 滚动只算在 tab **自己的** body 上：按规范 `element.scrollIntoView(
  // { block: 'start' })` 会滚动**每一个**可滚动的祖先——在侧栏面板里这会
  // 拖走外层容器，面板的 tab 条头部就骑在其中一个里面、会被滚出视野
  // （issue #4）。手工容器数学绝不会挪动这个 body 之外的东西。
  useEffect(() => {
    if (!visible) return
    const pending = pendingScrollRef.current
    if (pending === null) return
    const element = (pending.turn !== null ? turnRefs.current.get(pending.turn) : undefined)
      ?? rowRefs.current.get(pending.rowKey)
    if (element === undefined) return
    pendingScrollRef.current = null
    const scroll = () => {
      const container = bodyRef.current
      if (container === null) return
      const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top
      container.scrollTo({ top: container.scrollTop + delta - 8, behavior: 'smooth' })
    }
    scroll()
    const timer = window.setTimeout(scroll, 150)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, expanded, tab.meta, flatKey])

  const showNotice = useCallback((tone: Notice['tone'], text: string) => {
    noticeSeqRef.current += 1
    const seq = noticeSeqRef.current
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(
      () => { setNotice(current => current?.seq === seq ? null : current) },
      tone === 'success' ? SUCCESS_NOTICE_DURATION : ERROR_NOTICE_DURATION,
    )
    setNotice({ seq, tone, text })
  }, [])

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  // 写入闸运行时开关（宿主全局，不持久化；重启回到配置初值）。
  // 挂载时读取宿主状态；端点不可用（旧版宿主）时按钮保持禁用。
  const [gateOn, setGateOn] = useState<boolean | null>(null)
  useEffect(() => {
    let active = true
    fetch('/shadow-rewind/gate', { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then((response) => response.json())
      .then((value: unknown) => {
        if (!active) return
        const record = typeof value === 'object' && value !== null && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        if (typeof record.enabled === 'boolean') setGateOn(record.enabled)
      })
      .catch(() => { /* 端点不可用：按钮保持禁用 */ })
    return () => { active = false }
  }, [])
  const toggleGate = useCallback(() => {
    const next = !(gateOn ?? true)
    fetch('/shadow-rewind/gate', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      return response.json() as Promise<unknown>
    }).then((value) => {
      const record = typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown> : {}
      if (typeof record.enabled !== 'boolean') throw new Error('invalid response')
      setGateOn(record.enabled)
      showNotice('success', record.enabled ? t('gateTitleOn') : t('gateTitleOff'))
    }).catch((error: unknown) => {
      showNotice('error', `${t('gateToggleFailed')}: ${error instanceof Error ? error.message : String(error)}`)
    })
  }, [gateOn, showNotice])

  // Remote 调用路径沿用 dsh-file-review。dsh 0.1.2 起 scope 的 Remote 是
  // 网关客户端面（agent 标签路由），fileReview 命名空间直接可调。
  const invoke = useCallback(async (
    method: 'status' | 'apply',
    request: FileReviewRequest,
  ): Promise<FileReviewResult> => {
    const scope = sessions.scope(sessionId as SessionId)
    if (scope === undefined) throw new Error(t('sessionUnavailable'))
    const remote = scope.remote.fileReview as FileReviewRemote | undefined
    if (remote === undefined) throw new Error(t('remoteUnavailable'))
    const result = await remote[method](request)
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }, [sessions, sessionId])

  // 宿主侧状态巡检：哪些录制变更仍 applied、已 undone、或冲突。tab 不可见
  // 时暂停。
  useEffect(() => {
    if (!visible || flat.length === 0) return
    let active = true
    setStatusPending(true)
    // 尾沿防抖：流式回合会随每个 hunk 不断顶高 flatKey；300ms 静默窗口里只
    // 让一次宿主往返存活下来。
    const timer = window.setTimeout(() => {
      const request: FileReviewRequest = {
        action: 'undo',
        files: inspectable.map(item => ({ path: item.path, diffs: item.diffs })),
      }
      invoke('status', request).then((result) => {
        if (!active) return
        setStates(() => {
          const next = new Map<string, FileReviewFileState>()
          inspectable.forEach((item, index) => {
            const file = result.files[index]
            if (file !== undefined) next.set(stateKey(item.turn, item.path), file.state)
          })
          return next
        })
      }).catch(() => {
        // 巡检瞬时失败：按钮保持可用——apply 在碰磁盘前会再跑同样的宿主校验。
      }).finally(() => {
        if (active) setStatusPending(false)
      })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, flatKey, tick, invoke])

  const mergeResultStates = useCallback((
    items: readonly FlatChange[],
    result: FileReviewResult,
  ) => {
    setStates((current) => {
      const next = new Map(current)
      items.forEach((item, index) => {
        const file = result.files[index]
        if (file !== undefined) next.set(stateKey(item.turn, item.path), file.state)
      })
      return next
    })
  }, [])

  /** Toggle one change set (a whole turn, or one file) undo ↔ redo — 提交闸
   * 单点：轮/文件按钮都传全文，筛选在此统一完成。
   * ① autoSelect === false 的条目（其它会话/歧义写入）须有显式勾选才纳入；
   * ② 批次含 owner === 'multi'（真多会话冲突）⇒ 先弹确认窗，确认后走
   * applyToggle；其余批次直接提交。 */
  const applyToggle = useCallback((
    key: string,
    items: readonly FlatChange[],
    action: FileReviewAction,
  ) => {
    if (busyKey !== null || items.length === 0) return
    setBusyKey(key)
    let submitted: FlatChange[] = []
    void (async () => {
      // fs 占位条目先按需补齐全文再提交（零全文条目宿主无法回放）。
      const ensuredItems: FlatChange[] = []
      for (const item of items) {
        if (item.diffs.length > 0 || item.origin !== 'fs') {
          ensuredItems.push(item)
          continue
        }
        await ensureFsTurnFiles(item.turn, [item.path])
        const ensured = ensuredFsRef.current.get(`${String(item.turn)}|${item.path}`)
        if (ensured !== undefined) {
          ensuredItems.push({
            ...item,
            diffs: ensured.diffs,
            ...(ensured.deleted === true ? { deleted: true as const } : {}),
          })
        }
      }
      // hunk 子集裁剪：有勾选则只提交勾选部分（子集为空 ⇒ 该条不提交）。
      submitted = ensuredItems.flatMap((item) => {
        if (item.diffs.length === 0) return []
        const selection = hunkSelection.get(stateKey(item.turn, item.path))
        if (selection === undefined || selection.size >= item.diffs.length) return [item]
        const subset = item.diffs.filter((_, index) => selection.has(index))
        return subset.length > 0 ? [{ ...item, diffs: subset }] : []
      })
      if (submitted.length === 0) return undefined
      return invoke('apply', {
        action,
        files: submitted.map(item => ({
          path: item.path,
          diffs: item.diffs,
          ...(item.origin !== undefined ? { origin: item.origin } : {}),
          ...(item.dir === true
            ? { dirKind: item.deleted === true ? 'deleted' as const : 'added' as const }
            : {}),
        })),
      })
    })().then((result) => {
      if (result === undefined) return
      mergeResultStates(submitted, result)
      const target = action === 'undo' ? 'undone' : 'applied'
      const failures = result.files.filter(file => file.state !== target)
      if (failures.length === 0) {
        showNotice('success', t(action === 'undo' ? 'undoSuccess' : 'redoSuccess'))
      } else {
        showNotice('error', t(action === 'undo' ? 'undoPartial' : 'redoPartial'))
      }
    }).catch((error: unknown) => {
      showNotice('error', `${t('toggleError')}: ${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => { setBusyKey(null) })
  }, [busyKey, ensureFsTurnFiles, hunkSelection, invoke, mergeResultStates, showNotice])

  const runToggle = useCallback((
    key: string,
    items: readonly FlatChange[],
    action: FileReviewAction,
  ) => {
    if (busyKey !== null || items.length === 0) return
    // autoSelect === false 且无显式勾选 ⇒ 不纳入提交批次（默认不勾选 ⇒
    // 提交必经用户显式勾选，纯他会话文件由此无需弹窗确认）。
    const candidates = items.filter((item) => {
      if (item.autoSelect !== false) return true
      const selection = hunkSelection.get(stateKey(item.turn, item.path))
      return selection !== undefined && selection.size > 0
    })
    if (candidates.length === 0) return
    if (candidates.some(item => item.owner === 'multi')) {
      setPendingConfirm({ key, items: candidates, action })
      return
    }
    void applyToggle(key, candidates, action)
  }, [busyKey, hunkSelection, applyToggle])

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /** 更新一个 (turn, path) 的 hunk 勾选；回到全选时清除条目（隐式全选）。 */
  const changeHunkSelection = useCallback((key: string, total: number, next: ReadonlySet<number>) => {
    setHunkSelection((current) => {
      const map = new Map(current)
      if (next.size >= total) map.delete(key)
      else map.set(key, next)
      return map
    })
  }, [])

  const selectedHunkCount = useCallback((file: SessionFileChange, key: string): number => {
    const selection = hunkSelection.get(key)
    return selection === undefined ? file.diffs.length : selection.size
  }, [hunkSelection])

  const openInEditor = useCallback((path: string) => {
    const absolute = resolveSessionPath(cwd, path)
    const sidebar = (ctx as unknown as {
      betterSidebar?: { openFile(scope: { sessionId: string; cwd?: string }, path: string, title?: string): void }
    }).betterSidebar
    sidebar?.openFile({ sessionId, ...(cwd !== undefined ? { cwd } : {}) }, absolute, basename(absolute))
  }, [ctx, cwd, sessionId])

  const totalStats = useMemo(() => flat.reduce<UnifiedDiffStats>(
    (total, item) => addStats(total, item.counts ?? summarizeDiffs(item.diffs)),
    { added: 0, removed: 0 },
  ), [flat])

  // 文件级时间线数据：路径 → 逐轮改动（turns 本身按轮升序，逐条追加即升序）。
  const timelineForPath = useMemo(() => {
    const map = new Map<string, FileTurnEntry[]>()
    for (const turn of turns) {
      for (const file of turn.files) {
        const list = map.get(file.path) ?? []
        list.push({
          turn: turn.turn, live: turn.live, diffs: file.diffs,
          ...(file.deleted === true ? { deleted: true as const } : {}),
          ...(file.counts !== undefined ? { counts: file.counts } : {}),
        })
        map.set(file.path, list)
      }
    }
    return map
  }, [turns])
  const timelineEntries = timelinePath === null ? [] : timelineForPath.get(timelinePath) ?? []

  // 按轮恢复窗口（第 rewindTurn 轮起）内本会话各路径的累计 +/- 与最近改动轮次。
  const windowStats = useMemo(() => {
    const map = new Map<string, PathWindowStats>()
    if (rewindTurn === null) return map
    for (const entry of flat) {
      if (entry.turn < rewindTurn) continue
      const existing = map.get(entry.path)
      const stats = entry.counts ?? summarizeDiffs(entry.diffs)
      map.set(entry.path, {
        stats: existing === undefined ? stats : addStats(existing.stats, stats),
        latestTurn: existing === undefined ? entry.turn : Math.max(existing.latestTurn, entry.turn),
      })
    }
    return map
  }, [flat, rewindTurn])

  /** 从时间线/恢复对话框跳到某个（轮, 文件）的差异：关掉浮层、展开该行并滚动
   * 到位（setExpanded 总是产生新 Set，滚动副作用必然重放）。 */
  const jumpToFile = useCallback((turn: number, path: string) => {
    setTimelinePath(null)
    setRewindTurn(null)
    const key = stateKey(turn, path)
    setExpanded((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })
    pendingScrollRef.current = { rowKey: key, turn: null }
  }, [])

  /** 渲染一个轮组（最新轮在前）。 */
  const renderTurn = (turn: TurnFileChanges) => {
    const turnStats = turn.files.reduce<UnifiedDiffStats>(
      (total, file) => addStats(total, file.counts ?? summarizeDiffs(file.diffs)),
      { added: 0, removed: 0 },
    )
    const reversible = turn.files.filter(isReversible)
    // fs 占位条目（全文未补齐）也可操作：提交时按需补齐。
    const toggleable = turn.files.filter(file => file.deleted !== true || file.diffs.length > 0 || file.dir === true)
    const hasToggleable = toggleable.some(file => file.diffs.length > 0 || file.origin === 'fs')
    const allUndone = reversible.length > 0
      && reversible.every(file => states.get(stateKey(turn.turn, file.path)) === 'undone')
    const turnAction: FileReviewAction = allUndone ? 'redo' : 'undo'
    const turnKey = `turn:${turn.turn}`
    const turnBusy = busyKey === turnKey
    // 轮头部汇总：该轮存在非本会话归属的 fs 写入时提示总数（不逐文件枚举）。
    const otherWrites = turn.files.filter(file => file.origin === 'fs'
      && file.owner !== undefined && file.owner !== 'target').length
    return (
      <section
        key={turn.turn}
        ref={(element) => {
          if (element === null) turnRefs.current.delete(turn.turn)
          else turnRefs.current.set(turn.turn, element)
        }}
        className={css.turnGroup}
      >
        <header className={css.turnHeader}>
          <span className={css.turnTitle}>{t('turn', { n: turn.turn })}</span>
          {turn.live && <span className={css.liveBadge}>{t('turnLive')}</span>}
          <span className={css.turnCount}>
            {turn.files.length === 1 ? t('filesOne') : t('files', { count: turn.files.length })}
          </span>
          <Stats stats={turnStats} />
          {otherWrites > 0 && (
            <span className={css.ownerBadge}>{t('turnOtherSessions', { count: otherWrites })}</span>
          )}
          <button
            type="button"
            className={css.actionButton}
            disabled={statusPending || busyKey !== null || !hasToggleable}
            title={!hasToggleable ? t('toggleUnavailable') : undefined}
            onClick={() => {
              runToggle(turnKey, toggleable.map(file => ({
                turn: turn.turn, path: file.path, diffs: file.diffs,
                ...(file.origin !== undefined ? { origin: file.origin } : {}),
                ...(file.dir === true ? { dir: true as const } : {}),
                ...(file.deleted === true ? { deleted: true as const } : {}),
                ...fsAttributionOf(file),
              })), turnAction)
            }}
          >
            {turnAction === 'undo' ? <UndoIcon /> : <RedoIcon />}
            {turnBusy
              ? t(turnAction === 'undo' ? 'undoing' : 'redoing')
              : t(turnAction === 'undo' ? 'undoTurn' : 'redoTurn')}
          </button>
          <button
            type="button"
            className={css.smallButton}
            disabled={busyKey !== null}
            title={t('snapshotRestoreTitle')}
            onClick={(event) => {
              event.stopPropagation()
              // 恢复窗口统计需要 fs 条目的 +/-：先按需补齐（幂等，已补的跳过）。
              void ensureFsTurnFiles(turn.turn)
              setRewindTurn(turn.turn)
            }}
          >
            {t('snapshotRestore')}
          </button>
        </header>
        <ul className={css.fileList}>
          {turn.files.map(file => renderFile(turn, file))}
        </ul>
      </section>
    )
  }

  /** 渲染一个被改文件的行；展开时追加其行内 diff。 */
  const renderFile = (turn: TurnFileChanges, file: SessionFileChange) => {
    const key = stateKey(turn.turn, file.path)
    const isOpen = expanded.has(key)
    const state = states.get(key)
    const reversible = isReversible(file)
    // fs 占位条目（全文未补齐）也可撤销：提交时按需补齐。
    const fsPending = file.origin === 'fs' && file.diffs.length === 0
    const fileAction: FileReviewAction = state === 'undone' ? 'redo' : 'undo'
    const fileBusy = busyKey === key
    const stats = file.counts ?? summarizeDiffs(file.diffs)
    const selectedCount = selectedHunkCount(file, key)
    // rm 命令记录：只展示徽标。fs 级删除带着整文件 diff，与其它可开关变更
    // 行为一致。目录删除同理（补齐后走 dirKind 语义）——不算「无 diff 的
    // 删除」。
    const deletedNoDiff = file.deleted === true && file.diffs.length === 0 && file.dir !== true
    // fs 条目的归因徽标（开闸/旧宿主无归因 → 无徽标）。
    const fsBadge = file.origin === 'fs' ? fsOwnerBadge(file, sessionTitle) : null
    const expand = () => {
      toggleExpanded(key)
      if (fsPending) void ensureFsTurnFiles(turn.turn, [file.path])
    }
    return (
      <li
        key={file.path}
        className={css.fileItem}
        ref={(element) => {
          if (element === null) rowRefs.current.delete(key)
          else rowRefs.current.set(key, element)
        }}
      >
        <div
          className={css.fileRow}
          role="button"
          tabIndex={0}
          title={file.path}
          aria-expanded={isOpen}
          onClick={expand}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              expand()
            }
          }}
        >
          <Chevron open={isOpen} />
          <span className={css.fileName}>{basename(file.path)}</span>
          {file.deleted === true && <span className={css.deletedBadge}>{t('deleted')}</span>}
          {file.dir === true && <span className={css.deletedBadge}>{t('dirBadge')}</span>}
          {fsBadge !== null && <span className={css.ownerBadge}>{fsBadge}</span>}
          {!deletedNoDiff && <Stats stats={stats} />}
          {!deletedNoDiff && <StateBadge state={state} />}
          <button
            type="button"
            className={css.smallButton}
            title={t('timelineTitle')}
            onClick={(event) => {
              event.stopPropagation()
              setTimelinePath(file.path)
            }}
          >
            {t('timeline')}
          </button>
          {file.deleted !== true && file.dir !== true && (
            <button
              type="button"
              className={css.smallButton}
              onClick={(event) => {
                event.stopPropagation()
                openInEditor(file.path)
              }}
            >
              {t('openInEditor')}
            </button>
          )}
          <button
            type="button"
            className={css.smallButton}
            disabled={statusPending || busyKey !== null || !(reversible || fsPending) || ((reversible || file.autoSelect === false) && selectedCount === 0)}
            title={deletedNoDiff
              ? t('deletedHint')
              : (!(reversible || fsPending)
                ? t('toggleUnavailable')
                : ((reversible || file.autoSelect === false) && selectedCount === 0) ? t('hunkNoneSelected') : undefined)}
            onClick={(event) => {
              event.stopPropagation()
              runToggle(key, [{
                turn: turn.turn, path: file.path, diffs: file.diffs,
                ...(file.origin !== undefined ? { origin: file.origin } : {}),
                ...(file.dir === true ? { dir: true as const } : {}),
                ...(file.deleted === true ? { deleted: true as const } : {}),
                ...fsAttributionOf(file),
              }], fileAction)
            }}
          >
            {fileBusy
              ? t(fileAction === 'undo' ? 'undoing' : 'redoing')
              : t(fileAction === 'undo' ? 'undo' : 'redo')}
          </button>
        </div>
        {isOpen && (
          <div className={css.diffWrap}>
            <LazyDiff>
              {deletedNoDiff
                ? <p className={css.diffUnavailable}>{t('deletedHint')}</p>
                : file.dir === true
                  ? <p className={css.diffUnavailable}>{t('dirHint')}</p>
                  : file.diffs.length === 0
                    ? <p className={css.diffUnavailable}>{t('unavailable')}</p>
                    : (
                  <UnifiedDiff
                    diffs={file.diffs}
                    contextLines={3}
                    showCopyButton
                    showFileHeaders={false}
                    selectable
                    navigation
                    selectedHunks={hunkSelection.get(key)}
                    onSelectedHunksChange={(next) => { changeHunkSelection(key, file.diffs.length, next) }}
                    labels={{
                      copy: t('copy'),
                      copied: t('copied'),
                      showUnchanged: count => t('showUnchanged', { count }),
                      hideUnchanged: count => t('hideUnchanged', { count }),
                      hunkN: n => t('hunkN', { n }),
                      hunkInclude: t('hunkInclude'),
                    }}
                    className={css.reviewDiff}
                  />
                )}
            </LazyDiff>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className={css.root}>
      <header className={css.header}>
        <span className={css.headerTitle}>{t('tabTitle')}</span>
        {flat.length > 0 && <Stats stats={totalStats} />}
        <button
          type="button"
          className={css.smallButton}
          disabled={gateOn === null}
          title={gateOn === false ? t('gateTitleOff') : t('gateTitleOn')}
          onClick={toggleGate}
        >
          {gateOn === null ? t('gateUnknown') : gateOn ? t('gateOn') : t('gateOff')}
        </button>
        <button
          type="button"
          className={css.refreshButton}
          disabled={statusPending}
          title={t('refresh')}
          onClick={() => { setTick(value => value + 1) }}
        >
          ⟳
        </button>
      </header>
      {notice !== null && (
        <div
          className={`${css.notice} ${notice.tone === 'success' ? css.noticeSuccess : css.noticeError}`}
          role="alert"
        >
          {notice.text}
        </div>
      )}
      <div className={css.body} ref={bodyRef}>
        {turns.length === 0
          ? <div className={css.empty}>{t('empty')}</div>
          : [...turns].reverse().map(renderTurn)}
      </div>
      {rewindTurn !== null && (
        <TurnRewindDialog
          sessionId={sessionId}
          turn={rewindTurn}
          windowStats={windowStats}
          onJumpToDiff={jumpToFile}
          sessionTitle={sessionTitle}
          onClose={() => { setRewindTurn(null) }}
          onRestored={() => {
            setTick(value => value + 1)
            showNotice('success', t('snapshotDone'))
          }}
        />
      )}
      {pendingConfirm !== null && (
        <MultiSessionConfirmDialog
          items={pendingConfirm.items}
          action={pendingConfirm.action}
          sessionTitle={sessionTitle}
          onCancel={() => { setPendingConfirm(null) }}
          onManual={() => {
            const conflicts = pendingConfirm.items.filter(item => item.owner === 'multi')
            setPendingConfirm(null)
            // 展开冲突行并滚到首条；先补齐全文让勾选框即刻可用。
            for (const item of conflicts) void ensureFsTurnFiles(item.turn, [item.path])
            setExpanded((current) => {
              const next = new Set(current)
              for (const item of conflicts) next.add(stateKey(item.turn, item.path))
              return next
            })
            const first = conflicts[0]
            if (first !== undefined) pendingScrollRef.current = { rowKey: stateKey(first.turn, first.path), turn: null }
          }}
          onProceed={() => {
            const pending = pendingConfirm
            setPendingConfirm(null)
            void applyToggle(pending.key, pending.items, pending.action)
          }}
        />
      )}
      {timelinePath !== null && (
        <FileTimelineDialog
          path={timelinePath}
          entries={timelineEntries}
          onPick={(turn) => { jumpToFile(turn, timelinePath) }}
          onClose={() => { setTimelinePath(null) }}
        />
      )}
    </div>
  )
}
