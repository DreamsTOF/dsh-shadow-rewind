/**
 * 宿主适配层：回合检查点协调器 + `/shadow-rewind` 同源 HTTP 端点。
 *
 * 协调器把「每轮第一步之前自动快照」挂在 agent/pre-step 瀑布最前面；
 * 快照失败只记录、绝不阻塞用户回合。HTTP 端点负责消息→检查点解析、
 * 分页预览、计划生成与恢复执行；会话分叉交给 DSH 官方 create/fork。
 */
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { diffLines } from 'diff'
import { createDeadline } from './deadline.js'
import { ShadowRewindError, errorMessage } from './errors.js'
import { canonicalDirectory } from './path-utils.js'
import { isCheckpointSkipCode } from './engine.js'
import { attributePaths, serializeOwner } from './attribution.js'
import type { PathAttribution } from './attribution.js'
import type { WorkspaceWriteGate } from './write-gate.js'
import type { ShadowRewindEngine } from './engine.js'
import type { RestoreResult, WorkspaceChange } from './types.js'

export const REWIND_HTTP_PATH = '/shadow-rewind'
/** 写入闸运行时开关的查询/翻转端点（仅回环；不持久化，重启回到配置初值）。 */
export const REWIND_GATE_PATH = '/shadow-rewind/gate'

const BODY_LIMIT = 64 * 1024
const INITIAL_CHANGE_PREVIEW_LIMIT = 8
const MAX_CHANGE_PAGE_SIZE = 200

/** 最小化的宿主接口（结构类型）：只声明用到的成员，避免引入 cordis 依赖。 */
export interface HostContext {
  readonly logger: { info(message: string): void; warn(message: string): void; error(message: string): void }
  on(event: 'agent/pre-step', listener: (data: PreStepData, next: () => Promise<unknown>, options?: { prepend?: boolean }) => Promise<unknown>, options?: { prepend?: boolean }): void
}

export interface PreStepData {
  readonly agent: AgentFace
  readonly turn: number
  readonly step: number
  readonly signal: AbortSignal
}

/** 引擎用到的 agent/会话最小面。 */
export interface AgentFace {
  readonly id: string
  readonly status: string
  readonly session: {
    readonly id: string
    readonly header: { readonly cwd?: string }
    readonly events: readonly {
      readonly type: string
      readonly seq: number
      readonly data: {
        readonly turn?: number
        readonly source?: unknown
      }
    }[]
  }
}

/** 每回合第一步之前抢占快照（失败可跳过、可重试，绝不阻塞回合）。 */
export class TurnCheckpointCoordinator {
  private readonly engine: ShadowRewindEngine
  /** sessionId\0turn → 捕获 Promise（同回合幂等）。 */
  private readonly captures = new Map<string, Promise<void>>()
  private readonly pending = new Set<string>()
  private readonly failures = new Map<string, string>()
  private readonly skips = new Map<string, string>()
  /** workspace → 串行化尾队列：同一工作区的快照绝不并发。 */
  private readonly workspaceTails = new Map<string, Promise<void>>()

  constructor(engine: ShadowRewindEngine) {
    this.engine = engine
    if (engine.downgradeReason !== undefined) {
      // 降级是重要状态：启动时必须让用户在日志里看到。
      console.warn(`[shadow-rewind] ${engine.downgradeReason}`)
    }
  }

  /** 安装第一步闸门（prepend 保证先于其它监听器）。 */
  install(ctx: HostContext): void {
    ctx.on('agent/pre-step', async (data, next) => {
      if (data.step === 1) await this.capture(ctx, data.agent, data.turn, data.signal)
      return next()
    }, { prepend: true })
  }

  /** 无持久检查点时，向 UI 报告当前回合的捕获状态。 */
  state(sessionId: string, turn: number): { status: 'pending' | 'skipped' | 'failed' | 'missing'; reason?: string; error?: string } {
    const key = checkpointKey(sessionId, turn)
    if (this.pending.has(key)) return { status: 'pending' }
    const reason = this.skips.get(key)
    if (reason !== undefined) return { status: 'skipped', reason }
    const error = this.failures.get(key)
    return error === undefined ? { status: 'missing' } : { status: 'failed', error }
  }

  async capture(ctx: HostContext, agent: AgentFace, turn: number, signal: AbortSignal): Promise<void> {
    if (this.engine.turnCheckpointsDisabled) return
    const key = checkpointKey(agent.id, turn)
    const existing = this.captures.get(key)
    if (existing !== undefined) {
      await existing.catch(() => undefined)
      return
    }
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    const start = findLast(agent.session.events, (event) => event.type === 'turn/start' && event.data.turn === turn)
    if (start === undefined) {
      this.failures.set(key, '第一步之前找不到 turn/start 事件')
      return
    }
    const timeoutMs = this.engine.config.turnCheckpointTimeoutMs
    const outcomeDeadline = createDeadline(timeoutMs)
    const outcomeSignal = AbortSignal.any([signal, outcomeDeadline.signal])
    const captureDeadline = createDeadline(Math.max(1, timeoutMs - Math.min(250, Math.max(10, Math.ceil(timeoutMs / 5)))))
    const captureSignal = AbortSignal.any([signal, captureDeadline.signal])
    this.pending.add(key)
    this.failures.delete(key)
    this.skips.delete(key)
    const capture = this.serializeWorkspace(cwd, captureSignal, async () => {
      try {
        await this.engine.createTurnCheckpoint({
          cwd,
          sessionId: agent.id,
          turn,
          turnStartSeq: start.seq,
          signal: captureSignal,
        })
        // 数据版本随检查点递增：fs-changes 的客户端 warm 据此跳过无变化轮询。
        void bumpWorkspaceRevision(cwd)
      } catch (error) {
        await this.recordFailure(ctx, agent.id, turn, asCheckpointError(error, timeoutMs, captureDeadline.signal.aborted), {
          cwd,
          turnStartSeq: start.seq,
        })
      }
    }).finally(() => {
      this.pending.delete(key)
    })
    this.captures.set(key, capture)
    try {
      await raceWithSignal(capture, outcomeSignal)
    } catch (error) {
      const bounded = asCheckpointError(error, timeoutMs, outcomeDeadline.signal.aborted)
      const message = errorMessage(bounded)
      this.pending.delete(key)
      if (bounded instanceof ShadowRewindError && isCheckpointSkipCode(bounded.code)) {
        this.skips.set(key, message)
      } else {
        this.failures.set(key, message)
      }
    } finally {
      captureDeadline.cancel()
      outcomeDeadline.cancel()
      // 捕获完成后允许同回合重试（幂等由引擎 duplicate 检查保证）。
      this.captures.delete(key)
    }
  }

