/**
 * 宿主适配层·同源 HTTP 端点。
 *
 * 注册六个 `/shadow-rewind` 端点（全部只服务本机回环，非回环一律 403）：
 *  - `/shadow-rewind`          GET 预览（消息/回合两种寻址）+ POST 执行恢复；
 *  - `/shadow-rewind/file`     从检查点（或当前磁盘 'live'）读单文件内容；
 *  - `/shadow-rewind/fs-changes` 批量返回会话所有轮次的文件系统变更；
 *  - `/shadow-rewind/trace`    轨迹时间线 + 区间 diff（轨迹重放 / 快照对比）；
 *  - `/shadow-rewind/restore-undo` 撤销该工作区最近一次恢复（B1 单次 undo）；
 *  - `/shadow-rewind/status`   最近错误环形缓冲 + 生效后端健康度。
 *
 * 消息→检查点解析、轮配对与行数统计分别在 session-resolve / fs-changes；
 * 本文件只负责请求解析、装配调用与响应形状。
 */

import { ShadowRewindError, errorMessage } from '../errors.js'
import { canonicalDirectory } from '../path-utils.js'
import { attributePaths, serializeOwner } from '../attribution.js'
import type { PathAttribution } from '../attribution.js'
import { collectTurnIntent, traceBaselinePaths, traceNodes, traceRangeDiff, traceSpans, turnBoundaries } from '../trace-replay.js'
import type { ShadowRewindEngine } from '../engine.js'
import type { RestorePointSummary } from '../types.js'
import { turnCheckpointForRequest, checkpointForRequest, applyGuarded, createConversationRestart, resolveMessageRewindTarget, resolveTurnRewindTarget, readSession, sharedWorkspaceSessions } from './session-resolve.js'
import { computeTurnFsChanges, decodeUtf8, countLines, lineCounts, probeUnreadableCheckpoints, readChangeSide, readLiveFile, DIFF_COUNT_BUDGET } from './fs-changes.js'
import type { TurnFsChange } from './fs-changes.js'
import { bumpWorkspaceRevision, workspaceRevision } from './revision.js'
import { INITIAL_CHANGE_PREVIEW_LIMIT, MAX_CHANGE_PAGE_SIZE, isLoopback, json, nonNegativeInteger, optionalText, pageSize, readJsonBody, requiredText } from './http-utils.js'
import type { Request, Response } from './http-utils.js'
import type { RewindHttpDeps } from './types.js'
import type { TurnCheckpointCoordinator } from './coordinator.js'
import { CONFIG_HTTP_PATH, LINEAGE_HTTP_PATH, MANAGE_HTTP_PATH, handleConfigHttp, handleLineageHttp, handleManageHttp } from './manage-endpoints.js'
import type { SettingsBridge } from './settings-bridge.js'

/** 同源端点根路径（客户端侧 fetch 的事实标准）。 */
export const REWIND_HTTP_PATH = '/shadow-rewind'

/** 注册同源端点；非回环请求一律 403（与旧插件同一安全边界）。
 * bridge 支持传解析函数：settings 桥异步装配到位前为 undefined，handler
 * 每次请求时重新解析（桥缺席时 config 端点按只读应答）。
 * 宿主 ctx 提供 effect 时，注册 disposer 挂进插件 fiber——插件禁用/HMR
 * 时端点随 fiber 注销（verify-host 门禁断言卸载清零）。 */
