/**
 * 宿主适配层：回合检查点协调器 + `/shadow-rewind` 同源 HTTP 端点。
 *
 * 协调器把「每轮第一步之前自动快照」挂在 agent/pre-step 瀑布最前面；
 * 快照失败只记录、绝不阻塞用户回合。HTTP 端点负责消息→检查点解析、
 * 分页预览、计划生成与恢复执行；会话分叉交给 DSH 官方 create/fork。
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { diffLines } from 'diff'
import { createDeadline } from './deadline.js'
import { ShadowRewindError, errorMessage } from './errors.js'
import { canonicalDirectory } from './path-utils.js'
import { isCheckpointSkipCode } from './engine.js'
import { attributeFsChanges, attributePaths, serializeOwner } from './attribution.js'
import { collectTurnIntent, traceNodes, traceRangeDiff, traceSpans, turnBoundaries } from './trace-replay.js'
import type { FsAttribution, PathAttribution } from './attribution.js'
import type { WorkspaceWriteGate } from './write-gate.js'
import type { CommandWindowRegistry } from './command-windows.js'
import type { ShadowRewindEngine } from './engine.js'
import type { RestorePointSummary, RestoreResult, TurnIntent, WorkspaceChange } from './types.js'

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
  on(event: 'session/event', listener: (session: SessionFace, event: SessionEventFace) => void): void
}

/** session/event 载荷里的会话面（与 AgentFace.session 同形）。 */
export type SessionFace = AgentFace['session']

/** session/event 载荷里的事件面：只用到 type 与 data.turn。 */
export interface SessionEventFace {
  readonly type: string
  readonly seq?: number
  readonly data?: { readonly turn?: number }
}

export interface PreStepData {
  readonly agent: AgentFace
  readonly turn: number
  readonly step: number
  readonly signal: AbortSignal
}

/**
 * 宿主 session 面的单条事件（结构类型）。dsh 0.1.2 的 `Session.snapshotEvents()`
 * 返回的是冻结的核心事件记录（字段更丰富），此处只消费 type/seq/data，结构兼容。
 */
export interface SessionLogEvent {
  readonly type: string
  readonly seq: number
  readonly data: {
    readonly turn?: number
    readonly source?: unknown
  }
}

/** 引擎用到的 agent/会话最小面。 */
export interface AgentFace {
  readonly id: string
  readonly status: string
  readonly session: {
    readonly id: string
    readonly header: { readonly cwd?: string; readonly parentSession?: string }
    /**
     * dsh ≤0.1.1 的 runtime 会话面把事件暴露为数组 `events`；0.1.2 起核心
     * `Session` 改为 `snapshotEvents()` 方法（无 `events` 字段）。两态并存，
     * 读取统一走 {@link sessionEvents}。
     */
    readonly events?: readonly SessionLogEvent[]
    readonly snapshotEvents?: () => readonly SessionLogEvent[]
  }
}

/**
 * 读会话事件：兼容 0.1.2 `Session.snapshotEvents()` 与旧 runtime 的 `events`
 * 数组两种形态（事件面缺失返回空，不抛错）。
 */
export function sessionEvents(session: { readonly events?: readonly SessionLogEvent[]; readonly snapshotEvents?: () => readonly SessionLogEvent[] } | undefined | null): readonly SessionLogEvent[] {
  if (session === undefined || session === null) return []
  if (Array.isArray(session.events)) return session.events
  const via = session.snapshotEvents?.()
  return via ?? []
}

/** 每回合第一步之前抢占快照（失败可跳过、可重试，绝不阻塞回合）。 */
export class TurnCheckpointCoordinator {
  private readonly engine: ShadowRewindEngine
  /** sessionId\0turn → 捕获 Promise（同回合幂等）。 */
  private readonly captures = new Map<string, Promise<void>>()
  private readonly pending = new Set<string>()
  private readonly failures = new Map<string, string>()
  private readonly skips = new Map<string, string>()
  /** sessionId\0turn → 轮末捕获进行中（同回合同相位不重复发起）。 */
  private readonly endCaptures = new Set<string>()
  /** workspace → 串行化尾队列：同一工作区的快照绝不并发。 */
  private readonly workspaceTails = new Map<string, Promise<void>>()

  constructor(engine: ShadowRewindEngine) {
    this.engine = engine
    if (engine.downgradeReason !== undefined) {
      // 降级是重要状态：启动时必须让用户在日志里看到。
      console.warn(`[shadow-rewind] ${engine.downgradeReason}`)
    }
  }