  /** 同一工作区的捕获排队执行，避免交错快照半新半旧的树。 */
  private async serializeWorkspace(workspace: string, signal: AbortSignal, task: () => Promise<void>): Promise<void> {
    const previous = this.workspaceTails.get(workspace) ?? Promise.resolve()
    const current = (async () => {
      await raceWithSignal(previous.catch(() => undefined), signal).catch(() => undefined)
      signal.throwIfAborted()
      await task()
    })()
    this.workspaceTails.set(workspace, current)
    try {
      await current
    } finally {
      if (this.workspaceTails.get(workspace) === current) this.workspaceTails.delete(workspace)
    }
  }

  private async recordFailure(ctx: HostContext, sessionId: string, turn: number, error: unknown, context?: { cwd: string; turnStartSeq: number }): Promise<void> {
    const message = errorMessage(error)
    const key = checkpointKey(sessionId, turn)
    if (error instanceof ShadowRewindError && isCheckpointSkipCode(error.code)) {
      boundedSet(this.skips, key, message)
      if (context !== undefined) {
        try {
          await this.engine.recordTurnCheckpointSkip({
            cwd: context.cwd,
            sessionId,
            turn,
            turnStartSeq: context.turnStartSeq,
            reason: message,
          })
        } catch (persistError) {
          ctx.logger.warn(`[shadow-rewind] 无法持久化检查点跳过记录（${sessionId} turn ${String(turn)}）：${errorMessage(persistError)}`)
        }
      }
      ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 检查点已跳过：${message}`)
      return
    }
    boundedSet(this.failures, key, message)
    ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 检查点失败：${message}`)
  }
}

/**
 * 有界写入：超过 maxEntries 时淘汰最早写入的条目。
 * 跳过/失败记录按「会话×回合」增长，长驻进程必须设上限防止缓慢泄漏。
 */
function boundedSet(map: Map<string, string>, key: string, value: string, maxEntries = 256): void {
  if (!map.has(key) && map.size >= maxEntries) {
    const oldest = map.keys().next().value
    if (oldest !== undefined) map.delete(oldest)
  }
  map.set(key, value)
}

function checkpointKey(sessionId: string, turn: number): string {
  return `${sessionId}\0${String(turn)}`
}

async function raceWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let rejectAbort: ((reason: unknown) => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject
  })
  const onAbort = () => rejectAbort?.(signal.reason)
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await Promise.race([promise, aborted])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function asCheckpointError(error: unknown, timeoutMs: number, deadlineAborted: boolean): unknown {
  if (deadlineAborted && !(error instanceof ShadowRewindError && error.code === 'TURN_CHECKPOINT_TIMEOUT')) {
    return new ShadowRewindError('TURN_CHECKPOINT_TIMEOUT', `自动检查点超出 ${String(timeoutMs)} ms`, { cause: error })
  }
  return error
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item !== undefined && predicate(item)) return item
  }
  return undefined
}

// ── HTTP 端点 ─────────────────────────────────────────────────────────────

/** 最小 HTTP 面（Node 原生 req/res）。 */
interface Request {
  readonly method?: string
  readonly url?: string
  readonly socket: { readonly remoteAddress?: string }
  on(event: string, listener: (chunk: unknown) => void): void
  on(event: string, listener: () => void): void
  on(event: string, listener: (error: unknown) => void): void
}
interface Response {
  writeHead(status: number, headers: Record<string, string>): void
  end(body?: string): void
  on(event: 'data', listener: (chunk: unknown) => void): void
  on(event: 'end', listener: () => void): void
  on(event: 'error', listener: (error: unknown) => void): void
}

/** 宿主给 HTTP 层的服务面（会话读取 / 分叉 / 活跃 agent 列表）。 */
export interface RewindHttpDeps {
  readonly logger: { warn(message: string): void }
  readonly sessions: {
    get(sessionId: string): AgentFace | undefined
  }
  readonly sessionQuery: {
    readSession(sessionId: string): Promise<{ session: { id: string; cwd?: string; parentSession?: string; seedLength?: number }; events: readonly unknown[] }>
  }
  readonly apiProxy: {
    readonly sessions: {
      create(payload: { rpcId: string; payload: { cwd: string } }): Promise<{ result: { ok: boolean; value?: { sessionId?: string }; error?: { message: string } } }>
      fork(payload: { rpcId: string; payload: { sessionId: string; atSeq: number } }): Promise<{ result: { ok: boolean; value?: { sessionId?: string }; error?: { message: string } } }>
    }
  }
  readonly agents: {
    list(): readonly AgentFace[]
  }
}

/** 注册同源端点；非回环请求一律 403（与旧插件同一安全边界）。 */
export function installShadowRewindHttp(ctx: RewindHttpDeps & { webServer?: { register(route: { kind: 'exact'; path: string; handler: (request: Request, response: Response) => Promise<void> }): () => void } }, engine: ShadowRewindEngine, coordinator: TurnCheckpointCoordinator, writeGate: WorkspaceWriteGate): void {
  ctx.webServer?.register({
    kind: 'exact',
    path: REWIND_HTTP_PATH,
    handler: (request, response) => handleRewindHttp(ctx, engine, coordinator, writeGate, request, response),
  })
  ctx.webServer?.register({
    kind: 'exact',
    path: REWIND_GATE_PATH,
    handler: (request, response) => handleGateHttp(ctx, writeGate, request, response),
  })
  // 新增：获取检查点中的文件内容（用于为文件系统变更生成 diff）
  ctx.webServer?.register({
    kind: 'exact',
    path: `${REWIND_HTTP_PATH}/file`,
    handler: (request, response) => handleFileContentHttp(ctx, engine, request, response),
  })
  // 新增：批量返回会话所有轮次的文件系统变更（侧边栏按轮合并展示用）。
  ctx.webServer?.register({
    kind: 'exact',
    path: `${REWIND_HTTP_PATH}/fs-changes`,
    handler: (request, response) => handleFsChangesHttp(ctx, engine, request, response),
  })
}