export function installShadowRewindHttp(ctx: RewindHttpDeps & {
  effect?: (dispose: () => void, label?: string) => void
  webServer?: { register(route: { kind: 'exact'; path: string; handler: (request: Request, response: Response) => Promise<void> }): () => void }
}, engine: ShadowRewindEngine, coordinator: TurnCheckpointCoordinator, bridge?: SettingsBridge | (() => SettingsBridge | undefined)): void {
  const resolveBridge = (): SettingsBridge | undefined => typeof bridge === 'function' ? bridge() : bridge
  const routes: readonly { path: string; handler: (request: Request, response: Response) => Promise<void> }[] = [
    { path: REWIND_HTTP_PATH, handler: (request, response) => handleRewindHttp(ctx, engine, coordinator, request, response) },
    // 获取检查点中的文件内容（用于为文件系统变更生成 diff）。
    { path: `${REWIND_HTTP_PATH}/file`, handler: (request, response) => handleFileContentHttp(ctx, engine, request, response) },
    // 批量返回会话所有轮次的文件系统变更（侧边栏按轮合并展示用）。
    { path: `${REWIND_HTTP_PATH}/fs-changes`, handler: (request, response) => handleFsChangesHttp(ctx, engine, request, response) },
    // 轨迹时间线 + 区间 diff（轨迹重放 / 快照对比二选一）。
    { path: `${REWIND_HTTP_PATH}/trace`, handler: (request, response) => handleTraceHttp(ctx, engine, request, response) },
    // 撤销最近一次恢复（B1，进程内单次 undo）。
    { path: `${REWIND_HTTP_PATH}/restore-undo`, handler: (request, response) => handleRestoreUndoHttp(ctx, engine, request, response) },
    // 进程级健康快照：最近错误环形缓冲 + 生效后端健康度（排障 UI 面向）。
    { path: `${REWIND_HTTP_PATH}/status`, handler: (request, response) => handleStatusHttp(engine, coordinator, request, response) },
    // 配置读写 / 重置（设置卡片）。
    { path: CONFIG_HTTP_PATH, handler: (request, response) => handleConfigHttp(engine, resolveBridge(), request, response) },
    // 检查点管理树、磁盘占用、删除与立即 GC（管理面板）。
    { path: MANAGE_HTTP_PATH, handler: (request, response) => handleManageHttp(engine, request, response) },
    // fork 谱系链（时间线「恢复自」徽标）。
    { path: LINEAGE_HTTP_PATH, handler: (request, response) => handleLineageHttp(ctx, engine, request, response) },
  ]
  for (const route of routes) {
    const dispose = ctx.webServer?.register({ kind: 'exact', path: route.path, handler: route.handler })
    // cordis 4 的 effect 接「返回 disposer 的函数」，不是 disposer 本身。
    if (dispose !== undefined) ctx.effect?.(() => dispose, `shadow-rewind: http ${route.path}`)
  }
}

/** POST /shadow-rewind/restore-undo：撤销该会话工作区最近一次恢复。
 * EXPECTED-DESIGN 1.2 两段式：`mode:'probe'` 只做 CAS 只读比对（弹窗依据）；
 * `mode:'apply'`（缺省）执行撤销，`force` 为用户在弹窗授权「全部回滚 /
 * 二次回滚」后的强制覆盖，`paths` 为子集撤销。 */
async function handleRestoreUndoHttp(deps: RewindHttpDeps, engine: ShadowRewindEngine, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'forbidden', code: 'FORBIDDEN' })
      return
    }
    if (request.method !== 'POST') {
      json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
      return
    }
    const body = await readJsonBody(request) as { sessionId?: unknown; cwd?: unknown; mode?: unknown; force?: unknown; paths?: unknown }
    let cwd = typeof body.cwd === 'string' && body.cwd.trim() !== '' ? body.cwd : undefined
    if (cwd === undefined) {
      const sessionId = typeof body.sessionId === 'string' && body.sessionId !== '' ? body.sessionId : null
      if (sessionId === null) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', 'sessionId 与 cwd 必须提供其一')
      }
      const session = await readSession(deps, sessionId)
      cwd = session.header.cwd
    }
    if (cwd === undefined || cwd.trim() === '') {
      throw new ShadowRewindError('INVALID_ARGUMENTS', '无法定位工作区（会话没有 cwd）')
    }
    const mode = body.mode === 'probe' ? 'probe' as const : 'apply' as const
    const force = body.force === true
    let paths: readonly string[] | undefined
    if (Array.isArray(body.paths)) {
      if (!body.paths.every((item): item is string => typeof item === 'string' && item !== '')) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', 'paths 必须是非空字符串数组')
      }
      paths = body.paths
    }
    if (mode === 'probe') {
      // 只读比对，不动磁盘、不 bump 数据版本。
      json(response, 200, await engine.undoLastRestore({ cwd, mode, ...(paths !== undefined ? { paths } : {}) }))
      return
    }
    const result = await engine.undoLastRestore({
      cwd,
      ...(force ? { force } : {}),
      ...(paths !== undefined ? { paths } : {}),
    })
    // 撤销同样改写了磁盘：数据版本递增，客户端 fs 缓存随之失效。
    await bumpWorkspaceRevision(cwd)
    json(response, 200, result)
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'RESTORE_UNDO_FAILED',
    })
  }
}