  /** 安装第一步闸门（prepend 保证先于其它监听器）与轮末捕获订阅。 */
  install(ctx: HostContext): void {
    ctx.on('agent/pre-step', async (data, next) => {
      if (data.step === 1) await this.capture(ctx, data.agent, data.turn, data.signal)
      return next()
    }, { prepend: true })
    // 轮末检查点：turn/end 事件时冻结轮末树状态。尽力而为——失败仅退化为
    // 「下一轮轮起」配对（旧语义），绝不阻塞会话，也不进轮起捕获的状态面。
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end') return
      void this.captureEnd(ctx, session, event)
    })
  }

  /** 轮末捕获（见 install 注释）：与轮起捕获共用工作区串行化尾队列。 */
  async captureEnd(ctx: HostContext, session: SessionFace, event: SessionEventFace): Promise<void> {
    if (this.engine.turnCheckpointsDisabled) return
    const turn = event.data?.turn
    const cwd = session.header.cwd
    if (typeof turn !== 'number' || !Number.isSafeInteger(turn) || turn < 0) return
    if (cwd === undefined || cwd.trim() === '') return
    const key = checkpointKey(session.id, turn)
    if (this.endCaptures.has(key)) return
    const start = findLast(sessionEvents(session), (e) => e.type === 'turn/start' && e.data.turn === turn)
    if (start === undefined) {
      ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 轮末检查点跳过：找不到 turn/start 事件`)
      return
    }
    this.endCaptures.add(key)
    const timeoutMs = this.engine.config.turnCheckpointTimeoutMs
    const deadline = createDeadline(timeoutMs)
    // 意图标签（A2）：轮窗口内的内容型工具调用摘要——回答「这一轮是谁改的」。
    // 从会话事件读取，尽力而为：解析失败只少标签，不影响检查点本身。
    const intent = collectTurnIntent(sessionEvents(session), start.seq)
    try {
      await this.serializeWorkspace(cwd, deadline.signal, async () => {
        await this.engine.createTurnCheckpoint({
          cwd,
          sessionId: session.id,
          turn,
          turnStartSeq: start.seq,
          phase: 'end',
          ...(intent.length > 0 ? { intent } : {}),
          signal: deadline.signal,
        })
        void bumpWorkspaceRevision(cwd)
      })
    } catch (error) {
      const bounded = asCheckpointError(error, timeoutMs, deadline.signal.aborted)
      ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 轮末检查点失败（归属退化为下一轮轮起配对）：${errorMessage(bounded)}`)
    } finally {
      deadline.cancel()
      this.endCaptures.delete(key)
    }
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
    const start = findLast(sessionEvents(agent.session), (event) => event.type === 'turn/start' && event.data.turn === turn)
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

/** 宿主 session 持久化快照的冷读返回（session-query `readSession` 的 0.1.2 形状）。 */
export interface SessionLogSnapshotLike {
  readonly session: {
    readonly id: string
    readonly cwd?: string
    readonly parentSession?: string
    /** dsh ≤0.1.1 头部字段；0.1.2 起被 `isSeeded` + `inheritedEventCount` 取代。 */
    readonly seedLength?: number
  }
  /** dsh 0.1.2 起：fork 继承事件前缀长度（seedLength 的替代）。 */
  readonly inheritedEventCount?: number
  readonly events?: readonly unknown[]
}

/** 宿主会话对象最小面：兼容核心 `Session` 与旧 runtime agent 包装两态。 */
export interface HostSessionCore {
  readonly id?: string
  readonly header?: { readonly cwd?: string; readonly parentSession?: string; readonly seedLength?: number }
  /** dsh 0.1.2 起 `Session` 的核心面：fork 继承事件前缀长度。 */
  readonly inheritedEventCount?: number
  readonly events?: readonly SessionLogEvent[]
  readonly snapshotEvents?: () => readonly SessionLogEvent[]
}
/** agents/sessions 服务 get() 的返回面（容忍 agent 包装 `.session`）。 */
export type HostSessionLike = HostSessionCore & {
  readonly session?: HostSessionCore
  readonly status?: string
}

/** dsh 0.1.2 的 SessionController 服务最小面（apiProxy 被移除后的替代入口）。 */
export interface SessionControllerLike {
  create(payload: { readonly cwd?: string; readonly sessionId?: string; readonly workspaceId?: string }): Promise<{ readonly sessionId: string; readonly agentPreset?: string }>
  fork(payload: { readonly sessionId: string; readonly atSeq?: number }): Promise<{ readonly sessionId: string }>
}