async function handleGateHttp(deps: RewindHttpDeps, writeGate: WorkspaceWriteGate, request: Request, response: Response): Promise<void> {
  try {
    if (!isLoopback(request.socket.remoteAddress)) {
      json(response, 403, { error: 'forbidden', code: 'FORBIDDEN' })
      return
    }
    if (request.method === 'GET') {
      json(response, 200, { enabled: writeGate.isEnabled })
      return
    }
    if (request.method === 'POST') {
      const body = await readJsonBody(request) as { enabled?: unknown }
      if (typeof body.enabled !== 'boolean') {
        throw new ShadowRewindError('INVALID_ARGUMENTS', 'enabled 必须是布尔值')
      }
      writeGate.setGate(body.enabled)
      deps.logger.warn(`[shadow-rewind] 写入闸已${body.enabled ? '开启' : '关闭'}（运行时切换，重启后回到配置初值）`)
      json(response, 200, { enabled: writeGate.isEnabled })
      return
    }
    json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'GATE_FAILED',
    })
  }
}

async function handleRewindHttp(deps: RewindHttpDeps, engine: ShadowRewindEngine, coordinator: TurnCheckpointCoordinator, writeGate: WorkspaceWriteGate, request: Request, response: Response): Promise<void> {
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
      const ownerId = await writeGate.ownerOf(checkpoint.cwd)
      const { blocking, gated } = partitionRunningSessions(running, sessionId, ownerId, writeGate.isEnabled)
      const symmetric = !writeGate.isEnabled
      // 对称模式（闸关）的路径归因：按检查点窗口给每条变更标归属
      // （目标会话 / 其它会话 / 双方 / 未知）。只在「预览」请求里算；
      // 带 paths 的子集计划请求不再渲染标签，直接跳过。
      let ownership: Map<string, PathAttribution> | undefined
      if (symmetric && requestedPaths === undefined && inspection.changes.length > 0) {
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
      const restoreBlocked = blocking.length > 0
      
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
        
        if (sessionIdForLookup) {
          const allCheckpoints = await engine.listTurnCheckpoints({
            cwd: checkpoint.cwd,
            sessionId: sessionIdForLookup,
          })
          const currentIndex = allCheckpoints.findIndex((cp) => cp.id === checkpoint.id)
          const nextCheckpoint = currentIndex >= 0 ? allCheckpoints[currentIndex + 1] : undefined
          if (nextCheckpoint !== undefined) {
            nextCheckpointId = nextCheckpoint.id
            try {
              const fsDiff = await engine.diffCheckpoints({
                cwd: checkpoint.cwd,
                prevCheckpointId: checkpoint.id,
                currCheckpointId: nextCheckpoint.id,
              })
              // 保留 added/modified/deleted/mode-changed（后者映射为 modified，
              // 内容两侧相同）；type-changed 仍过滤。
              fileSystemChanges = fsDiff.changes
                .filter((change) =>
                  change.kind === 'added' || change.kind === 'modified'
                  || change.kind === 'deleted' || change.kind === 'mode-changed')
                .map((change) => ({
                  path: change.path,
                  kind: (change.kind === 'mode-changed' ? 'modified' : change.kind) as 'added' | 'modified' | 'deleted',
                }))
            } catch (error) {
              // 对比失败不影响主流程，只记录警告
              deps.logger.warn(`[shadow-rewind] 文件系统差异计算失败：${errorMessage(error)}`)
            }
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
          restoreBlocked,
          // 恢复语义模式：闸开=以当前为准（整树），闸关=对称（勾选式子集）。
          mode: symmetric ? 'symmetric' : 'current-wins',
          // 写入闸开启时：blocking = 请求者自身或当前所有者（这两个真正可能
          // 在写）；gated = 其余运行中的会话（写入已被拒绝，不阻塞恢复）。
          blockingSessionIds: blocking,
          gatedSessionIds: gated,
          ownerId,
          // 跳过项逐条透传 {path, reason}——用户必须能看到具体哪些文件
          // 不在快照内、为什么，而不是只给一个数字。
          skippedPaths: inspection.skippedPaths.map((skip) => ({ path: skip.path, reason: skip.reason })),
        }
      if (inspection.changes.length === 0 || detailsOnly || restoreBlocked) {
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
      json(response, 200, { ...common, planId: plan.id, confirmation: plan.confirmation })
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
      const confirmation = optionalText(record.confirmation, 'confirmation')
      if (record.turn !== undefined) {
        // 按轮快照恢复（侧边栏文件审查 tab）：只恢复文件，绝不触碰对话。
        if (mode !== 'code') {
          throw new ShadowRewindError('INVALID_ARGUMENTS', '按回合快照恢复只支持 mode: "code"')
        }
        const turn = nonNegativeInteger(record.turn, 'turn')
        const checkpoint = await turnCheckpointForRequest(deps, engine, sessionId, turn, checkpointId)
        const restoreResult = await applyGuarded(deps, engine, sessionId, checkpoint.cwd, writeGate, planId, confirmation)
        json(response, 200, { status: 'completed', mode, ...restoreResult })
        return
      }
      const messageSeq = nonNegativeInteger(record.messageSeq, 'messageSeq')
      const checkpoint = await checkpointForRequest(deps, engine, sessionId, messageSeq, checkpointId)
      const restoreResult = await applyGuarded(deps, engine, sessionId, checkpoint.cwd, writeGate, planId, confirmation)
      if (mode === 'code') {
        json(response, 200, { status: 'completed', mode, ...restoreResult })
        return
      }
      try {
        const fork = await createConversationRestart(deps, sessionId, checkpoint)
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
          await engine.applyRestore({ planId: plan.id, confirmation: plan.confirmation, sessionId })
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

// ── 消息 → 检查点解析（与旧插件同语义，纯会话事件驱动，无 VCS）───────────────

interface MessageTarget {
  readonly cwd: string
  readonly messageSeq: number
  readonly turn: number
  readonly turnStartSeq: number
  readonly previousTurnEndSeq?: number
}

async function readSession(deps: RewindHttpDeps, sessionId: string): Promise<{ id: string; header: { cwd?: string; parentSession?: string; seedLength?: number }; events: readonly SessionEvent[] }> {
  const live = deps.sessions.get(sessionId)
  if (live !== undefined) {
    return {
      id: live.id,
      header: live.session.header,
      events: live.session.events as readonly SessionEvent[],
    }
  }
  const stored = await deps.sessionQuery.readSession(sessionId)
  return {
    id: stored.session.id,
    header: { cwd: stored.session.cwd, parentSession: stored.session.parentSession, seedLength: stored.session.seedLength },
    events: stored.events as readonly SessionEvent[],
  }
}

interface SessionEvent {
  readonly type: string
  readonly seq: number
  readonly data: { readonly turn?: number; readonly source?: unknown }
}

async function resolveMessageCheckpoint(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, messageSeq: number): Promise<{
  target: MessageTarget
  checkpoint?: { id: string; cwd: string; messageSeq: number; turn: number; turnStartSeq: number; previousTurnEndSeq?: number }
}> {
  let current = await readSession(deps, sessionId)
  const target = messageTarget(current, messageSeq)
  const direct = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId, turn: target.turn })
  if (direct !== undefined) {
    if (direct.turnStartSeq !== target.turnStartSeq) {
      throw new ShadowRewindError('PLAN_STALE', '该消息的检查点与回合起点不再匹配')
    }
    return { target, checkpoint: { ...target, id: direct.id } }
  }
  // 子会话（fork 产物）没有自己的检查点时，沿父链在 seed 范围内继承。
  const seen = new Set([sessionId])
  for (;;) {
    const parentId = current.header.parentSession
    const seedLength = current.header.seedLength
    if ((parentId === undefined) !== (seedLength === undefined)) {
      throw new ShadowRewindError('PLAN_STALE', '会话分叉谱系的父元数据不完整')
    }
    if (parentId === undefined || seedLength === undefined
      || target.messageSeq >= seedLength || target.turnStartSeq >= seedLength) {
      return { target }
    }
    if (seen.has(parentId)) {
      throw new ShadowRewindError('PLAN_STALE', '会话分叉谱系出现环')
    }
    seen.add(parentId)
    try {
      current = await readSession(deps, parentId)
    } catch (error) {
      throw new ShadowRewindError('PLAN_STALE', `父会话 ${parentId} 不可读`, { cause: error })
    }
    const parentTarget = messageTarget(current, messageSeq)
    if (parentTarget.turn !== target.turn
      || parentTarget.turnStartSeq !== target.turnStartSeq
      || parentTarget.previousTurnEndSeq !== target.previousTurnEndSeq) {
      throw new ShadowRewindError('PLAN_STALE', '分叉谱系与继承的消息边界不再匹配')
    }
    const inherited = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId: parentId, turn: target.turn })
    if (inherited === undefined) continue
    if (inherited.turnStartSeq !== target.turnStartSeq) {
      throw new ShadowRewindError('PLAN_STALE', '继承的检查点与分叉边界不匹配')
    }
    return { target, checkpoint: { ...target, id: inherited.id } }
  }
}

async function checkpointForRequest(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, messageSeq: number, requestedId: string): Promise<{ id: string; cwd: string; messageSeq: number; turn: number; turnStartSeq: number; previousTurnEndSeq?: number }> {
  const { target, checkpoint } = await resolveMessageCheckpoint(deps, engine, sessionId, messageSeq)
  if (checkpoint === undefined) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `消息 ${String(messageSeq)} 没有可用的回退检查点`)
  }
  if (requestedId !== checkpoint.id) {
    throw new ShadowRewindError('PLAN_STALE', '该消息的检查点已变化；请重新打开回退对话框')
  }
  return checkpoint
}

