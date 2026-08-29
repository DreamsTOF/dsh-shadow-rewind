/**
 * DSH 插件入口：把引擎、回合协调器与 HTTP 端点装配成 cordis 服务
 * `ctx.shadowRewind`，供其它插件消费。
 */
import { ShadowRewindEngine } from './engine.js'
import { installFileReviewHost } from './file-review/host.ts'
import { installShadowRewindHttp, TurnCheckpointCoordinator } from './rewind-host.js'
import type { AgentFace, HostContext } from './rewind-host.js'
import type { RestorePointSummary, ShadowRewindConfig } from './types.js'
import { installWriteGateHost, WorkspaceWriteGate } from './write-gate.js'
import type { WriteGateDeps } from './write-gate.js'
import { canonicalDirectory } from './path-utils.js'

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
  sessions?: { get(sessionId: string): AgentFace | undefined }
  sessionQuery?: unknown
  apiProxy?: unknown
  agents?: { list(): readonly AgentFace[] }
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
  /** 写入闸（「以当前为准」）；恒常构造，config.writeGate 只决定初始开关。 */
  readonly writeGate: WorkspaceWriteGate

  constructor(ctx: PluginContext, config: ShadowRewindConfig = {}) {
    ctx.provide('shadowRewind', this)
    this.engine = new ShadowRewindEngine(config)
    this.coordinator = new TurnCheckpointCoordinator(this.engine)

    // 写入闸：恒常构造——所有权登记永远进行（即使拒绝裁决关闭），保证
    // 运行时中途开启闸时立刻有据可依。依赖（sessions/agents）在构造时可能
    // 尚未就绪，用惰性 getter 延迟解析——闸在每次裁决时才读取当时的存活面。
    {
      const lazy = ctx as unknown as {
        sessions?: WriteGateDeps['sessions']
        agents?: WriteGateDeps['agents']
      }
      const deps: WriteGateDeps = {
        canonicalDirectory: (path) => canonicalDirectory(path).catch(() => undefined),
        get sessions() { return lazy.sessions },
        get agents() { return lazy.agents },
        logger: ctx.logger,
      }
      this.writeGate = new WorkspaceWriteGate(deps, {
        enabled: config.writeGate ?? true,
        allow: config.writeGateAllow,
      })
    }

    // 文件审查半边（dsh-file-review-tab 融合）：Typert `fileReview` 服务 +
    // 最终回复文件引用引导 + Code Mode 录制器；录制记录持久化到本插件存储。
    installFileReviewHost(
      ctx as unknown as Parameters<typeof installFileReviewHost>[0],
      { storageDir: this.engine.config.storageDir },
    )

    // 写入闸的拒绝裁决挂在工具瀑布上（关闭时裁决直接放行，监听器常驻）。
    installWriteGateHost(ctx as unknown as Parameters<typeof installWriteGateHost>[0], this.writeGate)

    ctx.inject(['agents'], (scope) => {
      this.coordinator.install(scope as unknown as HostContext)
      // 所有权登记与快照共用 agent/pre-step 瀑布（step 1 抢占）。
      this.writeGate?.install(scope as unknown as HostContext)
    })
    ctx.inject(['webServer', 'sessions', 'sessionQuery', 'apiProxy', 'agents'], (scope) => {
      const s = scope as unknown as Parameters<typeof installShadowRewindHttp>[0]
      installShadowRewindHttp(s, this.engine, this.coordinator, this.writeGate)
    })

    void this.engine.ready.then((reconciled) => {
      if (reconciled > 0) {
        ctx.logger.warn(`[shadow-rewind] 启动恢复完成：处理了 ${String(reconciled)} 个中断的恢复操作`)
      } else {
        ctx.logger.info(`[shadow-rewind] 就绪；存储=${this.engine.config.storageDir} 后端=${this.engine.effectiveBackend}`)
      }
    }).catch((error: unknown) => {
      ctx.logger.error(`[shadow-rewind] 启动失败：${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /** 等待启动恢复完成。 */
  initialize(): Promise<number> {
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

  /** 删除恢复点（confirmation 必须逐字等于 `DELETE <id>`）。 */
  delete(options: Parameters<ShadowRewindEngine['delete']>[0]): ReturnType<ShadowRewindEngine['delete']> {
    return this.engine.delete(options)
  }

  /** 列出中断/需人工介入的恢复操作。 */
  listRecovery(options: Parameters<ShadowRewindEngine['listRecovery']>[0]): ReturnType<ShadowRewindEngine['listRecovery']> {
    return this.engine.listRecovery(options)
  }
}

export default ShadowRewindService