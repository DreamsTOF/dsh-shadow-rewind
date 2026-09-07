/**
 * 设置页「插件配置」卡片（ABSORB-RECALL 1.2-1.6 / 三）。
 *
 * 挂在 `settings.plugin.item` keyed slot（key = Host 端 settings namespace
 * 'shadow-rewind'），内含三段：插件配置表单（env 锁定字段禁编辑、只提交
 * 相对基线的变更、放弃/恢复默认/保存）、排除清单编辑器（原文编辑 + 快速
 * 芯片）、快照管理（工作区→会话→检查点树 + 行内二次确认删除 + 磁盘占用 +
 * 立即 GC + 最近错误）。管理树与最近错误的数据源是 /shadow-rewind/manage
 * 与 /shadow-rewind/status 端点。
 *
 * 无障碍（第六节批次）：折叠钮一律 button + aria-expanded；异步状态区带
 * role=status + aria-live；键盘焦点可见（:focus-visible 样式）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'

/**
 * 宿主 ui-settings 包声明 `settings.plugin.item` keyed slot（按 settings
 * namespace 分发「插件配置」卡片），但该包不在插件 devDependencies 内——
 * 本地补 SlotMap 声明合并（kind/scope 按 recall 插件实测行为：keyed by
 * namespace、root 作用域）。运行时宿主有真声明，类型以本声明为准。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'settings.plugin.item': {
      kind: 'keyed'
      scope: 'root'
      keyProps: { readonly [namespace: string]: object }
    }
  }
}

const STYLE_ID = 'dsh-shadow-rewind-settings'

const styles = `
.srw-cfg-card{list-style:none;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));border-radius:12px;background:var(--dsw-alias-bg-layer-1,#0d1526);overflow:hidden}
.srw-cfg-cardbtn{display:flex;width:100%;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border:0;background:transparent;color:var(--dsw-alias-label-primary,#e6ecff);cursor:pointer;text-align:left;font-size:13px}
.srw-cfg-cardbtn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.srw-cfg-cardbtn:focus-visible,.srw-cfg-btn:focus-visible,.srw-cfg-foldbtn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#5b8cff);outline-offset:2px}
.srw-cfg-cardname{display:block;font-weight:600}
.srw-cfg-carddesc{display:block;margin-top:2px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.srw-cfg-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}
.srw-cfg-chevron[data-open="true"]{transform:rotate(180deg)}
.srw-cfg-body{display:flex;flex-direction:column;gap:12px;padding:4px 14px 14px}
.srw-cfg-foldbtn{display:flex;width:100%;align-items:center;gap:8px;padding:8px 2px;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#c6d2f2);cursor:pointer;font-size:12px;text-align:left}
.srw-cfg-foldbtn:hover{color:var(--dsw-alias-label-primary)}
.srw-cfg-foldbtn .srw-cfg-chevron[data-open="true"]{transform:rotate(90deg)}
.srw-cfg-row{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.srw-cfg-row label{display:flex;flex-direction:column;gap:3px;flex:1;min-width:0}
.srw-cfg-row input,.srw-cfg-row select{height:28px;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;padding:0 8px}
.srw-cfg-row input:disabled,.srw-cfg-row select:disabled{opacity:.55;cursor:not-allowed}
.srw-cfg-hint{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.srw-cfg-lock{flex:none;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-state-warn-primary,#fbbf24);font-size:10px}
.srw-cfg-actions{display:flex;justify-content:flex-end;gap:8px}
.srw-cfg-btn{height:28px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px}
.srw-cfg-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.srw-cfg-btn:disabled{opacity:.5;cursor:default}
.srw-cfg-btn[data-primary="true"]{background:var(--dsw-alias-state-business-primary,#5b8cff);border-color:transparent;color:#fff}
.srw-cfg-btn[data-danger="true"]{color:var(--dsw-alias-state-error-primary)}
.srw-cfg-btn[data-danger="true"]:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}
.srw-cfg-chips{display:flex;flex-wrap:wrap;gap:6px}
.srw-cfg-chip{height:22px;padding:0 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px}
.srw-cfg-chip:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.srw-cfg-tree{display:flex;flex-direction:column;gap:6px;font-size:12px}
.srw-cfg-ws{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px}
.srw-cfg-wsname{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--dsw-alias-label-primary);font-weight:600;word-break:break-all}
.srw-cfg-session{margin-top:6px;padding-left:14px;border-left:2px solid var(--dsw-alias-border-l1)}
.srw-cfg-ckpt{display:flex;align-items:center;gap:8px;padding:2px 0;color:var(--dsw-alias-label-secondary);min-width:0}
.srw-cfg-ckpt code{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srw-cfg-err{display:flex;flex-direction:column;gap:6px;font-size:12px}
.srw-cfg-errline{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);word-break:break-all}
.srw-cfg-errhint{color:var(--dsw-alias-state-warn-primary,#fbbf24)}
.srw-cfg-meta{color:var(--dsw-alias-label-tertiary);font-size:11px}
@media (prefers-reduced-motion: reduce){.srw-cfg-chevron{transition:none}}
`

// ── 端点数据形状 ─────────────────────────────────────────────────────────────

interface ConfigResponse {
  values: Record<string, unknown>
  defaults: Record<string, unknown>
  overridden: Record<string, unknown>
  envLocks: Record<string, boolean>
  writable: boolean
}
interface CheckpointRow { id: string; kind: string; turn?: number; phase?: string; label?: string; createdAt: number }
interface ManageList {
  workspaces: { workspace: string; sessions: { sessionId: string; count: number; checkpoints: CheckpointRow[] }[] }[]
  total: number
}
interface ErrorRow { time: number; message: string; count: number; hint: string | null }

async function fetchJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...init })
  const body = (await response.json()) as { error?: string; code?: string }
  if (!response.ok) throw new Error(body.error ?? `HTTP ${String(response.status)}`)
  return body
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${String(bytes)} B`
}

function formatTime(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

// ── 配置表单 ────────────────────────────────────────────────────────────────

const NUMBER_LABELS: readonly [string, string, string][] = [
  ['maxRestorePoints', '手动恢复点配额', 'rescue 备份点不占配额'],
  ['maxTurnCheckpointsPerSession', '每会话轮检查点配额', '轮起/轮末各一份'],
  ['maxFiles', '单次快照最大文件数', ''],
  ['maxFileBytes', '单文件字节上限', '超出不进快照'],
  ['maxSnapshotBytes', '单次快照总字节上限', ''],
  ['turnCheckpointTimeoutMs', '自动检查点超时 (ms)', '超时按可预期跳过'],
  ['turnCheckpointMaxNewBytes', '单轮新增字节上限', '超出跳过本轮快照'],
  ['planTtlMs', '恢复计划有效期 (ms)', '过期仅软警告'],
]

/** 常用排除模式一键芯片（ABSORB-RECALL 1.5）。 */
const EXCLUDE_CHIPS = ['dist/', 'build/', 'out/', 'coverage/', '*.log', '.env'] as const