// ── 预览目标解析（消息 / 回合两种定位统一到同一个预览尾部）────────────────

interface CheckpointRef {
  readonly id: string
  readonly cwd: string
  readonly turn: number
  readonly turnStartSeq: number
  readonly previousTurnEndSeq?: number
  /** 消息模式回显；turn 模式没有。 */
  readonly messageSeq?: number
}

type ResolvedPreviewTarget =
  | { readonly status: 'unavailable'; readonly response: unknown }
  | { readonly status: 'ready'; readonly checkpoint: CheckpointRef; readonly messageSeq?: number }

async function resolveMessageRewindTarget(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, messageSeq: number, coordinator: TurnCheckpointCoordinator): Promise<ResolvedPreviewTarget> {
  const { target, checkpoint } = await resolveMessageCheckpoint(deps, engine, sessionId, messageSeq)
  if (checkpoint === undefined) {
    // 没有持久检查点：先查持久跳过，再回落内存状态。
    const durableSkip = await engine.findTurnCheckpointSkip({
      cwd: target.cwd,
      sessionId,
      turn: target.turn,
      turnStartSeq: target.turnStartSeq,
    }).catch(() => undefined)
    return { status: 'unavailable', response: durableSkip ?? coordinator.state(sessionId, target.turn) }
  }
  return {
    status: 'ready',
    messageSeq,
    checkpoint: {
      id: checkpoint.id,
      cwd: checkpoint.cwd,
      turn: checkpoint.turn,
      turnStartSeq: checkpoint.turnStartSeq,
      ...(checkpoint.previousTurnEndSeq === undefined ? {} : { previousTurnEndSeq: checkpoint.previousTurnEndSeq }),
    },
  }
}

