/**
 * DSH 插件入口：把引擎、回合协调器与 HTTP 端点装配成 cordis 服务
 * `ctx.shadowRewind`，供其它插件消费。
 */
import { ShadowRewindEngine } from './engine.js'
import { installBeforeCapture } from './host/before-capture.ts'
import { installFileReviewHost } from './file-review/host.ts'
import { installSettingsNamespace, type SettingsBridge } from './rewind-host.js'
import { installShadowRewindCommands, installShadowRewindHttp, TurnCheckpointCoordinator } from './rewind-host.js'
import type { AgentFace, HostContext } from './rewind-host.js'
import type { RestorePointSummary, ShadowRewindConfig } from './types.js'

export * from './char-highlight.js'
export * from './engine.js'
export * from './errors.js'
export * from './rewind-host.js'
export * from './types.js'
// 文件审查半边（dsh-file-review-tab 融合）。FileReviewService 必须从主入口
// 可达：Typert 贡献按 exportName 从宿主包主入口解析服务。
export { FileReviewService, transformFile } from './file-review/host.ts'
export type {
  FileReviewAction, FileReviewChange, FileReviewFileResult, FileReviewRequest,
  FileReviewResult, ProducedFileDiff, ProducedFileReview, RecordedMutation,
  RecordedRequest, RecordedResult,
} from './file-review/change-types.ts'

/** 最小 cordis 上下文面（结构类型）：避免依赖具体的 cordis 包版本。 */
interface PluginContext {
  readonly logger: HostContext['logger']
  provide(name: string, value: unknown): void
  inject<T = unknown>(names: readonly string[], fn: (scope: PluginContext) => void): void
  on(event: string, listener: (data: never, next: () => Promise<unknown>) => Promise<unknown>, options?: { prepend?: boolean }): void
  effect(dispose: () => void, label?: string): void
  webServer?: {
    register(route: { kind: 'exact'; path: string; handler: (request: unknown, response: unknown) => Promise<void> }): () => void
  }
  sessions?: { get(sessionId: string): unknown }
  sessionQuery?: unknown
  /** dsh 0.1.2 起会话网关（替代被移除的 apiProxy）。 */
  sessionController?: import('./rewind-host.js').SessionControllerLike
  agents?: { get?(sessionId: string): AgentFace | undefined; list(): readonly AgentFace[] }
}

/**
 * cordis 服务：`new ShadowRewindService(ctx, config)`。
 *  - `agents` 作用域：安装回合第一步的自动快照闸门；
 *  - web 作用域：注册 `/shadow-rewind` 端点；
 *  - 启动：等引擎完成崩溃恢复，把结果写进日志。
 */
export class ShadowRewindService {
  readonly engine: ShadowRewindEngine
  private readonly coordinator: TurnCheckpointCoordinator
  /** 设置卡片桥：异步装配（schemasty/settings 服务经宿主解析），到位前为
   * undefined——HTTP handler 闭包运行时读取，桥缺席时 config 端点按只读
   * 降级（ABSORB-RECALL 1.2）。 */
  private settingsBridge?: SettingsBridge