/** 宿主给 HTTP 层的服务面（会话读取 / 分叉 / 活跃 agent 列表）。 */
export interface RewindHttpDeps {
  readonly logger: { warn(message: string): void }
  readonly sessions: {
    get(sessionId: string): HostSessionLike | undefined
  }
  readonly sessionQuery: {
    readSession(sessionId: string): Promise<SessionLogSnapshotLike>
  }
  /**
   * 会话 create/fork（会话「恢复并继续」的分叉落点）。dsh 0.1.1 及更早由
   * `ctx.apiProxy` 提供（RPC 信封形状）；0.1.2 起 apiProxy 移除，会话网关
   * 收敛为 `ctx.sessionController`（直连方法，错误以 throw 表达）。
   */
  readonly sessionController: SessionControllerLike
  readonly agents: {
    list(): readonly AgentFace[]
  }
}

/**
 * 归一化宿主会话读取：把 live（ctx.sessions.get）与冷读（sessionQuery
 * readSession）两种来源统一成 `{ id, header{...,seedLength}, events }`，
 * 并把 0.1.2 的 `inheritedEventCount` 映射回插件内部使用的 `seedLength`
 * 语义（fork 继承边界 = 继承事件前缀长度），下游逻辑零改动。
 */
async function readSession(
  deps: Pick<RewindHttpDeps, 'sessions' | 'sessionQuery'>,
  sessionId: string,
): Promise<{ id: string; header: { cwd?: string; parentSession?: string; seedLength?: number }; events: readonly SessionEvent[] }> {
  const live = deps.sessions.get(sessionId)
  if (live !== undefined) {
    const core: HostSessionCore | undefined = live.session ?? live
    const header = core?.header
    const inherited = core?.inheritedEventCount ?? header?.seedLength
    return {
      id: core?.id ?? live.id ?? sessionId,
      header: {
        ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
        ...(header?.parentSession === undefined ? {} : { parentSession: header.parentSession }),
        ...(inherited === undefined ? {} : { seedLength: inherited }),
      },
      events: sessionEvents(core ?? live) as readonly SessionEvent[],
    }
  }
  const stored = await deps.sessionQuery.readSession(sessionId)
  const header = stored.session
  const inherited = stored.inheritedEventCount ?? header.seedLength
  return {
    id: header.id ?? sessionId,
    header: {
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(header.parentSession === undefined ? {} : { parentSession: header.parentSession }),
      ...(inherited === undefined ? {} : { seedLength: inherited }),
    },
    events: (stored.events ?? []) as readonly SessionEvent[],
  }
}

/** 注册同源端点；非回环请求一律 403（与旧插件同一安全边界）。 */
export function installShadowRewindHttp(ctx: RewindHttpDeps & { webServer?: { register(route: { kind: 'exact'; path: string; handler: (request: Request, response: Response) => Promise<void> }): () => void } }, engine: ShadowRewindEngine, coordinator: TurnCheckpointCoordinator, writeGate: WorkspaceWriteGate, commandWindows?: CommandWindowRegistry): void {
  ctx.webServer?.register({
    kind: 'exact',
    path: REWIND_HTTP_PATH,
    handler: (request, response) => handleRewindHttp(ctx, engine, coordinator, writeGate, commandWindows, request, response),
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
    handler: (request, response) => handleFsChangesHttp(ctx, engine, request, response, writeGate, commandWindows),
  })
  // 新增：轨迹时间线 + 区间 diff（轨迹重放 / 快照对比二选一）。
  ctx.webServer?.register({
    kind: 'exact',
    path: `${REWIND_HTTP_PATH}/trace`,
    handler: (request, response) => handleTraceHttp(ctx, engine, request, response),
  })
  // 新增：撤销最近一次恢复（B1，进程内单次 undo）。
  ctx.webServer?.register({
    kind: 'exact',
    path: `${REWIND_HTTP_PATH}/restore-undo`,
    handler: (request, response) => handleRestoreUndoHttp(ctx, engine, request, response),
  })
}

/** POST /shadow-rewind/restore-undo：撤销该会话工作区最近一次恢复。 */
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
    const body = await readJsonBody(request) as { sessionId?: unknown; cwd?: unknown }
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
    const result = await engine.undoLastRestore({ cwd })
    json(response, 200, result)
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'RESTORE_UNDO_FAILED',
    })
  }
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