async function resolveTurnRewindTarget(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, turn: number, coordinator: TurnCheckpointCoordinator): Promise<ResolvedPreviewTarget> {
  const resolved = await resolveTurnCheckpoint(deps, engine, sessionId, turn)
  if (resolved.checkpoint === undefined) {
    const durableSkip = await engine.findTurnCheckpointSkip({
      cwd: resolved.cwd,
      sessionId,
      turn,
      turnStartSeq: resolved.turnStartSeq,
    }).catch(() => undefined)
    return { status: 'unavailable', response: durableSkip ?? coordinator.state(sessionId, turn) }
  }
  return {
    status: 'ready',
    checkpoint: { id: resolved.checkpoint.id, cwd: resolved.cwd, turn, turnStartSeq: resolved.turnStartSeq },
  }
}

/**
 * 回合 → 检查点解析：优先本会话自身的检查点；fork 产物在本会话没有该回合
 * 检查点时沿父链继承——只有回合起点落在 seed 范围内（fork 之前发生的回合）
 * 才允许继承，且继承检查点的 turnStartSeq 必须与本会话的回合起点一致。
 */
async function resolveTurnCheckpoint(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, turn: number): Promise<{
  cwd: string
  turnStartSeq: number
  checkpoint?: { id: string }
}> {
  let current = await readSession(deps, sessionId)
  const target = turnTarget(current, turn)
  const direct = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId, turn })
  if (direct !== undefined) {
    if (direct.turnStartSeq !== target.turnStartSeq) {
      throw new ShadowRewindError('PLAN_STALE', '该回合的检查点与回合起点不再匹配')
    }
    return { cwd: target.cwd, turnStartSeq: target.turnStartSeq, checkpoint: { id: direct.id } }
  }
  const seen = new Set([sessionId])
  for (;;) {
    const parentId = current.header.parentSession
    const seedLength = current.header.seedLength
    if (parentId === undefined || seedLength === undefined || target.turnStartSeq >= seedLength) {
      return { cwd: target.cwd, turnStartSeq: target.turnStartSeq }
    }
    if (seen.has(parentId)) {
      throw new ShadowRewindError('PLAN_STALE', '会话分叉谱系出现环')
    }
    seen.add(parentId)
    try {
      current = await readSession(deps, parentId)
    } catch (error) {
      throw new ShadowRewindError('PLAN_STALE', `父会话 ${parentId} 不可读`, { cause: error })
    }
    const inherited = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId: parentId, turn })
    if (inherited === undefined) continue
    if (inherited.turnStartSeq !== target.turnStartSeq) {
      throw new ShadowRewindError('PLAN_STALE', '继承的检查点与该回合起点不匹配')
    }
    return { cwd: target.cwd, turnStartSeq: target.turnStartSeq, checkpoint: { id: inherited.id } }
  }
}

function turnTarget(session: { id: string; header: { cwd?: string }; events: readonly SessionEvent[] }, turn: number): { cwd: string; turnStartSeq: number } {
  const cwd = session.header.cwd
  if (cwd === undefined) {
    throw new ShadowRewindError('WORKSPACE_REQUIRED', `会话 ${session.id} 没有工作目录`)
  }
  const start = session.events.find((event) => event.type === 'turn/start' && event.data.turn === turn)
  if (start === undefined) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `会话 ${session.id} 没有回合 ${String(turn)} 的起点`)
  }
  return { cwd, turnStartSeq: start.seq }
}

async function turnCheckpointForRequest(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, turn: number, requestedId: string): Promise<{ id: string; cwd: string }> {
  const resolved = await resolveTurnCheckpoint(deps, engine, sessionId, turn)
  if (resolved.checkpoint === undefined) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `回合 ${String(turn)} 没有可用的快照检查点`)
  }
  if (requestedId !== resolved.checkpoint.id) {
    throw new ShadowRewindError('PLAN_STALE', '该回合的检查点已变化；请重新检查')
  }
  return { id: resolved.checkpoint.id, cwd: resolved.cwd }
}

/**
 * 运行中的共享工作区会话分诊：哪些真正阻塞恢复，哪些只是被闸住的旁观者。
 *  - 闸开启：只有「请求者自身」（恢复期间它可能写文件）与「当前所有者」
 *    （唯一未被闸拒绝的写入者）阻塞；其余运行中的会话写入已被拒绝，只提示。
 *  - 闸关闭：保持旧行为——任何运行中的会话都阻塞。
 */
export function partitionRunningSessions(runningSessionIds: readonly string[], requesterSessionId: string, ownerSessionId: string | undefined, gateEnabled: boolean): { blocking: readonly string[]; gated: readonly string[] } {
  if (!gateEnabled) return { blocking: [...runningSessionIds], gated: [] }
  const blocking: string[] = []
  const gated: string[] = []
  for (const id of runningSessionIds) {
    if (id === requesterSessionId || (ownerSessionId !== undefined && id === ownerSessionId)) blocking.push(id)
    else gated.push(id)
  }
  return { blocking, gated }
}

/** 执行前的公共闸门：工作区占用检查 + 计划与确认串必须齐备。 */
async function applyGuarded(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, cwd: string, writeGate: WorkspaceWriteGate, planId: string | undefined, confirmation: string | undefined): Promise<RestoreResult> {
  const running = await sharedWorkspaceSessions(deps, cwd)
  const ownerId = await writeGate.ownerOf(cwd)
  const { blocking } = partitionRunningSessions(running, sessionId, ownerId, writeGate.isEnabled)
  if (blocking.length > 0) {
    throw new ShadowRewindError('WORKSPACE_IN_USE', `项目目录正被这些会话占用（恢复会与它们的写入冲突）：${blocking.slice(0, 5).join(', ')}`)
  }
  if (planId === undefined || confirmation === undefined) {
    throw new ShadowRewindError('NO_CHANGES', '该回合没有可恢复的项目文件变更')
  }
  const result = await engine.applyRestore({ planId, confirmation, sessionId })
  // 恢复改变了磁盘与快照历史：数据版本递增，客户端 fs 缓存随之失效。
  await bumpWorkspaceRevision(cwd)
  return result
}

