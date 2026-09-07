/**
 * 文件审查侧栏 tab·「从快照恢复此轮」对话框。
 *
 * 每轮头部按钮唤起，走本插件宿主的 /shadow-rewind?turn= 分支：预览 →
 * （对称模式）勾选子集 → POST 执行。全部状态自持（loading/preview/applying/
 * stale/error/done/selected），父组件只提供窗口统计与跳转回调。
 *
 * srw-* 对话框样式由本插件的会话回退面（rewind.ts）全局注入，直接复用，
 * 保证两个恢复入口的视觉与交互一致。
 */

import { useCallback, useEffect, useState } from 'react'
import { pathsTooLong, fetchSubsetPlan } from './subset-plan.ts'
import { t } from './locales.ts'
import { Stats } from './review-widgets.tsx'
import type { PathWindowStats } from './file-review-tab-types.ts'
import css from './FileReviewTab.module.css'

export interface TurnRewindDialogProps {
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
export interface TurnRewindPreview {
  readonly status: 'ready' | 'pending' | 'skipped' | 'failed' | 'missing'
  readonly checkpointId?: string
  readonly planId?: string
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

/** 逐字段宽松解析宿主预览响应：任何形状偏差都退到安全缺省而非抛错。 */
export function decodeTurnPreview(value: unknown): TurnRewindPreview {
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
    ...(record.mode === 'symmetric' || record.mode === 'current-wins' ? { mode: record.mode } : {}),
    ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
    ...(typeof record.error === 'string' ? { error: record.error } : {}),
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
export function skipReasonLabel(reason: string): string {
  if (reason === 'too-large') return t('skipTooLarge')
  if (reason === 'unsupported-type') return t('skipUnsupportedType')
  if (reason === 'read-failed') return t('skipReadFailed')
  return reason
}

/** 快照差异类别的用户文案（与回退对话框的 kindLabel 语义一致）。 */
export function snapshotKindLabel(kind: string): string {
  switch (kind) {
    case 'added': return t('kindAdded')
    case 'deleted': return t('kindDeleted')
    case 'modified': return t('kindModified')
    case 'mode-changed': return t('kindModeChanged')
    case 'type-changed': return t('kindTypeChanged')
    default: return kind
  }
}

/** 按轮恢复对话框本体（状态机见文件头注释）。 */
export function TurnRewindDialog({ sessionId, turn, windowStats, onJumpToDiff, sessionTitle, onClose, onRestored }: TurnRewindDialogProps) {
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

  const canApply = ready !== null && !loading && !applying && !done && !stale
    && ready.totalChanges > 0
    && (!symmetric || selectedCount > 0)
    && ready.checkpointId !== undefined && ready.planId !== undefined

  const apply = useCallback(async () => {
    if (ready === null || !canApply) return
    if (ready.checkpointId === undefined || ready.planId === undefined) return
    setApplying(true)
    setError(null)
    try {
      let planId = ready.planId
      // 对称模式且未全选：先铸造只覆盖勾选路径的子集计划（确认由本弹窗
      // 承担——确认串已废除，EXPECTED-DESIGN 1.4 #2）。
      if (selected !== null && selected.size < ready.totalChanges) {
        const paths = ready.changes.filter(change => selected.has(change.path)).map(change => change.path)
        if (paths.length === 0) return
        if (pathsTooLong(paths)) throw new Error(t('pathsTooLong'))
        const subset = await fetchSubsetPlan(`sessionId=${encodeURIComponent(sessionId)}&turn=${String(turn)}`, paths)
        planId = subset.planId
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
        }),
      })
      const value: unknown = await response.json()
      if (!response.ok) {
        const record = typeof value === 'object' && value !== null && !Array.isArray(value)
          ? value as Record<string, unknown> : {}
        if (record.code === 'PLAN_STALE') setStale(true)
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
            {!loading && (ready === null || stale) && !done && (
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