async function handleRewindHttp(deps: RewindHttpDeps, engine: ShadowRewindEngine, coordinator: TurnCheckpointCoordinator, writeGate: WorkspaceWriteGate, commandWindows: CommandWindowRegistry | undefined, request: Request, response: Response): Promise<void> {
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
        // 包围轮降级（与卡片流同源）：网格判为本会话、但终值 mtime 指向其
        // 它会话命令窗口的写入，是明确的他写者证据——改为 multi，默认勾
        // 选不得静默纳入它会话写入。预览目标无 createdAt，全窗口查询（剪
        // 枝无意义传 0；匹配本就以 mtime 为准）。
        const evidence = await attributeFsChanges({
          targetSessionId: attributed.targetSessionId,
          cwd: checkpoint.cwd,
          changes: inspection.changes,
          ownership,
          windowStartMs: 0,
          windowEndMs: Date.now(),
          commandWindows,
        })
        for (const [path, attr] of evidence) {
          if (attr.owner === 'multi' && ownership.get(path)?.owner.kind === 'target') {
            ownership.set(path, { owner: { kind: 'multi' }, autoSelect: false })
          }
        }
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
              gateEnabled: writeGate.isEnabled,
              commandWindows,
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
          // 工作区绝对路径：恢复预览的行级 diff（当前 → 快照）按需拉两侧
          // 全文时要用（/shadow-rewind/file 端点的 cwd 参数）。只增字段，旧客户端忽略。
          workspace: checkpoint.cwd,
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
  try {
    // dsh 0.1.2 起 apiProxy 移除：会话网关收敛为 `ctx.sessionController`
    // （方法直连、错误以 throw 表达），不再包 RPC 信封。
    const sessionId = checkpoint.previousTurnEndSeq === undefined
      ? (await deps.sessionController.create({ cwd: checkpoint.cwd })).sessionId
      : (await deps.sessionController.fork({ sessionId: sourceId, atSeq: checkpoint.previousTurnEndSeq })).sessionId
    return { sessionId }
  } catch (error) {
    throw new ShadowRewindError('CONVERSATION_REWIND_FAILED', errorMessage(error), { cause: error })
  }
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
 * dir 条目的撤销语义是 mkdir/rmdir，不产生行数。
 * 归因字段（闸关时才透出）：见 attribution.ts 的 FsAttribution。 */
interface FsChangeItem {
  path: string
  kind: 'added' | 'modified' | 'deleted'
  added?: number
  removed?: number
  oldMode?: number
  newMode?: number
  dir?: true
  /** serializeOwner 形态：'target' | 'multi' | 'unknown' | <sessionId>。 */
  owner?: string
  /** 回滚勾选清单默认值：仅归属本会话为 true。 */
  autoSelect?: boolean
  attribution?: FsAttribution['attribution']
  command?: FsAttribution['command']
  /** 当前内容的写入时间（ms epoch，来自快照条目的 mtimeNs）。 */
  writtenAt?: number
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

/** 一轮的文件系统变更条目（配对轮与 live-tail 同形）。 */
interface TurnFsChange {
  readonly turn: number
  readonly turnStartSeq: number
  readonly checkpointId: string
  readonly nextCheckpointId: string
  readonly live?: true
  /** 本轮内容型工具调用摘要（轮末检查点的 intent；live 轮从会话事件即时采集）。 */
  readonly intent?: readonly TurnIntent[]
  /** 检查点快照内容抽样不可读（影子仓库丢失 / sqlite 受损等）：诚实标注。 */
  readonly degraded?: true
  readonly changes: readonly FsChangeItem[]
}

/**
 * 共享配对助手：一轮的「检查点 diff + 窗口归属 + 行数预算」。轮配对
 * （diffCheckpoints）与 live-tail（inspect = 最后检查点 vs 当前磁盘）共用，
 * 两端点（/shadow-rewind 预览与 /shadow-rewind/fs-changes）不再各持一份拷贝。
 *
 * 归属行为按写入闸开关切换：
 *  - 闸开：剔除非本会话窗口独有的路径（现有语义，开闸回归的硬门槛）；
 *  - 闸关：全部保留并附归因（命令窗口 × 文件 mtime 关联；尽力归因、
 *    诚实标注歧义）。归属失败保守保留全部路径（宿主 CAS 仍兜底防误删）。
 *
 * 返回 undefined = 结构性跳过（无 sessionId / 无配对终点）或对比失败
 * （已记警告）；空 changes 数组原样返回，由调用方决定是否透出。
 */
async function computeTurnFsChanges(
  engine: ShadowRewindEngine,
  deps: Pick<RewindHttpDeps, 'logger'>,
  options: {
    readonly cwd: string
    readonly current: {
      readonly id: string
      readonly sessionId?: string
      readonly createdAt: number
      readonly turn: number
      readonly turnStartSeq: number
    }
    /** 归属终点：优先同轮轮末检查点（精确轮末树），回退下一轮轮起（旧语义）。 */
    readonly pairEnd?: { readonly id: string; readonly createdAt: number }
    /** 本轮意图摘要（配对轮取轮末检查点 manifest；live 轮由调用方从会话事件采集）。 */
    readonly intent?: readonly TurnIntent[]
    /** live-tail：无配对终点，对比源是当前磁盘。 */
    readonly live?: boolean
    readonly gateEnabled: boolean
    readonly commandWindows?: CommandWindowRegistry
    readonly countBudget: { remaining: number }
  },
): Promise<TurnFsChange | undefined> {
  const { cwd, current, gateEnabled, commandWindows, countBudget } = options
  const live = options.live === true
  if (current.sessionId === undefined) return undefined
  if (!live && options.pairEnd === undefined) return undefined
  // live-tail 的配对终点是哨兵（'live', +∞）：快照剪枝与窗口查询天然
  // 延伸到当前磁盘，后续分支与配对轮同形。
  const pairEnd = options.pairEnd ?? { id: 'live', createdAt: Number.MAX_SAFE_INTEGER }
  try {
    const fsDiff = live
      ? await engine.inspect({ cwd, restorePointId: current.id })
      : await engine.diffCheckpoints({ cwd, prevCheckpointId: current.id, currCheckpointId: pairEnd.id })
    const raw = fsDiff.changes.filter((change) =>
      (change.kind === 'added' || change.kind === 'modified'
        || change.kind === 'deleted' || change.kind === 'mode-changed')
      // 空目录的纯权限位变化没有可撤销语义，直接省略。
      && !(change.kind === 'mode-changed' && change.before?.kind === 'dir'))
    if (raw.length === 0) {
      return finishTurnFsChange(current, live, pairEnd, [], options.intent)
    }
    // 窗口 (current, pairEnd] 落盘者未必是本会话（其它会话的检查点窗口会
    // 插进来）。先用窗口内快照做网格归属，再用终值证据（净值内容 mtime ×
    // 命令窗口）归因——包围轮盲区在此降级：完全包住本窗口的其它会话轮没
    // 有窗口内检查点，网格会把它的写入误判为本会话，而 mtime 落在它的命令
    // 窗口即明确他写者，降级为 multi（闸开⇒剔除，闸关⇒不默认勾选+弹窗）。
    // 闸开剔除非本会话独有的路径——与 live-tail 同一规则，防止卡片撤销动
    // 到别的会话的写入；闸关全部保留，归属/置信级/命令信息随条目透出。
    let kept = raw
    let attribution = new Map<string, FsAttribution>()
    try {
      const attributed = await engine.listSnapshotsAfter({
        cwd,
        restorePointId: current.id,
        paths: raw.map((change) => change.path),
      })
      // 窗口内快照按终点时间剪枝（配对轮 = pairEnd.createdAt；live-tail 的
      // 哨兵终点 = +∞，等价全保留）。
      const within = attributed.snapshots.filter((snapshot) => snapshot.createdAt < pairEnd.createdAt)
      const ownership = attributePaths({
        targetSessionId: attributed.targetSessionId,
        changes: raw,
        snapshots: within,
      })
      // 窗口查询剪枝用轮配对 [current.createdAt, pairEnd.createdAt]；
      // 匹配只以 mtime ∈ [startedAt, endedAt] 为准（长命令跨轮不漏配）。
      const evidence = await attributeFsChanges({
        targetSessionId: attributed.targetSessionId,
        cwd,
        changes: raw,
        ownership,
        windowStartMs: current.createdAt,
        windowEndMs: pairEnd.createdAt,
        commandWindows,
      })
      if (gateEnabled) {
        kept = raw.filter((change) => {
          const owner = evidence.get(change.path)?.owner
          return owner === undefined || owner === 'target'
        })
      } else {
        attribution = evidence
      }
    } catch (error) {
      deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn)} ${live ? 'live-tail ' : ''}归因失败，保留全部路径：${errorMessage(error)}`)
    }
    const changes = await Promise.all(kept.map(async (change) => {
      const item = await withLineCounts(engine, cwd, change, current.id, pairEnd.id, countBudget)
      const attr = attribution.get(change.path)
      return attr === undefined ? item : {
        ...item,
        owner: attr.owner,
        autoSelect: attr.autoSelect,
        attribution: attr.attribution,
        ...(attr.command === undefined ? {} : { command: attr.command }),
        ...(attr.writtenAt === undefined ? {} : { writtenAt: attr.writtenAt }),
      }
    }))
    return finishTurnFsChange(current, live, pairEnd, changes, options.intent)
  } catch (error) {
    // 单轮对比失败只跳过该轮；对比失败不影响整体响应。
    deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn)} ${live ? 'live ' : ''}文件系统差异计算失败：${errorMessage(error)}`)
    return undefined
  }
}