  constructor(ctx: PluginContext, config: ShadowRewindConfig = {}) {
    ctx.provide('shadowRewind', this)
    this.engine = new ShadowRewindEngine(config)
    this.coordinator = new TurnCheckpointCoordinator(this.engine)

    // BEFORE 捕获管道（主路捕获，Claude Code 式）：tools/execute 写盘前抓
    // 目标文件全文，锚定 user message seq；user/message 边界重查外部编辑。
    // 影子整树快照保留为兜底——检查点在位时恢复仍走全树检查点。
    installBeforeCapture(ctx, this.engine)

    // 文件审查半边（dsh-file-review-tab 融合）：Typert `fileReview` 服务 +
    // 最终回复文件引用引导 + Code Mode 录制器；录制记录持久化到本插件存储。
    installFileReviewHost(
      ctx as unknown as Parameters<typeof installFileReviewHost>[0],
      { storageDir: this.engine.config.storageDir },
    )

    // 设置页「插件配置」分区（ABSORB-RECALL 1.2/1.4）：注册 settings
    // namespace「shadow-rewind」并把用户覆盖经 watch 热更新进引擎。
    // schemasty/settings 缺席时降级：卡片缺席、config 端点只读。
    void installSettingsNamespace(
      ctx as unknown as Parameters<typeof installSettingsNamespace>[0],
      this.engine,
      (message) => ctx.logger.warn(`[shadow-rewind] ${message}`),
    ).then((bridge) => { this.settingsBridge = bridge })

    ctx.inject(['agents'], (scope) => {
      this.coordinator.install(scope as unknown as HostContext)
    })
    ctx.inject(['webServer', 'sessions', 'sessionQuery', 'sessionController', 'agents'], (scope) => {
      const s = scope as unknown as Parameters<typeof installShadowRewindHttp>[0]
      // bridge 传解析函数：settings 桥异步装配，端点 handler 每请求时读取。
      installShadowRewindHttp(s, this.engine, this.coordinator, () => this.settingsBridge)
    })
    // headless 命令面（/shadow-diff、/shadow-undo）：commands 服务缺失的宿主
    // 上该 inject 挂起即可，不影响其余装配（与 webServer 同一降级模型）。
    ctx.inject(['commands'], (scope) => {
      installShadowRewindCommands(scope as unknown as Parameters<typeof installShadowRewindCommands>[0], this.engine)
    })

    void this.engine.ready.then(() => {
      ctx.logger.info(`[shadow-rewind] 就绪；存储=${this.engine.config.storageDir} 后端=${this.engine.effectiveBackend}`)
    }).catch((error: unknown) => {
      ctx.logger.error(`[shadow-rewind] 启动失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** 等待启动装配完成。 */
  initialize(): Promise<void> {
    return this.engine.ready
  }

  /** 手动创建恢复点。 */
  create(options: Parameters<ShadowRewindEngine['create']>[0]): Promise<RestorePointSummary> {
    return this.engine.create(options)
  }

  /** 手动触发一个回合检查点（通常由协调器自动完成）。 */
  createTurnCheckpoint(options: Parameters<ShadowRewindEngine['createTurnCheckpoint']>[0]): Promise<RestorePointSummary> {
    return this.engine.createTurnCheckpoint(options)
  }

  /** 查找回合检查点。 */
  findTurnCheckpoint(options: Parameters<ShadowRewindEngine['findTurnCheckpoint']>[0]): ReturnType<ShadowRewindEngine['findTurnCheckpoint']> {
    return this.engine.findTurnCheckpoint(options)
  }

  /** 列出恢复点（可选包含 turn / rescue）。 */
  list(options: Parameters<ShadowRewindEngine['list']>[0]): ReturnType<ShadowRewindEngine['list']> {
    return this.engine.list(options)
  }

  /** 对比恢复点与当前工作区。 */
  inspect(options: Parameters<ShadowRewindEngine['inspect']>[0]): ReturnType<ShadowRewindEngine['inspect']> {
    return this.engine.inspect(options)
  }

  /** 生成限时恢复计划（确认串必须逐字回显）。 */
  planRestore(options: Parameters<ShadowRewindEngine['planRestore']>[0]): ReturnType<ShadowRewindEngine['planRestore']> {
    return this.engine.planRestore(options)
  }

  /** 执行已批准的恢复计划。 */
  applyRestore(options: Parameters<ShadowRewindEngine['applyRestore']>[0]): ReturnType<ShadowRewindEngine['applyRestore']> {
    return this.engine.applyRestore(options)
  }

  /** 撤销该工作区最近一次恢复（进程内单次 undo，重启失效）。 */
  undoLastRestore(options: Parameters<ShadowRewindEngine['undoLastRestore']>[0]): ReturnType<ShadowRewindEngine['undoLastRestore']> {
    return this.engine.undoLastRestore(options)
  }

  /** 删除恢复点（被进程内 undo 记录引用的 rescue 点拒绝删除）。 */
  delete(options: Parameters<ShadowRewindEngine['delete']>[0]): ReturnType<ShadowRewindEngine['delete']> {
    return this.engine.delete(options)
  }
}

export default ShadowRewindService