async function createConversationRestart(deps: RewindHttpDeps, sourceId: string, checkpoint: { cwd: string; messageSeq: number; turn: number; turnStartSeq: number; previousTurnEndSeq?: number }): Promise<{ sessionId: string }> {
  const source = await readSession(deps, sourceId)
  const current = messageTarget(source, checkpoint.messageSeq)
  if (current.turn !== checkpoint.turn
    || current.turnStartSeq !== checkpoint.turnStartSeq
    || current.previousTurnEndSeq !== checkpoint.previousTurnEndSeq) {
    throw new ShadowRewindError('PLAN_STALE', '会话中已找不到所选消息的回合边界')
  }
  const response = checkpoint.previousTurnEndSeq === undefined
    ? await deps.apiProxy.sessions.create({ rpcId: randomUUID(), payload: { cwd: checkpoint.cwd } })
    : await deps.apiProxy.sessions.fork({ rpcId: randomUUID(), payload: { sessionId: sourceId, atSeq: checkpoint.previousTurnEndSeq } })
  if (!response.result.ok) {
    throw new ShadowRewindError('CONVERSATION_REWIND_FAILED', response.result.error?.message ?? '未知错误')
  }
  return { sessionId: requiredText(response.result.value?.sessionId, 'fork sessionId') }
}

function messageTarget(session: { id: string; header: { cwd?: string }; events: readonly SessionEvent[] }, messageSeq: number): MessageTarget {
  const cwd = session.header.cwd
  if (cwd === undefined) {
    throw new ShadowRewindError('WORKSPACE_REQUIRED', `会话 ${session.id} 没有工作目录`)
  }
  const message = session.events.find((event) => event.type === 'user/message' && event.seq === messageSeq && isDirectUserMessage(event))
  if (message === undefined) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `会话 ${session.id} 在 ${String(messageSeq)} 处没有用户消息`)
  }
  const start = findLast(session.events, (event) => event.type === 'turn/start' && event.seq < messageSeq)
  const turn = start?.data.turn
  if (start === undefined || !Number.isSafeInteger(turn) || (turn ?? 0) < 0) {
    throw new ShadowRewindError('PLAN_STALE', '所选消息没有有效的回合起点')
  }
  // 只允许回退回合的第一条直发消息（插件注入等来源不可回退）。
  const opening = session.events.find((event) => event.type === 'user/message'
    && event.seq > start.seq
    && event.seq <= messageSeq
    && isDirectUserMessage(event))
  if (opening?.seq !== messageSeq) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', '只支持回退回合的第一条用户消息')
  }
  const interveningEnd = session.events.find((event) => event.type === 'turn/end' && event.seq > start.seq && event.seq < messageSeq)
  if (interveningEnd !== undefined) {
    throw new ShadowRewindError('PLAN_STALE', '所选消息已不在其记录的回合内')
  }
  const previousEnd = findLast(session.events, (event) => event.type === 'turn/end' && event.seq < start.seq)
  return {
    cwd,
    messageSeq,
    turn: turn as number,
    turnStartSeq: start.seq,
    ...(previousEnd === undefined ? {} : { previousTurnEndSeq: previousEnd.seq }),
  }
}

function isDirectUserMessage(event: SessionEvent): boolean {
  const source = event.data.source
  return source !== null && typeof source === 'object' && !Array.isArray(source)
    && (source as { kind?: unknown }).kind === 'user'
}

/** 列出与目标目录共享同一工作区的活跃会话（canonical realpath 比对）。 */
async function sharedWorkspaceSessions(deps: RewindHttpDeps, cwd: string): Promise<readonly string[]> {
  const listed = deps.agents.list()
  if (listed.length === 0) return []
  const root = await canonicalDirectory(cwd).catch(() => undefined)
  if (root === undefined) return []
  const shared: string[] = []
  for (const agent of listed) {
    if (agent.status !== 'running') continue
    const agentCwd = agent.session.header.cwd
    if (agentCwd === undefined) continue
    const agentRoot = await canonicalDirectory(agentCwd).catch(() => undefined)
    if (agentRoot === root) shared.push(agent.session.id)
  }
  return shared.sort()
}

// ── HTTP 小工具 ─────────────────────────────────────────────────────────────

function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function json(response: Response, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(`${JSON.stringify(value)}\n`)
}

async function readJsonBody(request: Request): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  await new Promise<void>((resolve, reject) => {
    request.on('data', (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      size += bytes.length
      if (size > BODY_LIMIT) {
        reject(new ShadowRewindError('INVALID_ARGUMENTS', '请求体过大'))
        return
      }
      chunks.push(bytes)
    })
    request.on('end', () => resolve())
    request.on('error', reject)
  })
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new ShadowRewindError('INVALID_ARGUMENTS', '请求体必须是合法 JSON', { cause: error })
  }
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') {
    throw new ShadowRewindError('INVALID_ARGUMENTS', `${name} 必须是非空字符串`)
  }
  return value
}

function optionalText(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requiredText(value, name)
}

function nonNegativeInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 0) {
    throw new ShadowRewindError('INVALID_ARGUMENTS', `${name} 必须是非负整数`)
  }
  return parsed as number
}