function finishTurnFsChange(
  current: { readonly id: string; readonly turn: number; readonly turnStartSeq: number },
  live: boolean,
  pairEnd: { readonly id: string },
  changes: readonly FsChangeItem[],
  intent?: readonly TurnIntent[],
): TurnFsChange {
  return {
    turn: current.turn,
    turnStartSeq: current.turnStartSeq,
    checkpointId: current.id,
    nextCheckpointId: pairEnd.id,
    ...(live ? { live: true as const } : {}),
    ...(intent !== undefined && intent.length > 0 ? { intent } : {}),
    changes,
  }
}

/** 并行只读探测检查点内容可读性；返回「不可读」的 id 集合（探测失败也算不可读）。 */
async function probeUnreadableCheckpoints(engine: ShadowRewindEngine, cwd: string, ids: ReadonlySet<string>): Promise<Set<string>> {
  const unreadable = new Set<string>()
  await Promise.all([...ids].map(async (id) => {
    try {
      if (!(await engine.checkpointContentReadable({ cwd, restorePointId: id }))) unreadable.add(id)
    } catch {
      unreadable.add(id)
    }
  }))
  return unreadable
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
    const result = traceRangeDiff(session.events, fromSeq, toSeq)
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
 * 归属语义：第 N 轮的变更 = diff(第 N 轮轮起检查点, 第 N+1 轮轮起检查点)——
 * 第 N+1 轮第一步之前的捕获天然等于第 N 轮的轮末树状态。最后一轮没有下一轮
 * 检查点，不在此返回（侧边栏对该轮的展示由「轮起检查点 vs 当前磁盘」的
 * 现有预览覆盖）。单轮对比失败只跳过该轮，不中断整体响应。
 *
 * 本构建起每个 change 附带服务端预算的 added/removed 行数——客户端渲染
 * 行与 +/− 统计不再需要逐文件拉全文（全文仅在悬停/展开/撤销时按需取）。
 */
async function handleFsChangesHttp(deps: RewindHttpDeps, engine: ShadowRewindEngine, request: Request, response: Response, writeGate: WorkspaceWriteGate, commandWindows?: CommandWindowRegistry): Promise<void> {
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
        gateEnabled: writeGate.isEnabled,
        commandWindows,
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
      // live 条目的 after 内容就是「当前磁盘」，归属过滤/归因走同一助手
      // （闸开剔除非本会话窗口路径——整文件 diff 一旦撤销会删掉/覆盖别的
      // 会话刚写的工作；闸关全部保留并附归因）。
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
        gateEnabled: writeGate.isEnabled,
        commandWindows,
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
    json(response, 200, { sessionId, rev: await workspaceRevision(cwd), turns: marked })
  } catch (error) {
    json(response, 409, {
      error: errorMessage(error),
      code: error instanceof ShadowRewindError ? error.code : 'FS_CHANGES_FAILED',
    })
  }
}