/** GET+POST /shadow-rewind：回退预览与执行（消息 / 回合两种寻址）。 */
async function handleRewindHttp(deps: RewindHttpDeps, engine: ShadowRewindEngine, coordinator: TurnCheckpointCoordinator, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
      response.end(`${JSON.stringify({ error: 'forbidden', code: 'FORBIDDEN' })}\n`)
      return
    }
    if (request.method === 'GET') {
      const url = new URL(request.url ?? REWIND_HTTP_PATH, 'http://dsh.local')
      const sessionId = requiredText(url.searchParams.get('sessionId'), 'sessionId')
      // 两种预览定位（二选一）：messageSeq = 消息旁回退按钮；turn = 侧边栏
      // 文件审查 tab 的「从快照恢复此轮」。
      const turnParam = url.searchParams.get('turn')
      const messageSeqParam = url.searchParams.get('messageSeq')
      if ((turnParam === null) === (messageSeqParam === null)) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', 'messageSeq 与 turn 必须提供其一（且只能其一）')
      }
      const detailsOnly = url.searchParams.get('details') === '1'
      // 对称模式的子集计划：paths 为 JSON 字符串数组（勾选路径）。
      const pathsParam = url.searchParams.get('paths')
      let requestedPaths: readonly string[] | undefined
      if (pathsParam !== null) {
        let parsed: unknown
        try {
          parsed = JSON.parse(pathsParam)
        } catch {
          throw new ShadowRewindError('INVALID_ARGUMENTS', 'paths 必须是 JSON 字符串数组')
        }
        if (!Array.isArray(parsed) || parsed.length === 0
          || !parsed.every((item): item is string => typeof item === 'string')) {
          throw new ShadowRewindError('INVALID_ARGUMENTS', 'paths 必须是非空的 JSON 字符串数组')
        }
        requestedPaths = parsed
      }
      const offset = nonNegativeInteger(url.searchParams.get('offset') ?? '0', 'offset')
      const limit = pageSize(url.searchParams.get('limit'), detailsOnly ? MAX_CHANGE_PAGE_SIZE : INITIAL_CHANGE_PREVIEW_LIMIT)
      const resolved = turnParam !== null
        ? await resolveTurnRewindTarget(deps, engine, sessionId, nonNegativeInteger(turnParam, 'turn'), coordinator)
        : await resolveMessageRewindTarget(deps, engine, sessionId, nonNegativeInteger(messageSeqParam as string, 'messageSeq'), coordinator)
      if (resolved.status === 'unavailable') {
        json(response, 200, resolved.response)
        return
      }
      const { checkpoint, messageSeq } = resolved
      const inspection = await engine.inspect({ cwd: checkpoint.cwd, restorePointId: checkpoint.id })
      const running = await sharedWorkspaceSessions(deps, checkpoint.cwd)
      // 路径归因：按检查点窗口给每条变更标归属（目标会话 / 其它会话 / 双方 /
      // 未知）。归属只是勾选清单的建议标签（纯快照网格推导）；带 paths 的
      // 子集计划请求不再渲染标签，直接跳过。
      let ownership: Map<string, PathAttribution> | undefined
      if (requestedPaths === undefined && inspection.changes.length > 0) {
        const attributed = await engine.listSnapshotsAfter({
          cwd: checkpoint.cwd,
          restorePointId: checkpoint.id,
          paths: inspection.changes.map((change) => change.path),
        })
        ownership = attributePaths({
          targetSessionId: attributed.targetSessionId,
          changes: inspection.changes,
          snapshots: attributed.snapshots,
        })
      }
      const changes = inspection.changes.slice(offset, offset + limit)

      // 文件系统差异（捕获 PowerShell 等终端命令的文件变更）：
      // 第 N 轮的变更 = diff(第 N 轮轮起检查点, 第 N+1 轮轮起检查点)——
      // 第 N+1 轮第一步之前的捕获天然等于第 N 轮的轮末树状态，零新增捕获。
      // 无下一轮检查点时（最后一轮/被跳过）不返回该字段，预览的 changes
      // （轮起检查点 vs 当前磁盘）已覆盖这一轮。
      let nextCheckpointId: string | undefined
      let fileSystemChanges: readonly { path: string; kind: 'added' | 'modified' | 'deleted' }[] | undefined
      if (checkpoint.turn !== undefined) {
        // 从引擎读取当前检查点的完整 manifest 以获取 sessionId
        const manifests = await engine.list({ cwd: checkpoint.cwd, includeTurnCheckpoints: true })
        const currentManifest = manifests.find((m) => m.id === checkpoint.id)
        const sessionIdForLookup = currentManifest?.sessionId

        if (sessionIdForLookup && currentManifest !== undefined) {
          const allCheckpoints = await engine.listTurnCheckpoints({
            cwd: checkpoint.cwd,
            sessionId: sessionIdForLookup,
          })
          // 优先同轮轮末检查点（精确轮末树），回退下一轮轮起（旧语义）。
          const startCheckpoints = allCheckpoints.filter((cp) => cp.phase !== 'end')
          const endCheckpoint = allCheckpoints.find((cp) => cp.phase === 'end' && cp.turn === checkpoint.turn)
          const currentIndex = startCheckpoints.findIndex((cp) => cp.id === checkpoint.id)
          const nextCheckpoint = currentIndex >= 0 ? startCheckpoints[currentIndex + 1] : undefined
          const pairEnd = endCheckpoint ?? nextCheckpoint
          if (pairEnd !== undefined) {
            nextCheckpointId = pairEnd.id
            // 配对 diff 与归属走共享助手（与 fs-changes 端点同源）；预览只
            // 消费 path/kind，行数预算置 0 不读内容。对比失败助手返回
            // undefined（已记警告），nextCheckpointId 不受影响。
            const computed = await computeTurnFsChanges(engine, deps, {
              cwd: checkpoint.cwd,
              current: {
                id: checkpoint.id,
                sessionId: sessionIdForLookup,
                createdAt: currentManifest.createdAt,
                turn: checkpoint.turn,
                turnStartSeq: checkpoint.turnStartSeq,
              },
              pairEnd,
              countBudget: { remaining: 0 },
            })
            // 保留 added/modified/deleted/mode-changed（后者映射为 modified，
            // 内容两侧相同）；type-changed 仍过滤。
            fileSystemChanges = computed?.changes.map((change) => ({ path: change.path, kind: change.kind }))
          }
        }
      }

      const common = {
          status: 'ready',
          sessionId,
          ...(messageSeq !== undefined ? { messageSeq } : {}),
          turn: checkpoint.turn,
          checkpointId: checkpoint.id,
          turnStartSeq: checkpoint.turnStartSeq,
          ...(nextCheckpointId === undefined ? {} : { nextCheckpointId }),
          ...(fileSystemChanges === undefined ? {} : { fileSystemChanges }),
          totalChanges: inspection.changes.length,
          changes: changes.map((change) => {
            const attributed = ownership?.get(change.path)
            return {
              path: change.path,
              kind: change.kind,
              ...(attributed === undefined
                ? {}
                : { owner: serializeOwner(attributed.owner), autoSelect: attributed.autoSelect }),
            }
          }),
          offset,
          truncated: offset + changes.length < inspection.changes.length,
          activeSessionIds: running,
          // 恢复语义模式：恒为对称（勾选式子集）。字段保留以兼容旧客户端。
          mode: 'symmetric',
          // 跳过项逐条透传 {path, reason}——用户必须能看到具体哪些文件
          // 不在快照内、为什么，而不是只给一个数字。
          skippedPaths: inspection.skippedPaths.map((skip) => ({ path: skip.path, reason: skip.reason })),
          // 工作区绝对路径：恢复预览的行级 diff（当前 → 快照）按需拉两侧
          // 全文时要用（/shadow-rewind/file 端点的 cwd 参数）。只增字段，旧客户端忽略。
          workspace: checkpoint.cwd,
        }
      if (inspection.changes.length === 0 || detailsOnly) {
        json(response, 200, common)
        return
      }
      const plan = await engine.planRestore({
        cwd: checkpoint.cwd,
        restorePointId: checkpoint.id,
        sessionId,
        expectedCurrentTreeHash: inspection.currentTreeHash,
        ...(requestedPaths === undefined ? {} : { paths: requestedPaths }),
      })
      json(response, 200, { ...common, planId: plan.id })
      return
    }
    if (request.method === 'POST') {
      const body = await readJsonBody(request)
      const mode = (body as { mode?: unknown }).mode
      if (mode !== 'code' && mode !== 'both') {
        throw new ShadowRewindError('INVALID_ARGUMENTS', 'mode 必须是 "code" 或 "both"')
      }
      const record = body as Record<string, unknown>
      const sessionId = requiredText(record.sessionId, 'sessionId')
      const checkpointId = requiredText(record.checkpointId, 'checkpointId')
      const planId = optionalText(record.planId, 'planId')
      // 确认串已废除（EXPECTED-DESIGN 1.4 #2）：「确认」由 GUI 弹窗承担，
      // 兼容字段被静默忽略（strict schema 只约束 Typert 协议，此处是 HTTP）。
      if (record.turn !== undefined) {
        // 按轮快照恢复（侧边栏文件审查 tab）：只恢复文件，绝不触碰对话。
        if (mode !== 'code') {
          throw new ShadowRewindError('INVALID_ARGUMENTS', '按回合快照恢复只支持 mode: "code"')
        }
        const turn = nonNegativeInteger(record.turn, 'turn')
        const checkpoint = await turnCheckpointForRequest(deps, engine, sessionId, turn, checkpointId)
        // 按轮恢复前先核对该计划确实对应该检查点（防 checkpointId 与 plan
        // 错配——两种寻址各自为政时会静默恢复到错误时点）。
        const restoreResult = await applyGuarded(deps, engine, sessionId, checkpoint, planId)
        json(response, 200, { status: 'completed', mode, ...restoreResult })
        return
      }
      const messageSeq = nonNegativeInteger(record.messageSeq, 'messageSeq')
      const checkpoint = await checkpointForRequest(deps, engine, sessionId, messageSeq, checkpointId)
      const restoreResult = await applyGuarded(deps, engine, sessionId, checkpoint, planId)
      if (mode === 'code') {
        json(response, 200, { status: 'completed', mode, ...restoreResult })
        return
      }
      try {
        const fork = await createConversationRestart(deps, sessionId, checkpoint)
        // 谱系记录（ABSORB-RECALL 四）：时间线据此显示「v2 · 恢复自」徽标；
        // 方法自身全容错，失败只是丢徽标。
        await engine.recordForkLineage({
          cwd: checkpoint.cwd,
          parentSessionId: sessionId,
          childSessionId: fork.sessionId,
          restorePointId: checkpoint.id,
        })
        json(response, 200, { status: 'completed', mode, sessionId: fork.sessionId, ...restoreResult })
      } catch (forkError) {
        // 文件已恢复但建会话失败：把文件滚回操作前，绝不留半完成状态。
        // 补偿本身也会产生一个 rescue 点——堆叠由引擎的 rescue 修剪上限控制。
        try {
          const inspection = await engine.inspect({ cwd: checkpoint.cwd, restorePointId: restoreResult.rescuePointId })
          const plan = await engine.planRestore({
            cwd: checkpoint.cwd,
            restorePointId: restoreResult.rescuePointId,
            sessionId,
            expectedCurrentTreeHash: inspection.currentTreeHash,
          })
          await engine.applyRestore({ planId: plan.id, sessionId, skipUndoRecord: true })
        } catch (rollbackError) {
          throw new ShadowRewindError('RECOVERY_REQUIRED', `新会话创建失败且回滚也失败，可从备份点 ${restoreResult.rescuePointId} 手工恢复。${errorMessage(rollbackError)}`)
        }
        throw new ShadowRewindError('CONVERSATION_REWIND_FAILED', `文件已自动还原；新会话创建失败：${errorMessage(forkError)}`, { cause: forkError })
      }
      return
    }
    json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
  } catch (error) {
    const status = error instanceof ShadowRewindError && error.code === 'RESTORE_POINT_NOT_FOUND' ? 404 : 409
    json(response, status, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'REWIND_FAILED',
    })
  }
}

