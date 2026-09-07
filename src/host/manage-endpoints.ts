/**
 * 宿主适配层·配置与管理端点（ABSORB-RECALL 1.3 / 三 / 四）。
 *
 *  - `/shadow-rewind/config`  GET 全量配置（resolved + 用户覆盖 + env 锁）
 *                             + POST {patch} / {op:'reset'} 写 settings 用户层；
 *  - `/shadow-rewind/manage`  GET 工作区→会话→检查点三级树 + 磁盘占用，
 *                             POST 删除（单条/会话/全部）、立即 GC；
 *  - `/shadow-rewind/lineage` GET fork 谱系链（时间线「恢复自」徽标数据源）。
 *
 * 全部只服务本机回环（与其余 /shadow-rewind 端点同一安全边界）。
 * 管理树不分页：每会话检查点有硬配额（30×2 相位），自用规模树全量返回。
 */

import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ShadowRewindError, errorMessage } from '../errors.js'
import { readJson, safeDirectoryNames } from '../path-utils.js'
import { CONFIG_DEFAULTS, configEnvLocks, DEFAULT_EXCLUDES } from '../engine-config.js'
import { cleanConfigPatch } from './plugin-config.js'
import { readSession } from './session-resolve.js'
import type { ShadowRewindEngine } from '../engine.js'
import type { RestorePointSummary } from '../types.js'
import type { SettingsBridge } from './settings-bridge.js'
import { json, readJsonBody, isLoopback, requiredText } from './http-utils.js'
import type { Request, Response } from './http-utils.js'
import type { RewindHttpDeps } from './types.js'

export const MANAGE_HTTP_PATH = '/shadow-rewind/manage'
export const CONFIG_HTTP_PATH = '/shadow-rewind/config'
export const LINEAGE_HTTP_PATH = '/shadow-rewind/lineage'

/** settings 不可用时的兜底重置补丁（config-reset 的降级路径）。 */
const RESET_DEFAULTS: Record<string, unknown> = {
  ...CONFIG_DEFAULTS,
  excludePatterns: [...DEFAULT_EXCLUDES],
}

// ── config 端点 ─────────────────────────────────────────────────────────────

/** GET+POST /shadow-rewind/config：配置读取 / 写入 / 重置。 */
export async function handleConfigHttp(engine: ShadowRewindEngine, bridge: SettingsBridge | undefined, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'forbidden', code: 'FORBIDDEN' })
      return
    }
    if (request.method === 'GET') {
      const { storageDir, ...values } = engine.config
      json(response, 200, {
        // storageDir 单列：只读展示（env DSH_HOME 推导），不进可写白名单。
        values: { ...values, storageDir },
        defaults: RESET_DEFAULTS,
        overridden: bridge?.overridden() ?? {},
        envLocks: configEnvLocks(),
        writable: bridge?.writable() ?? false,
      })
      return
    }
    if (request.method === 'POST') {
      const body = await readJsonBody(request) as { patch?: unknown; op?: unknown }
      if (body.op === 'reset') {
        if (bridge === undefined) throw new ShadowRewindError('CONFIG_UNAVAILABLE', 'settings 服务不可用，无法重置')
        await bridge.reset(RESET_DEFAULTS)
        json(response, 200, { ok: true })
        return
      }
      const patch = body.patch
      if (patch === undefined || patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', 'patch 必须是对象')
      }
      const cleaned = cleanConfigPatch(patch as Record<string, unknown>)
      if (Object.keys(cleaned).length === 0) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', '没有可写入的配置字段')
      }
      if (bridge === undefined) {
        throw new ShadowRewindError('CONFIG_UNAVAILABLE', 'settings 服务不可用：请在 profile 的 cordis.patch.yml 按 id: shadow-rewind 覆盖配置')
      }
      await bridge.update(cleaned as Record<string, unknown>)
      json(response, 200, { ok: true })
      return
    }
    json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'CONFIG_FAILED',
    })
  }
}

// ── manage 端点 ─────────────────────────────────────────────────────────────

interface WorkspaceScan {
  readonly workspace: string
  readonly dir: string
  readonly key: string
}