// ── headless 命令面（A4，借鉴 dsh-checkpoint-diff 的 /diff、/rollback）──────
// dsh 0.1.2 的命令系统是 cordis 服务 `commands`（CommandRuntime.register），
// 命令不产生模型消息，结果由 UI 直接渲染——脚本与 CLI 也能消费。

/** 命令注册面（结构类型；`commands` 服务缺失时注册静默跳过，不 pending）。 */
export interface ShadowRewindCommandsHost {
  readonly commands?: {
    register(definition: {
      readonly name: string
      readonly description: string
      readonly input?: { readonly hint: string }
      readonly handler: (invocation: ShadowRewindCommandInvocation) => Promise<ShadowRewindCommandResult> | ShadowRewindCommandResult
    }): () => void
  }
}

export interface ShadowRewindCommandInvocation {
  readonly agent: AgentFace
  readonly rawInput: string
  readonly signal?: AbortSignal
}

export interface ShadowRewindCommandResult {
  readonly kind: 'success' | 'error'
  readonly text: string
}

const COMMAND_DIFF_USAGE = '用法：/shadow-diff [起] [终]\n起/终可以是：轮号（如 3）、检查点 id（rp_…）、轨迹节点（trace:序号）。\n省略「终」时对比「该轮轮起 → 该轮轮末（或下一轮轮起）」。'
/** 命令输出的行数上限（聊天输出不是导出工具，防刷屏）。 */
const COMMAND_MAX_ROWS = 40