/** GET+POST /shadow-rewind/status：进程级健康快照。
 * GET 返回最近错误（新→旧，最多 20 条，相邻重复计数「（×N）」，附环境
 * 错误分类 hint）与生效后端健康度；POST {op:'clear'} 清空错误历史。 */
async function handleStatusHttp(engine: ShadowRewindEngine, coordinator: TurnCheckpointCoordinator, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'forbidden', code: 'FORBIDDEN' })
      return
    }
    if (request.method === 'GET') {
      json(response, 200, {
        backend: {
          effective: engine.effectiveBackend,
          ...(engine.downgradeReason === undefined ? {} : { downgradeReason: engine.downgradeReason }),
        },
        errors: coordinator.errorLog.list(),
      })
      return
    }
    if (request.method === 'POST') {
      const body = await readJsonBody(request) as { op?: unknown }
      if (body.op !== 'clear') {
        throw new ShadowRewindError('INVALID_ARGUMENTS', 'op 必须是 "clear"')
      }
      coordinator.errorLog.clear()
      json(response, 200, { ok: true, errors: [] })
      return
    }
    json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'STATUS_FAILED',
    })
  }
}

/** GET /shadow-rewind/file：从指定检查点读取文件内容（base64 编码）。 */
async function handleFileContentHttp(deps: RewindHttpDeps, engine: ShadowRewindEngine, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'forbidden', code: 'FORBIDDEN' })
      return
    }
    if (request.method !== 'GET') {
      json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
      return
    }
    const url = new URL(request.url ?? REWIND_HTTP_PATH, 'http://dsh.local')
    const checkpointId = requiredText(url.searchParams.get('checkpointId'), 'checkpointId')
    const path = requiredText(url.searchParams.get('path'), 'path')
    const cwdParam = url.searchParams.get('cwd')
    if (!cwdParam) {
      throw new ShadowRewindError('INVALID_ARGUMENTS', 'cwd 必须是非空字符串')
    }
    const cwd = await canonicalDirectory(cwdParam)

    // live = 读当前磁盘（live-tail 条目的 after 内容）。围栏：路径必须落在
    // 工作区内，且拒绝符号链接——「读当前磁盘」的安全边界与「改当前磁盘」
    // （file-review 服务拒软链）对齐，词法 containment 挡不住链接逃逸。
    if (checkpointId === 'live') {
      const liveContent = await readLiveFile(cwd, path)
      if (liveContent === null) {
        json(response, 404, { error: 'file not found on disk', code: 'FILE_NOT_FOUND' })
        return
      }
      json(response, 200, {
        checkpointId,
        path,
        content: liveContent.toString('base64'),
        encoding: 'base64',
      })
      return
    }

    const content = await engine.getFileContentFromCheckpoint({ cwd, checkpointId, path })
    if (content === null) {
      json(response, 404, { error: 'file not found in checkpoint', code: 'FILE_NOT_FOUND' })
      return
    }

    // 返回 base64 编码的内容（避免 UTF-8 解码问题）
    json(response, 200, {
      checkpointId,
      path,
      content: content.toString('base64'),
      encoding: 'base64',
    })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'FILE_CONTENT_FAILED',
    })
  }
}