function ConfigForm(): ReactNode {
  const [data, setData] = useState<ConfigResponse | null>(null)
  const [draft, setDraft] = useState<Record<string, string | string[]>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [excludeText, setExcludeText] = useState('')

  const load = useCallback(async () => {
    try {
      const body = await fetchJson('/shadow-rewind/config') as ConfigResponse
      setData(body)
      setDraft(Object.fromEntries(Object.entries(body.values).map(([key, value]) => [key, Array.isArray(value) ? [...value] : String(value)])))
      setExcludeText((Array.isArray(body.values.excludePatterns) ? body.values.excludePatterns as string[] : []).join('\n'))
      setSaveError(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const overriddenKeys = useMemo(() => new Set(Object.keys(data?.overridden ?? {})), [data])
  const dirty = useMemo(() => {
    if (data === null) return false
    return Object.keys(draft).some((key) => {
      const value = draft[key]
      return Array.isArray(value)
        ? JSON.stringify(value) !== JSON.stringify(data.values[key])
        : String(data.values[key]) !== value
    })
  }, [data, draft])

  const save = useCallback(async () => {
    if (data === null) return
    // 只提交相对基线（服务端 resolved 值）修改过的字段（ABSORB-RECALL 1.6）。
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(draft)) {
      if (data.envLocks[key] === true) continue
      if (Array.isArray(value)) {
        if (JSON.stringify(value) !== JSON.stringify(data.values[key])) patch[key] = value
      } else if (String(data.values[key]) !== value) {
        const numeric = Number(value)
        patch[key] = Number.isFinite(numeric) && String(numeric) === value.trim() ? numeric : value
      }
    }
    if (Object.keys(patch).length === 0) { setStatus('没有修改'); return }
    try {
      await fetchJson('/shadow-rewind/config', { method: 'POST', body: JSON.stringify({ patch }) })
      setStatus('已保存并热更新生效')
      await load()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }, [data, draft, load])

  const reset = useCallback(async () => {
    try {
      await fetchJson('/shadow-rewind/config', { method: 'POST', body: JSON.stringify({ op: 'reset' }) })
      setStatus('已恢复默认')
      await load()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }, [load])

  const saveExcludes = useCallback(async (patterns: string[]) => {
    try {
      await fetchJson('/shadow-rewind/config', { method: 'POST', body: JSON.stringify({ patch: { excludePatterns: patterns } }) })
      setStatus('排除清单已更新')
      await load()
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error))
    }
  }, [load])

  if (data === null) {
    return <div className="srw-cfg-hint" role="status" aria-live="polite">{saveError ?? '配置加载中…'}</div>
  }
  const locked = (key: string): boolean => data.envLocks[key] === true
  return (
    <div className="srw-cfg-body">
      {NUMBER_LABELS.map(([key, label, hint]) => (
        <div className="srw-cfg-row" key={key}>
          <label>
            <span>{label}{data.writable && locked(key) ? <span className="srw-cfg-lock">环境变量锁定</span> : null}</span>
            <input
              type="text"
              value={String(draft[key] ?? '')}
              disabled={!data.writable || locked(key)}
              onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
            />
            {hint !== '' ? <span className="srw-cfg-hint">{hint}</span> : null}
          </label>
        </div>
      ))}
      <div className="srw-cfg-row">
        <label>
          <span>检查点后端</span>
          <select value={String(draft.turnCheckpointMode ?? '')} disabled={!data.writable || locked('turnCheckpointMode')} onChange={(event) => setDraft((prev) => ({ ...prev, turnCheckpointMode: event.target.value }))}>
            <option value="jj">jj（影子仓库）</option>
            <option value="sqlite">sqlite（内置）</option>
            <option value="off">off（关闭）</option>
          </select>
          <span className="srw-cfg-hint">启动级：修改需重启 DSH 生效</span>
        </label>
      </div>
      <div className="srw-cfg-row">
        <label>
          <span>检查点信任级别</span>
          <select value={String(draft.turnCheckpointTrust ?? '')} disabled={!data.writable || locked('turnCheckpointTrust')} onChange={(event) => setDraft((prev) => ({ ...prev, turnCheckpointTrust: event.target.value }))}>
            <option value="fast">fast（stat 缓存）</option>
            <option value="strict">strict（全量读回）</option>
          </select>
        </label>
      </div>
      <div className="srw-cfg-hint">存储目录：{String(data.values.storageDir)}</div>
      <div className="srw-cfg-actions">
        <button type="button" className="srw-cfg-btn" disabled={!dirty} onClick={() => void load()}>放弃修改</button>
        <button type="button" className="srw-cfg-btn" disabled={!data.writable} onClick={() => void reset()}>恢复默认</button>
        <button type="button" className="srw-cfg-btn" data-primary="true" disabled={!dirty || !data.writable} onClick={() => void save()}>保存</button>
      </div>
      <div className="srw-cfg-row">
        <label>
          <span>排除清单{data.writable && locked('excludePatterns') ? <span className="srw-cfg-lock">环境变量锁定</span> : null}</span>
          <textarea
            rows={6}
            spellCheck={false}
            disabled={!data.writable || locked('excludePatterns')}
            value={excludeText}
            onChange={(event) => setExcludeText(event.target.value)}
          />
          <span className="srw-cfg-hint">每行一条，匹配的路径不进快照</span>
        </label>
      </div>
      <div className="srw-cfg-chips">
        {EXCLUDE_CHIPS.map((chip) => (
          <button
            type="button"
            key={chip}
            className="srw-cfg-chip"
            disabled={!data.writable || locked('excludePatterns')}
            onClick={() => {
              const current = excludeText.split('\n').map((line) => line.trim()).filter((line) => line !== '')
              if (!current.includes(chip)) void saveExcludes([...current, chip])
            }}
          >
            + {chip}
          </button>
        ))}
      </div>
      <div className="srw-cfg-actions">
        <button
          type="button"
          className="srw-cfg-btn"
          data-primary="true"
          disabled={!data.writable || locked('excludePatterns') || excludeText.split('\n').map((line) => line.trim()).filter((line) => line !== '').join('\n') === (Array.isArray(data.values.excludePatterns) ? (data.values.excludePatterns as string[]).join('\n') : '')}
          onClick={() => void saveExcludes(excludeText.split('\n').map((line) => line.trim()).filter((line) => line !== ''))}
        >
          保存排除清单
        </button>
      </div>
      <div role="status" aria-live="polite" className="srw-cfg-hint">{saveError ?? status ?? ''}</div>
    </div>
  )
}

// ── 快照管理面板（ABSORB-RECALL 三）─────────────────────────────────────────

function ManagePanel(): ReactNode {
  const [tree, setTree] = useState<ManageList | null>(null)
  const [usage, setUsage] = useState<{ totalBytes: number; perWorkspace: Record<string, number> } | null>(null)
  const [errors, setErrors] = useState<ErrorRow[] | null>(null)
  const [showAllErrors, setShowAllErrors] = useState(false)
  const [confirming, setConfirming] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [list, disk, status] = await Promise.all([
        fetchJson('/shadow-rewind/manage?op=list'),
        fetchJson('/shadow-rewind/manage?op=diskUsage'),
        fetchJson('/shadow-rewind/status'),
      ]) as [ManageList, { totalBytes: number; perWorkspace: Record<string, number> }, { errors?: ErrorRow[] }]
      setTree(list)
      setUsage(disk)
      setErrors(status.errors ?? [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const act = useCallback(async (body: Record<string, unknown>, confirmKey: string | null = null) => {
    setBusy(true)
    try {
      await fetchJson('/shadow-rewind/manage', { method: 'POST', body: JSON.stringify(body) })
      setMessage(null)
      setConfirming(confirmKey === null ? confirming : null)
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
      setConfirming(null)
    } finally {
      setBusy(false)
    }
  }, [confirming, load])

  const clearErrors = useCallback(async () => {
    try {
      await fetchJson('/shadow-rewind/status', { method: 'POST', body: JSON.stringify({ op: 'clear' }) })
      setErrors([])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    }
  }, [])

  const shownErrors = errors === null ? [] : (showAllErrors ? errors : errors.slice(0, 5))
  const visibleErrors = shownErrors.length > 0 || (errors !== null && errors.length > 0)
  return (
    <div className="srw-cfg-body">
      <div className="srw-cfg-actions">
        <button type="button" className="srw-cfg-btn" disabled={busy} onClick={() => { setConfirming(null); void load() }}>刷新</button>
        {usage !== null ? <span className="srw-cfg-meta">磁盘占用 {formatBytes(usage.totalBytes)}</span> : null}
      </div>
      <div className="srw-cfg-tree" role="status" aria-live="polite">
        {tree === null
          ? <span className="srw-cfg-hint">加载中…</span>
          : tree.workspaces.length === 0
            ? <span className="srw-cfg-hint">暂无工作区数据</span>
            : tree.workspaces.map((entry) => (
              <div className="srw-cfg-ws" key={entry.workspace}>
                <div className="srw-cfg-wsname">
                  <span>{entry.workspace}</span>
                  <span className="srw-cfg-actions">
                    {(() => {
                      const bytes = usage?.perWorkspace[entry.workspace]
                      return bytes !== undefined ? <span className="srw-cfg-meta">{formatBytes(bytes)}</span> : null
                    })()}
                    <button type="button" className="srw-cfg-btn" disabled={busy} onClick={() => { void act({ op: 'gc', cwd: entry.workspace }) }}>立即 GC</button>
                    {entry.sessions.length > 0 ? (
                      confirming === `ws:${entry.workspace}`
                        ? <button type="button" className="srw-cfg-btn" data-danger="true" disabled={busy} onClick={() => { void act({ op: 'deleteAll', cwd: entry.workspace }, `ws:${entry.workspace}`) }}>确认全部删除？</button>
                        : <button type="button" className="srw-cfg-btn" data-danger="true" disabled={busy} onClick={() => setConfirming(`ws:${entry.workspace}`)}>全部删除</button>
                    ) : null}
                  </span>
                </div>
                {entry.sessions.map((session) => (
                  <div className="srw-cfg-session" key={session.sessionId}>
                    <div className="srw-cfg-ckpt">
                      <code>会话 {session.sessionId}</code>
                      <span className="srw-cfg-meta">×{String(session.count)}</span>
                      {confirming === `ss:${entry.workspace}:${session.sessionId}`
                        ? <button type="button" className="srw-cfg-btn" data-danger="true" disabled={busy} onClick={() => { void act({ op: 'deleteSession', cwd: entry.workspace, sessionId: session.sessionId }, `ss:${entry.workspace}:${session.sessionId}`) }}>确认删除？</button>
                        : <button type="button" className="srw-cfg-btn" data-danger="true" disabled={busy} onClick={() => setConfirming(`ss:${entry.workspace}:${session.sessionId}`)}>删除</button>}
                    </div>
                    {session.checkpoints.map((point) => (
                      <div className="srw-cfg-ckpt" key={point.id}>
                        <code>{point.id}</code>
                        <span className="srw-cfg-meta">{point.kind}{point.turn !== undefined ? ` · 轮 ${String(point.turn)}${point.phase === 'end' ? ' 轮末' : ''}` : ''} · {formatTime(point.createdAt)}</span>
                        <button
                          type="button"
                          className="srw-cfg-btn"
                          data-danger="true"
                          disabled={busy}
                          onClick={() => {
                            if (confirming === `cp:${point.id}`) void act({ op: 'delete', cwd: entry.workspace, restorePointId: point.id }, `cp:${point.id}`)
                            else setConfirming(`cp:${point.id}`)
                          }}
                        >
                          {confirming === `cp:${point.id}` ? '确认删除？' : '删除'}
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
      </div>
      {visibleErrors ? (
        <div className="srw-cfg-err">
          <div className="srw-cfg-row">
            <span>最近错误{errors !== null ? `（${String(errors.length)}）` : ''}</span>
            <span className="srw-cfg-actions">
              {errors !== null && errors.length > 5 ? (
                <button type="button" className="srw-cfg-btn" onClick={() => setShowAllErrors((value) => !value)}>{showAllErrors ? '收起' : '展开全部'}</button>
              ) : null}
              <button type="button" className="srw-cfg-btn" onClick={() => { void clearErrors() }}>清空</button>
            </span>
          </div>
          {shownErrors.map((entry) => (
            <div className="srw-cfg-errline" key={`${String(entry.time)}:${entry.message}`}>
              <span>{entry.message}</span>
              {entry.hint !== null ? <span className="srw-cfg-errhint">{entry.hint}</span> : null}
              <span className="srw-cfg-meta">{formatTime(entry.time)}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div role="status" aria-live="polite" className="srw-cfg-hint">{message ?? ''}</div>
    </div>
  )
}

// ── 卡片装配 ────────────────────────────────────────────────────────────────

function ShadowRewindSettingsCard(): ReactNode {
  const [open, setOpen] = useState(false)
  const [sections, setSections] = useState({ config: true, manage: false })
  return (
    <li className="srw-cfg-card">
      <button
        type="button"
        className="srw-cfg-cardbtn"
        aria-expanded={open}
        aria-label={`${open ? '收起' : '展开'}：影子回退插件`}
        onClick={() => setOpen((value) => !value)}
      >
        <span>
          <span className="srw-cfg-cardname">影子回退</span>
          <span className="srw-cfg-carddesc">会话级快照与回退的配额、排除清单与检查点管理</span>
        </span>
        <svg className="srw-cfg-chevron" data-open={open} width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div className="srw-cfg-body">
          <button type="button" className="srw-cfg-foldbtn" aria-expanded={sections.config} onClick={() => setSections((prev) => ({ ...prev, config: !prev.config }))}>
            <span className="srw-cfg-chevron" data-open={sections.config} aria-hidden="true">▸</span>
            插件配置
          </button>
          {sections.config ? <ConfigForm /> : null}
          <button type="button" className="srw-cfg-foldbtn" aria-expanded={sections.manage} onClick={() => setSections((prev) => ({ ...prev, manage: !prev.manage }))}>
            <span className="srw-cfg-chevron" data-open={sections.manage} aria-hidden="true">▸</span>
            快照管理与最近错误
          </button>
          {sections.manage ? <ManagePanel /> : null}
        </div>
      ) : null}
    </li>
  )
}

/** 设置卡片挂载：settings.plugin.item keyed slot，key 必须与 Host 端
 * settings namespace 一致（卡片只渲染「Host 服务的 namespace」与「slot
 * 注册的卡片」的交集）。 */
export function settingsApply(ctx: Context): void {
  ctx.effect(() => {
    if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = STYLE_ID
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'shadow-rewind-settings: styles')
  ctx.effect(() => {
    ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
      { name: 'settings.plugin.item', key: 'shadow-rewind' },
      ShadowRewindSettingsCard,
    ))
    return () => {}
  }, 'shadow-rewind-settings: slot')
}