/** 注册 headless 命令：/shadow-diff（区间 diff 摘要）与 /shadow-undo（撤销最近一次恢复）。 */
export function installShadowRewindCommands(ctx: ShadowRewindCommandsHost, engine: ShadowRewindEngine): void {
  ctx.commands?.register({
    name: 'shadow-diff',
    description: 'shadow-rewind：两个时间节点之间的文件变更摘要（轮号 / 检查点 id / trace 序号）',
    input: { hint: '[起] [终]' },
    handler: (invocation) => runShadowDiffCommand(engine, invocation),
  })
  ctx.commands?.register({
    name: 'shadow-undo',
    description: 'shadow-rewind：撤销这个工作区最近一次文件恢复',
    handler: (invocation) => runShadowUndoCommand(engine, invocation),
  })
}

type DiffTarget =
  | { readonly kind: 'turn'; readonly turn: number }
  | { readonly kind: 'checkpoint'; readonly id: string }
  | { readonly kind: 'trace'; readonly seq: number }

function parseDiffTarget(token: string): DiffTarget | null {
  if (/^rp_[0-9a-z]+_[0-9a-f]{12}$/.test(token)) return { kind: 'checkpoint', id: token }
  if (/^trace:[0-9]+$/.test(token)) return { kind: 'trace', seq: Number(token.slice('trace:'.length)) }
  if (/^[0-9]+$/.test(token) && token.length <= 9) return { kind: 'turn', turn: Number(token) }
  return null
}

async function runShadowDiffCommand(engine: ShadowRewindEngine, invocation: ShadowRewindCommandInvocation): Promise<ShadowRewindCommandResult> {
  const cwd = invocation.agent.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') {
    return { kind: 'error', text: '当前会话没有工作区，无法对比。' }
  }
  const tokens = invocation.rawInput.trim().split(/\s+/).filter((token) => token !== '')
  if (tokens.length === 0 || tokens.length > 2) return { kind: 'error', text: COMMAND_DIFF_USAGE }
  const targets: DiffTarget[] = []
  for (const token of tokens) {
    const target = parseDiffTarget(token)
    if (target === null) return { kind: 'error', text: `无法识别「${token}」。\n${COMMAND_DIFF_USAGE}` }
    targets.push(target)
  }
  try {
    if (targets.every((target) => target.kind === 'trace')) {
      const [from, to] = targets as [{ kind: 'trace'; seq: number }, { kind: 'trace'; seq: number }]
      if (from.seq >= to.seq) return { kind: 'error', text: 'trace 区间语义是 (from, to]，from 必须小于 to。' }
      const result = traceRangeDiff(sessionEvents(invocation.agent.session), from.seq, to.seq)
      const header = `轨迹区间 #${String(from.seq)} → #${String(to.seq)}：${String(result.changes.length)} 个文件变更`
      return { kind: 'success', text: formatCommandDiff(header, result.changes, result.notes) }
    }
    if (targets.some((target) => target.kind === 'trace')) {
      return { kind: 'error', text: `快照检查点与轨迹节点不可混用。\n${COMMAND_DIFF_USAGE}` }
    }
    const sessionId = invocation.agent.session.id
    const checkpoints = await engine.listTurnCheckpoints({ cwd, sessionId })
    const startByTurn = new Map<number, string>()
    for (const point of checkpoints) {
      if (point.phase !== 'end' && point.turn !== undefined) startByTurn.set(point.turn, point.id)
    }
    const resolveCheckpoint = async (target: DiffTarget): Promise<string | null> => {
      if (target.kind === 'checkpoint') return target.id
      if (target.kind === 'turn') return startByTurn.get(target.turn) ?? null
      return null
    }
    let fromId: string | null
    let toId: string | null
    if (targets.length === 1 && targets[0]!.kind === 'turn') {
      // 单轮：轮起 → 轮末（无轮末则下一轮轮起，与 fs-changes 配对语义一致）。
      const turn = targets[0]!.turn
      fromId = startByTurn.get(turn) ?? null
      if (fromId === null) return { kind: 'error', text: `没有找到轮 ${String(turn)} 的轮起检查点（可能未开启自动检查点，或已超出保留上限）。` }
      const end = checkpoints.find((point) => point.phase === 'end' && point.turn === turn)
      toId = end?.id ?? startByTurn.get(turn + 1) ?? null
      if (toId === null) return { kind: 'error', text: `轮 ${String(turn)} 没有轮末检查点，也没有下一轮轮起可配对；可稍后重试或显式指定两个节点。` }
    } else if (targets.length === 2) {
      fromId = await resolveCheckpoint(targets[0]!)
      toId = await resolveCheckpoint(targets[1]!)
    } else {
      return { kind: 'error', text: COMMAND_DIFF_USAGE }
    }
    if (fromId === null || toId === null) {
      return { kind: 'error', text: '没有找到对应的检查点（可能已超出保留上限或被清理）。' }
    }
    const diff = await engine.diffCheckpoints({ cwd, prevCheckpointId: fromId, currCheckpointId: toId })
    const countBudget = { remaining: COMMAND_MAX_ROWS }
    const rows = await Promise.all(diff.changes.map(async (change) => {
      const [before, after] = await Promise.all([
        change.before === undefined ? Promise.resolve(null) : readChangeSide(engine, cwd, fromId!, change.path),
        change.after === undefined ? Promise.resolve(null) : readChangeSide(engine, cwd, toId!, change.path),
      ])
      const beforeText = before === null ? null : decodeUtf8(before)
      const afterText = after === null ? null : decodeUtf8(after)
      let counts: { added: number; removed: number } | undefined
      if (countBudget.remaining > 0 && (beforeText !== null || afterText !== null)) {
        countBudget.remaining -= 1
        counts = beforeText === null
          ? { added: countLines(afterText ?? ''), removed: 0 }
          : afterText === null
            ? { added: 0, removed: countLines(beforeText) }
            : lineCounts(beforeText, afterText)
      }
      return { path: change.path, kind: change.kind === 'mode-changed' ? 'modified' as const : change.kind, counts }
    }))
    return { kind: 'success', text: formatCommandDiff(`检查点 ${fromId} → ${toId}：${String(rows.length)} 个文件变更`, rows, undefined) }
  } catch (error) {
    return { kind: 'error', text: `对比失败：${errorMessage(error)}` }
  }
}