/**
 * GET /shadow-rewind/trace：轨迹时间线（A1 轨迹重放 + B2 降级标注的统一入口）。
 *
 * 不带 from/to：返回时间线数据——tool/call 边界节点（trace:<seq>）与全部
 * turn 检查点摘要（含 intent 与 degraded 标注）。
 * 带 from/to：两种寻址（不可混用）——
 *  - `trace:<seq>` / 裸 seq：轨迹重放区间 diff（只覆盖内容型工具，附盲区 notes）；
 *  - `rp_...` 检查点 id：两个快照的逐文件对比 + 行数（内容经 /file 端点懒取）。
 */
async function handleTraceHttp(deps: RewindHttpDeps, engine: ShadowRewindEngine, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'forbidden', code: 'FORBIDDEN' })
      return
    }
    if (request.method !== 'GET') {
      json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
      return
    }
    const url = new URL(request.url ?? REWIND_HTTP_PATH, 'http://dsh.local')
    const sessionId = requiredText(url.searchParams.get('sessionId'), 'sessionId')
    const session = await readSession(deps, sessionId)
    const cwd = session.header.cwd
    const nodes = traceNodes(session.events)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (from === null && to === null) {
      // 时间线面：轨迹节点 + 检查点摘要（degraded 并行探测，尽力而为）
      // + 三泳道 spans/turn 刻度（拖选时间线渲染用）。
      let checkpoints: readonly (RestorePointSummary & { readonly degraded?: true })[] = []
      if (cwd !== undefined && cwd.trim() !== '') {
        checkpoints = await engine.listTurnCheckpoints({ cwd, sessionId })
        const unreadable = await probeUnreadableCheckpoints(engine, cwd, new Set(checkpoints.map((point) => point.id)))
        checkpoints = checkpoints.map((point) => unreadable.has(point.id) ? { ...point, degraded: true as const } : point)
      }
      json(response, 200, {
        sessionId,
        ...(cwd === undefined ? {} : { cwd }),
        nodes,
        checkpoints,
        spans: traceSpans(session.events),
        turnBoundaries: turnBoundaries(session.events),
      })
      return
    }
    if (from === null || to === null) {
      throw new ShadowRewindError('INVALID_ARGUMENTS', 'from 与 to 必须成对提供')
    }
    if (cwd === undefined || cwd.trim() === '') {
      throw new ShadowRewindError('INVALID_ARGUMENTS', '会话没有工作区，无法对比')
    }
    if (from.startsWith('rp_') !== to.startsWith('rp_')) {
      throw new ShadowRewindError('INVALID_ARGUMENTS', '快照检查点与轨迹节点不可混用（两种寻址二选一）')
    }
    if (from.startsWith('rp_')) {
      // 快照 vs 快照：diffCheckpoints + 共享行数预算（内容懒取走 /file）。
      const fromId = requiredText(from, 'from')
      const toId = requiredText(to, 'to')
      const fsDiff = await engine.diffCheckpoints({ cwd, prevCheckpointId: fromId, currCheckpointId: toId })
      const countBudget = { remaining: DIFF_COUNT_BUDGET }
      const changes = await Promise.all(fsDiff.changes
        .filter((change) => change.kind !== 'type-changed')
        .map(async (change) => {
          const [beforeBuf, afterBuf] = await Promise.all([
            change.before === undefined ? Promise.resolve(null) : readChangeSide(engine, cwd, fromId, change.path),
            change.after === undefined ? Promise.resolve(null) : readChangeSide(engine, cwd, toId, change.path),
          ])
          const beforeText = beforeBuf === null ? null : decodeUtf8(beforeBuf)
          const afterText = afterBuf === null ? null : decodeUtf8(afterBuf)
          let counts: { added: number; removed: number } | undefined
          if (countBudget.remaining > 0 && (beforeText !== null || afterText !== null)) {
            countBudget.remaining -= 1
            // 单侧缺失 = added/deleted：行数按现存一侧计（与 fs-changes 语义一致）。
            counts = beforeText === null
              ? { added: countLines(afterText ?? ''), removed: 0 }
              : afterText === null
                ? { added: 0, removed: countLines(beforeText) }
                : lineCounts(beforeText, afterText)
          }
          return {
            path: change.path,
            kind: change.kind === 'mode-changed' ? 'modified' as const : change.kind,
            ...(change.before?.kind === 'file' ? { oldMode: change.before.mode } : {}),
            ...(change.after?.kind === 'file' ? { newMode: change.after.mode } : {}),
            ...(counts === undefined ? {} : { added: counts.added, removed: counts.removed }),
          }
        }))
      json(response, 200, { sessionId, cwd, mode: 'checkpoint', from: fromId, to: toId, changes })
      return
    }
    // 轨迹 vs 轨迹：内容重放区间 diff。
    const fromSeq = nonNegativeInteger(from.replace(/^trace:/, ''), 'from')
    const toSeq = nonNegativeInteger(to.replace(/^trace:/, ''), 'to')
    if (fromSeq >= toSeq) {
      throw new ShadowRewindError('INVALID_ARGUMENTS', 'from 必须小于 to（区间语义 (from, to]）')
    }
    // B1：用 fromSeq 之前最近的轮起检查点补重放基线——「会话开始前就存在、
    // 区间内被写入」的文件不再标成 added；str_replace 也能在真实旧内容上
    // 命中锚点。只为工具触碰过的路径取内容（基线其余文件在 diff 中自然
    // 抵消）；无检查点 / 读取失败时退化为原语义（notes 已诚实标注盲区）。
    const baseline = new Map<string, string>()
    try {
      const touched = new Set(traceBaselinePaths(session.events))
      const candidates = (await engine.listTurnCheckpoints({ cwd, sessionId }))
        .filter((point) => point.phase !== 'end'
          && point.turnStartSeq !== undefined && point.turnStartSeq <= fromSeq)
        .sort((left, right) => (right.turnStartSeq ?? 0) - (left.turnStartSeq ?? 0))
      const baseId = candidates[0]?.id
      if (baseId !== undefined && touched.size > 0) {
        const entries = await engine.getCheckpointEntries({ cwd, restorePointId: baseId })
        for (const path of touched) {
          const entry = entries[path]
          if (entry === undefined || entry.kind !== 'file') continue
          const content = await engine.getFileContentFromCheckpoint({ cwd, checkpointId: baseId, path })
          if (content === null) continue
          const text = decodeUtf8(content)
          if (text !== null) baseline.set(path, text)
        }
      }
    } catch (error) {
      deps.logger.warn(`[shadow-rewind] 轨迹重放基线补齐失败，退化为原语义：${errorMessage(error)}`)
      baseline.clear()
    }
    const result = traceRangeDiff(session.events, fromSeq, toSeq, { baseline })
    json(response, 200, { sessionId, cwd, mode: 'trace', from: fromSeq, to: toSeq, changes: result.changes, notes: result.notes })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'TRACE_FAILED',
    })
  }
}