function pageSize(value: string | null, fallback: number): number {
  if (value === null) return fallback
  const parsed = nonNegativeInteger(value, 'limit')
  if (parsed < 1 || parsed > MAX_CHANGE_PAGE_SIZE) {
    throw new ShadowRewindError('INVALID_ARGUMENTS', `limit 必须在 1 到 ${String(MAX_CHANGE_PAGE_SIZE)} 之间`)
  }
  return parsed
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
    
    // live = 读当前磁盘（live-tail 条目的 after 内容）；围栏：必须落在工作区内。
    if (checkpointId === 'live') {
      const candidate = resolve(cwd, path)
      const rel = relative(cwd, candidate)
      if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', 'path 必须在工作区之内')
      }
      let liveContent: Buffer
      try {
        liveContent = await readFile(candidate)
      } catch {
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

// ── 工作区数据版本（fs-changes 客户端 warm 的跳过依据）────────────────────
// 检查点捕获 / 恢复成功即递增；键为 canonical realpath。进程内计数即可：
// 它只回答「变没变」，不需要跨进程唯一。

const workspaceRevisions = new Map<string, number>()

async function bumpWorkspaceRevision(cwd: string): Promise<void> {
  const key = await canonicalDirectory(cwd).catch(() => undefined)
  if (key === undefined) return
  workspaceRevisions.set(key, (workspaceRevisions.get(key) ?? 0) + 1)
}

async function workspaceRevision(cwd: string): Promise<number> {
  const key = await canonicalDirectory(cwd).catch(() => undefined)
  return key === undefined ? 0 : workspaceRevisions.get(key) ?? 0
}

// ── fs-changes 的服务端行数统计 ─────────────────────────────────────────
// 轮次配对与 live-tail 的两侧内容宿主本来就持有（检查点 blob / live 扫描读
// 盘），在服务端把 added/removed 算好随响应下发——过去客户端为渲染 +/− 要
// 把每个文件的新旧全文各拉一遍，一轮 30 个文件就是 60 个请求。

/** 行数统计的单侧字节上限：超出视为统计不可得（数量级保护，非语义边界）。 */
const DIFF_COUNT_MAX_BYTES = 2 * 1024 * 1024
/** 单次 fs-changes 请求的行数统计预算（按变更条数计）：超出后剩余变更不带行数。 */
const DIFF_COUNT_BUDGET = 600

function decodeUtf8(bytes: Buffer): string | null {
  const text = bytes.toString('utf8')
  // 往返校验：非 UTF-8 内容按「统计不可得」处理，绝不猜着算。
  return Buffer.from(text, 'utf8').equals(bytes) ? text : null
}

function countLines(text: string): number {
  if (text === '') return 0
  let count = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1
  return text.endsWith('\n') ? count : count + 1
}

function lineCounts(before: string, after: string): { added: number; removed: number } {
  // 行数按 LF 规范化统计：CRLF 文件不会产生幽灵增删。
  let added = 0
  let removed = 0
  for (const part of diffLines(before.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), after.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))) {
    if (part.added === true) added += part.count ?? 0
    else if (part.removed === true) removed += part.count ?? 0
  }
  return { added, removed }
}

/** 读变更单侧内容：checkpointId 或 'live'（当前磁盘，围栏同 /file 端点）。 */
async function readChangeSide(engine: ShadowRewindEngine, cwd: string, sourceId: string, path: string): Promise<Buffer | null> {
  if (sourceId === 'live') {
    const candidate = resolve(cwd, path)
    const rel = relative(cwd, candidate)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null
    try {
      return await readFile(candidate)
    } catch {
      return null
    }
  }
  return engine.getFileContentFromCheckpoint({ cwd, checkpointId: sourceId, path })
}

/** 端点变更条目：path/kind + 服务端预算行数 + 检查点权限位 + 目录标记。
 * oldMode/newMode 供客户端透传给宿主撤销（写回时恢复权限位）；
 * dir 条目的撤销语义是 mkdir/rmdir，不产生行数。 */
interface FsChangeItem {
  path: string
  kind: 'added' | 'modified' | 'deleted'
  added?: number
  removed?: number
  oldMode?: number
  newMode?: number
  dir?: true
}

/** 为一条变更补行数与元数据；内容缺失/超限/非 UTF-8/预算耗尽都静默省略行数字段。
 * mode-changed（纯权限位变更）对外映射为 'modified'——内容两侧相同，行数自然为 0。 */
async function withLineCounts(
  engine: ShadowRewindEngine,
  cwd: string,
  change: WorkspaceChange,
  prevId: string,
  nextId: string,
  budget: { remaining: number },
): Promise<FsChangeItem> {
  const base: FsChangeItem = {
    path: change.path,
    // 调用方已过滤：进来的只有 added/modified/deleted/mode-changed。
    kind: (change.kind === 'mode-changed' ? 'modified' : change.kind) as FsChangeItem['kind'],
    ...(change.before !== undefined && change.before.kind !== 'dir' ? { oldMode: change.before.mode } : {}),
    ...(change.after !== undefined && change.after.kind !== 'dir' ? { newMode: change.after.mode } : {}),
    ...(change.before?.kind === 'dir' || change.after?.kind === 'dir' ? { dir: true as const } : {}),
  }
  if (base.dir === true || budget.remaining <= 0) return base
  budget.remaining -= 1
  try {
    if (base.kind === 'added') {
      const after = await readChangeSide(engine, cwd, nextId, change.path)
      if (after === null || after.byteLength > DIFF_COUNT_MAX_BYTES) return base
      const text = decodeUtf8(after)
      return text === null ? base : { ...base, added: countLines(text), removed: 0 }
    }
    if (base.kind === 'deleted') {
      const before = await readChangeSide(engine, cwd, prevId, change.path)
      if (before === null || before.byteLength > DIFF_COUNT_MAX_BYTES) return base
      const text = decodeUtf8(before)
      return text === null ? base : { ...base, added: 0, removed: countLines(text) }
    }
    const [before, after] = await Promise.all([
      readChangeSide(engine, cwd, prevId, change.path),
      readChangeSide(engine, cwd, nextId, change.path),
    ])
    if (before === null || after === null
      || before.byteLength > DIFF_COUNT_MAX_BYTES || after.byteLength > DIFF_COUNT_MAX_BYTES) return base
    const beforeText = decodeUtf8(before)
    const afterText = decodeUtf8(after)
    if (beforeText === null || afterText === null) return base
    return { ...base, ...lineCounts(beforeText, afterText) }
  } catch {
    return base
  }
}