function formatCommandDiff(header: string, rows: readonly { readonly path: string; readonly kind: string; readonly counts?: { readonly added: number; readonly removed: number }; readonly added?: number; readonly removed?: number }[], notes: readonly string[] | undefined): string {
  const glyph: Record<string, string> = { added: 'A', deleted: 'D', modified: 'M' }
  const shown = rows.slice(0, COMMAND_MAX_ROWS)
  const lines = shown.map((row) => {
    // 两种行形状：快照模式行数在 counts，轨迹模式行数直接在 added/removed。
    const added = row.counts?.added ?? row.added
    const removed = row.counts?.removed ?? row.removed
    const counts = added === undefined && removed === undefined ? '' : `  +${String(added ?? 0)} −${String(removed ?? 0)}`
    return `${glyph[row.kind] ?? 'M'} ${row.path}${counts}`
  })
  if (rows.length > shown.length) lines.push(`…还有 ${String(rows.length - shown.length)} 个文件（完整清单见时间线面板）`)
  if (notes !== undefined && notes.length > 0) lines.push('', ...notes.map((note) => `注：${note}`))
  return [header, '', ...lines].join('\n')
}

async function runShadowUndoCommand(engine: ShadowRewindEngine, invocation: ShadowRewindCommandInvocation): Promise<ShadowRewindCommandResult> {
  const cwd = invocation.agent.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') {
    return { kind: 'error', text: '当前会话没有工作区，无从撤销。' }
  }
  try {
    const result = await engine.undoLastRestore({ cwd, signal: invocation.signal })
    const lines = [`已撤销最近一次恢复：${String(result.undonePaths.length)} 个路径回到恢复前状态（备份点 ${result.rescuePointId} 保留）。`]
    for (const path of result.undonePaths) lines.push(`已还原 ${path}`)
    for (const skip of result.skippedPaths) lines.push(`跳过 ${skip.path}：${skip.reason}`)
    return { kind: 'success', text: lines.join('\n') }
  } catch (error) {
    return { kind: 'error', text: errorMessage(error) }
  }
}