/** 反向枚举存储根下的全部工作区（binding 文件是「哈希 ↔ 路径」的权威映射）。 */
async function scanWorkspaces(storageDir: string): Promise<WorkspaceScan[]> {
  const root = join(storageDir, 'workspaces')
  const keys = await safeDirectoryNames(root)
  const out: WorkspaceScan[] = []
  for (const key of keys) {
    try {
      const binding = await readJson(join(root, key, 'workspace.json')) as { workspace?: unknown }
      if (typeof binding.workspace === 'string' && binding.workspace !== '') {
        out.push({ workspace: binding.workspace, dir: join(root, key), key })
      }
    } catch { /* binding 损坏/缺失：该目录不进管理树 */ }
  }
  return out.sort((left, right) => left.workspace.localeCompare(right.workspace))
}

/** 递归统计目录字节数（diskUsage 用；失败按 0 计）。 */
async function du(target: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(target, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const child = join(target, entry.name)
    if (entry.isDirectory()) {
      total += await du(child)
    } else {
      try {
        total += (await stat(child)).size
      } catch { /* 竞态删除按 0 计 */ }
    }
  }
  return total
}

/** GET+POST /shadow-rewind/manage：检查点管理树、磁盘占用、删除与手动 GC。 */
export async function handleManageHttp(engine: ShadowRewindEngine, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'forbidden', code: 'FORBIDDEN' })
      return
    }
    if (request.method === 'GET') {
      const url = new URL(request.url ?? MANAGE_HTTP_PATH, 'http://dsh.local')
      const op = url.searchParams.get('op') ?? 'list'
      if (op === 'diskUsage') {
        const workspaces = await scanWorkspaces(engine.config.storageDir)
        let totalBytes = 0
        const perWorkspace: Record<string, number> = {}
        for (const scan of workspaces) {
          const bytes = await du(scan.dir)
          perWorkspace[scan.workspace] = bytes
          totalBytes += bytes
        }
        // 孤儿目录（binding 缺失）也计入总量——用户需要知道磁盘真实被谁占着。
        for (const key of await safeDirectoryNames(join(engine.config.storageDir, 'workspaces'))) {
          if (!workspaces.some((scan) => scan.key === key)) totalBytes += await du(join(engine.config.storageDir, 'workspaces', key))
        }
        json(response, 200, { totalBytes, perWorkspace })
        return
      }
      // op=list（缺省）：工作区 → 会话 → 检查点三级树。
      const scans = await scanWorkspaces(engine.config.storageDir)
      const workspaces = []
      let total = 0
      for (const scan of scans) {
        const bySession = new Map<string, RestorePointSummary[]>()
        try {
          const points = await engine.list({ cwd: scan.workspace, includeTurnCheckpoints: true, includeRescue: true })
          for (const point of points) {
            const sessionId = point.sessionId ?? '(无会话)'
            const bucket = bySession.get(sessionId)
            if (bucket === undefined) bySession.set(sessionId, [point])
            else bucket.push(point)
          }
        } catch { /* 工作区目录已被删除等：按空树展示 */ }
        const sessions = [...bySession.entries()].map(([sessionId, points]) => ({
          sessionId,
          count: points.length,
          checkpoints: points.map((point) => ({
            id: point.id,
            kind: point.kind,
            ...(point.turn !== undefined ? { turn: point.turn } : {}),
            ...(point.phase !== undefined ? { phase: point.phase } : {}),
            ...(point.label !== undefined ? { label: point.label } : {}),
            createdAt: point.createdAt,
          })),
        }))
        total += sessions.reduce((sum, session) => sum + session.count, 0)
        workspaces.push({ workspace: scan.workspace, sessions })
      }
      json(response, 200, { workspaces, total })
      return
    }
    if (request.method === 'POST') {
      const body = await readJsonBody(request) as { op?: unknown; cwd?: unknown; restorePointId?: unknown; sessionId?: unknown }
      const op = typeof body.op === 'string' ? body.op : ''
      const cwd = typeof body.cwd === 'string' && body.cwd.trim() !== '' ? body.cwd : undefined
      if (cwd === undefined) throw new ShadowRewindError('INVALID_ARGUMENTS', 'cwd 必须是非空字符串')
      if (op === 'delete') {
        const restorePointId = requiredText(body.restorePointId, 'restorePointId')
        const result = await engine.delete({ cwd, restorePointId })
        json(response, 200, { ok: true, ...result })
        return
      }
      if (op === 'deleteSession') {
        const sessionId = requiredText(body.sessionId, 'sessionId')
        const result = await deleteMany(engine, cwd, (point) => point.sessionId === sessionId)
        json(response, 200, { ok: result.failed.length === 0, ...result })
        return
      }
      if (op === 'deleteAll') {
        const result = await deleteMany(engine, cwd, () => true)
        json(response, 200, { ok: result.failed.length === 0, ...result })
        return
      }
      if (op === 'gc') {
        const gc = await engine.collectGarbageFor(cwd)
        json(response, 200, { ok: true, ...gc })
        return
      }
      throw new ShadowRewindError('INVALID_ARGUMENTS', `未知管理操作：${JSON.stringify(op)}`)
    }
    json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'MANAGE_FAILED',
    })
  }
}