/**
 * GET /shadow-rewind/fs-changes：批量返回会话所有轮次的文件系统变更。
 *
 * 归属语义：第 N 轮的变更 = diff(第 N 轮轮起检查点, 本轮轮末检查点)；
 * 无轮末快照的轮（旧数据/捕获失败）回退「下一轮轮起」配对。最后一轮没有
 * 配对终点，不在此返回（live-tail 条目以「轮起检查点 vs 当前磁盘」覆盖）。
 * 单轮对比失败只跳过该轮，不中断整体响应。
 *
 * 本构建起每个 change 附带服务端预算的 added/removed 行数——客户端渲染
 * 行与 +/− 统计不再需要逐文件拉全文（全文仅在悬停/展开/撤销时按需取）。
 */
async function handleFsChangesHttp(deps: RewindHttpDeps, engine: ShadowRewindEngine, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'forbidden', code: 'FORBIDDEN' })
      return
    }
    if (request.method !== 'GET') {
      json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
      return
    }
    const url = new URL(request.url ?? REWIND_HTTP_PATH, 'http://dsh.local')
    const sessionId = requiredText(url.searchParams.get('sessionId'), 'sessionId')
    const session = await readSession(deps, sessionId)
    const cwd = session.header.cwd
    if (cwd === undefined || cwd.trim() === '') {
      json(response, 200, { sessionId, turns: [] })
      return
    }
    // 先读 rev 再算清单：bump 是 fire-and-forget，若先算清单后读 rev，
    // 捕获完成于两者之间的响应会带「旧数据 + 新 rev」，客户端把旧数据
    // 当新鲜缓存。先读后用：本轮数据旧则 rev 也旧，下次捕获自然失效。
    const rev = await workspaceRevision(cwd)
    const checkpoints = await engine.listTurnCheckpoints({ cwd, sessionId })
    // 相位分离：轮起检查点按轮序配对；轮末检查点（turn/end 捕获）优先作为
    // 本轮的归属终点——它精确冻结轮末树状态，轮结束后的写盘不再混入本轮。
    // 无轮末快照的轮（旧数据/捕获失败）回退「下一轮轮起」配对（旧语义）。
    const starts = checkpoints.filter((point) => point.phase !== 'end')
    const endByTurn = new Map<number, (typeof checkpoints)[number]>()
    for (const point of checkpoints) {
      if (point.phase === 'end' && point.turn !== undefined) endByTurn.set(point.turn, point)
    }
    const turns: TurnFsChange[] = []
    // 整个请求共享一份行数统计预算：预算耗尽后剩余变更只回 path/kind。
    const countBudget = { remaining: DIFF_COUNT_BUDGET }
    for (let index = 0; index < starts.length; index += 1) {
      const current = starts[index]
      if (current === undefined || current.turn === undefined || current.turnStartSeq === undefined) continue
      const next = starts[index + 1]
      const pairEnd = endByTurn.get(current.turn) ?? next
      const computed = await computeTurnFsChanges(engine, deps, {
        cwd,
        current: {
          id: current.id,
          sessionId: current.sessionId,
          createdAt: current.createdAt,
          turn: current.turn,
          turnStartSeq: current.turnStartSeq,
        },
        pairEnd,
        // 意图摘要来自轮末检查点（旧数据无轮末快照则无标签）。
        ...(pairEnd?.intent !== undefined ? { intent: pairEnd.intent } : {}),
        countBudget,
      })
      if (computed !== undefined && computed.changes.length > 0) turns.push(computed)
    }
    // live-tail：最新轮起检查点 vs 当前磁盘——只覆盖尚无轮末快照的最新一轮
    // （进行中的回合，或轮末捕获失败/旧数据的回退）。已有轮末快照的轮不需要
    // live 条目——否则轮结束后的外部写盘会被误挂到该轮头上。
    const last = starts[starts.length - 1]
    if (last !== undefined && last.turn !== undefined && last.turnStartSeq !== undefined
      && !endByTurn.has(last.turn)) {
      // live 条目的 after 内容就是「当前磁盘」，窗口归属走同一助手
      // （网格 owner/autoSelect 随条目透出，作为勾选清单的建议标签）。
      const computed = await computeTurnFsChanges(engine, deps, {
        cwd,
        current: {
          id: last.id,
          sessionId: last.sessionId,
          createdAt: last.createdAt,
          turn: last.turn,
          turnStartSeq: last.turnStartSeq,
        },
        live: true,
        // live 轮的意图摘要从会话事件即时采集（轮末检查点尚未产生）。
        ...(last.turnStartSeq !== undefined ? { intent: collectTurnIntent(session.events, last.turnStartSeq) } : {}),
        countBudget,
      })
      if (computed !== undefined && computed.changes.length > 0) turns.push(computed)
    }
    // 降级标注（B2）：并行只读探测本请求涉及的检查点内容可读性，丢失的
    // 诚实标 degraded——不静默、也不阻断清单（恢复时仍会 fail-closed）。
    const checkpointIds = new Set<string>()
    for (const turn of turns) {
      checkpointIds.add(turn.checkpointId)
      if (turn.nextCheckpointId !== 'live') checkpointIds.add(turn.nextCheckpointId)
    }
    const unreadable = await probeUnreadableCheckpoints(engine, cwd, checkpointIds)
    const marked = turns.map((turn) => {
      const degraded = unreadable.has(turn.checkpointId) || unreadable.has(turn.nextCheckpointId)
      return degraded ? { ...turn, degraded: true as const } : turn
    })
    json(response, 200, { sessionId, rev, turns: marked })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'FS_CHANGES_FAILED',
    })
  }
}
