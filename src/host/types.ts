/**
 * 宿主适配层·共享类型：插件对 dsh 宿主的最小结构类型面 + 会话事件读取。
 *
 * 这里只声明插件实际消费的成员（结构类型，而非 import cordis / dsh 具体包），
 * 宿主多出来的字段一概不关心——版本升级时只需核对这里列出的事实。
 * 依赖方向：本文件是 host/ 子模块的最底层，不得反向 import 其它 host/*。
 */

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
 * 宿主 settings 服务的最小结构面（运行时从 ctx 注入解析，不 import
 * dsh-settings 包——见 types/host-modules.d.ts 的说明）。字段按版本可选：
 * installSection 0.1.2-alpha.2+；register 0.1.1-rc.2 及以前；describe/
 * update/replace 供 config 端点读写用户层文档，缺失时按不可写降级。
 */
export interface SettingsServiceLike {
  installSection?(ctx: unknown, namespace: string, config: unknown, base: unknown, hooks: SettingsSectionHooks): unknown
  register?(namespace: string, config: unknown, options: { base: unknown }): SettingsScopeLike
  describe?(): readonly { ns: string; user?: Record<string, unknown> }[]
  readonly writable?: boolean
  update?(namespace: string, patch: Record<string, unknown>): Promise<void>
  replace?(namespace: string, doc: Record<string, unknown>): Promise<void>
}

/** settings 分区接线钩子（官方 installSettingsSection 同形）。 */
export interface SettingsSectionHooks {
  setSource(fn: () => unknown): void
  onChange(): void
}

/** register 核心 API 的返回面（老版本复刻接线用）。 */
export interface SettingsScopeLike {
  get(): unknown
  watch(fn: () => void): void
}