/** 批量删除（会话级 / 全部）：逐个走 engine.delete（UNDO_REFERENCE 保护在
 * 引擎内），失败计数不中断——「部分完成」对用户比「一笔勾销或全盘拒绝」
 * 诚实。返回删除/失败明细供 UI 呈现。 */
async function deleteMany(engine: ShadowRewindEngine, cwd: string, filter: (point: RestorePointSummary) => boolean): Promise<{ deleted: string[]; failed: { id: string; error: string }[] }> {
  const points = await engine.list({ cwd, includeTurnCheckpoints: true, includeRescue: true })
  const deleted: string[] = []
  const failed: { id: string; error: string }[] = []
  for (const point of points) {
    if (!filter(point)) continue
    try {
      await engine.delete({ cwd, restorePointId: point.id })
      deleted.push(point.id)
    } catch (error) {
      failed.push({ id: point.id, error: errorMessage(error) })
    }
  }
  return { deleted, failed }
}

// ── lineage 端点 ────────────────────────────────────────────────────────────

/** GET /shadow-rewind/lineage?cwd=|sessionId=：fork 谱系链（ABSORB-RECALL 四）。
 * 带 sessionId 时附带 version/restoredFrom——该会话沿链回溯的深度即「第几代
 * fork」（v2/v3…），restoredFrom 是触发分叉的恢复点（时间线徽标数据源）。 */
export async function handleLineageHttp(deps: RewindHttpDeps, engine: ShadowRewindEngine, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'forbidden', code: 'FORBIDDEN' })
      return
    }
    if (request.method !== 'GET') {
      json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
      return
    }
    const url = new URL(request.url ?? LINEAGE_HTTP_PATH, 'http://dsh.local')
    const cwdParam = url.searchParams.get('cwd')
    const sessionIdParam = url.searchParams.get('sessionId')
    if ((cwdParam !== null) === (sessionIdParam !== null)) {
      throw new ShadowRewindError('INVALID_ARGUMENTS', 'cwd 与 sessionId 必须提供其一（且只能其一）')
    }
    let cwd: string
    let badgeSessionId: string | undefined
    if (cwdParam !== null) {
      cwd = requiredText(cwdParam, 'cwd')
    } else {
      badgeSessionId = requiredText(sessionIdParam, 'sessionId')
      const session = await readSession(deps, badgeSessionId)
      cwd = session.header.cwd ?? ''
      if (cwd === '') throw new ShadowRewindError('INVALID_ARGUMENTS', '会话没有工作区，无法读取谱系')
    }
    const entries = await engine.loadForkLineage(cwd)
    const badge = badgeSessionId === undefined ? undefined : lineageVersion(entries, badgeSessionId)
    json(response, 200, {
      entries,
      ...(badge !== undefined ? { version: badge.version, ...(badge.restoredFrom !== undefined ? { restoredFrom: badge.restoredFrom } : {}) } : {}),
    })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'LINEAGE_FAILED',
    })
  }
}

/** 沿 lineage 链回溯会话的 fork 深度：无链 = undefined；一次 fork = v2。
 * restoredFrom 取本会话直连父链的那条（第一次命中），不被更深的祖先覆盖。 */
function lineageVersion(entries: readonly { childId: string; parentId: string; restorePointId?: string }[], sessionId: string): { version: number; restoredFrom?: string } | undefined {
  let current = sessionId
  let depth = 0
  let restoredFrom: string | undefined
  while (depth < 64) {
    const entry = entries.find((item) => item.childId === current)
    if (entry === undefined) break
    if (restoredFrom === undefined) restoredFrom = entry.restorePointId
    current = entry.parentId
    depth += 1
  }
  return depth === 0 ? undefined : { version: depth + 1, ...(restoredFrom !== undefined ? { restoredFrom } : {}) }
}