/**
 * GET /shadow-rewind/fs-changes：批量返回会话所有轮次的文件系统变更。
 *
 * 归属语义：第 N 轮的变更 = diff(第 N 轮轮起检查点, 第 N+1 轮轮起检查点)——
 * 第 N+1 轮第一步之前的捕获天然等于第 N 轮的轮末树状态。最后一轮没有下一轮
 * 检查点，不在此返回（侧边栏对该轮的展示由「轮起检查点 vs 当前磁盘」的
 * 现有预览覆盖）。单轮对比失败只跳过该轮，不中断整体响应。
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
    const checkpoints = await engine.listTurnCheckpoints({ cwd, sessionId })
    const turns: {
      turn: number
      turnStartSeq: number
      checkpointId: string
      nextCheckpointId: string
      live?: true
      changes: readonly FsChangeItem[]
    }[] = []
    // 整个请求共享一份行数统计预算：预算耗尽后剩余变更只回 path/kind。
    const countBudget = { remaining: DIFF_COUNT_BUDGET }
    for (let index = 0; index < checkpoints.length - 1; index += 1) {
      const current = checkpoints[index]
      const next = checkpoints[index + 1]
      if (current === undefined || next === undefined) continue
      try {
        const fsDiff = await engine.diffCheckpoints({
          cwd,
          prevCheckpointId: current.id,
          currCheckpointId: next.id,
        })
        const raw = fsDiff.changes.filter((change) =>
          (change.kind === 'added' || change.kind === 'modified'
            || change.kind === 'deleted' || change.kind === 'mode-changed')
          // 空目录的纯权限位变化没有可撤销语义，直接省略。
          && !(change.kind === 'mode-changed' && change.before?.kind === 'dir'))
        // 轮间窗口归属过滤：窗口 (current, next] 落盘者未必是本会话（其它会话
        // 的检查点窗口会插进来）。用窗口内的快照做归属，剔除非本会话独有的
        // 路径——与 live-tail 同一规则，防止卡片撤销动到别的会话的写入。
        // 归属失败保守保留全部路径（宿主 CAS 仍兜底防误删）。
        let kept = raw
        if (raw.length > 0) {
          try {
            const attributed = await engine.listSnapshotsAfter({
              cwd,
              restorePointId: current.id,
              paths: raw.map((change) => change.path),
            })
            const within = attributed.snapshots.filter((snapshot) => snapshot.createdAt < next.createdAt)
            const ownership = attributePaths({
              targetSessionId: attributed.targetSessionId,
              changes: raw,
              snapshots: within,
            })
            kept = raw.filter((change) => {
              const owner = ownership.get(change.path)?.owner
              return owner === undefined || owner.kind === 'target'
            })
          } catch (error) {
            deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn ?? '?')} 归因失败，保留全部路径：${errorMessage(error)}`)
          }
        }
        if (kept.length > 0 && current.turn !== undefined && current.turnStartSeq !== undefined) {
          const changes = await Promise.all(kept.map((change) => withLineCounts(engine, cwd, change, current.id, next.id, countBudget)))
          turns.push({
            turn: current.turn,
            turnStartSeq: current.turnStartSeq,
            checkpointId: current.id,
            nextCheckpointId: next.id,
            changes,
          })
        }
      } catch (error) {
        // 单轮对比失败只跳过该轮；对比失败不影响整体响应。
        deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn ?? '?')} 文件系统差异计算失败：${errorMessage(error)}`)
      }
    }
    // live-tail：最后一个检查点 vs 当前磁盘——覆盖最新一轮（尚无下一轮检查点）
    // 的终端写盘。after 内容经 /shadow-rewind/file?checkpointId=live 读当前磁盘。
    const last = checkpoints[checkpoints.length - 1]
    if (last !== undefined && last.turn !== undefined && last.turnStartSeq !== undefined) {
      try {
        const live = await engine.inspect({ cwd, restorePointId: last.id })
        // live-tail 归属过滤：最后检查点之后磁盘上的变化未必是本会话写的
        // （其它会话的检查点窗口、恢复操作都会动盘）。非本会话窗口独有的
        // 路径一律剔除——live 条目的 after 内容就是「当前磁盘」，据此派生
        // 的整文件 diff 一旦撤销会删掉/覆盖别的会话刚写的工作（fs-added
        // 的撤销是真实 rm）。
        const raw = live.changes.filter((change) =>
          (change.kind === 'added' || change.kind === 'modified'
            || change.kind === 'deleted' || change.kind === 'mode-changed')
          && !(change.kind === 'mode-changed' && change.before?.kind === 'dir'))
        let kept = raw
        if (raw.length > 0) {
          try {
            const attributed = await engine.listSnapshotsAfter({
              cwd,
              restorePointId: last.id,
              paths: raw.map((change) => change.path),
            })
            const ownership = attributePaths({
              targetSessionId: attributed.targetSessionId,
              changes: raw,
              snapshots: attributed.snapshots,
            })
            kept = raw.filter((change) => {
              const owner = ownership.get(change.path)?.owner
              return owner === undefined || owner.kind === 'target'
            })
          } catch (error) {
            deps.logger.warn(`[shadow-rewind] live-tail 归因失败，保留全部路径：${errorMessage(error)}`)
          }
        }
        if (kept.length > 0) {
          const changes = await Promise.all(kept.map((change) => withLineCounts(engine, cwd, change, last.id, 'live', countBudget)))
          turns.push({
            turn: last.turn,
            turnStartSeq: last.turnStartSeq,
            checkpointId: last.id,
            nextCheckpointId: 'live',
            live: true,
            changes,
          })
        }
      } catch (error) {
        deps.logger.warn(`[shadow-rewind] 轮 ${String(last.turn)} live 文件系统差异计算失败：${errorMessage(error)}`)
      }
    }
    json(response, 200, { sessionId, rev: await workspaceRevision(cwd), turns })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'FS_CHANGES_FAILED',
    })
  }
}