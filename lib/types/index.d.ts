/**
 * DSH 插件入口：把引擎、回合协调器与 HTTP 端点装配成 cordis 服务
 * `ctx.shadowRewind`，供其它插件消费。
 */
import { ShadowRewindEngine } from './engine.js';
import type { AgentFace, HostContext } from './rewind-host.js';
import type { RestorePointSummary, ShadowRewindConfig } from './types.js';
import { WorkspaceWriteGate } from './write-gate.js';
export * from './engine.js';
export * from './errors.js';
export * from './rewind-host.js';
export * from './types.js';
export { FileReviewService, transformFile } from './file-review/host.ts';
export type { FileReviewAction, FileReviewChange, FileReviewFileResult, FileReviewRequest, FileReviewResult, ProducedFileDiff, ProducedFileReview, RecordedMutation, RecordedRequest, RecordedResult, } from './file-review/change-types.ts';
/** 最小 cordis 上下文面（结构类型）：避免依赖具体的 cordis 包版本。 */
interface PluginContext {
    readonly logger: HostContext['logger'];
    provide(name: string, value: unknown): void;
    inject<T = unknown>(names: readonly string[], fn: (scope: PluginContext) => void): void;
    on(event: string, listener: (data: never, next: () => Promise<unknown>) => Promise<unknown>, options?: {
        prepend?: boolean;
    }): void;
    effect(dispose: () => void, label?: string): void;
    webServer?: {
        register(route: {
            kind: 'exact';
            path: string;
            handler: (request: unknown, response: unknown) => Promise<void>;
        }): () => void;
    };
    sessions?: {
        get(sessionId: string): AgentFace | undefined;
    };
    sessionQuery?: unknown;
    apiProxy?: unknown;
    agents?: {
        list(): readonly AgentFace[];
    };
}
/**
 * cordis 服务：`new ShadowRewindService(ctx, config)`。
 *  - `agents` 作用域：安装回合第一步的自动快照闸门；
 *  - web 作用域：注册 `/shadow-rewind` 端点；
 *  - 启动：等引擎完成崩溃恢复，把结果写进日志。
 */
export declare class ShadowRewindService {
    readonly engine: ShadowRewindEngine;
    private readonly coordinator;
    /** 写入闸（「以当前为准」）；恒常构造，config.writeGate 只决定初始开关。 */
    readonly writeGate: WorkspaceWriteGate;
    constructor(ctx: PluginContext, config?: ShadowRewindConfig);
    /** 等待启动恢复完成。 */
    initialize(): Promise<number>;
    /** 手动创建恢复点。 */
    create(options: Parameters<ShadowRewindEngine['create']>[0]): Promise<RestorePointSummary>;
    /** 手动触发一个回合检查点（通常由协调器自动完成）。 */
    createTurnCheckpoint(options: Parameters<ShadowRewindEngine['createTurnCheckpoint']>[0]): Promise<RestorePointSummary>;
    /** 查找回合检查点。 */
    findTurnCheckpoint(options: Parameters<ShadowRewindEngine['findTurnCheckpoint']>[0]): ReturnType<ShadowRewindEngine['findTurnCheckpoint']>;
    /** 列出恢复点（可选包含 turn / rescue）。 */
    list(options: Parameters<ShadowRewindEngine['list']>[0]): ReturnType<ShadowRewindEngine['list']>;
    /** 对比恢复点与当前工作区。 */
    inspect(options: Parameters<ShadowRewindEngine['inspect']>[0]): ReturnType<ShadowRewindEngine['inspect']>;
    /** 生成限时恢复计划（确认串必须逐字回显）。 */
    planRestore(options: Parameters<ShadowRewindEngine['planRestore']>[0]): ReturnType<ShadowRewindEngine['planRestore']>;
    /** 执行已批准的恢复计划。 */
    applyRestore(options: Parameters<ShadowRewindEngine['applyRestore']>[0]): ReturnType<ShadowRewindEngine['applyRestore']>;
    /** 删除恢复点（confirmation 必须逐字等于 `DELETE <id>`）。 */
    delete(options: Parameters<ShadowRewindEngine['delete']>[0]): ReturnType<ShadowRewindEngine['delete']>;
    /** 列出中断/需人工介入的恢复操作。 */
    listRecovery(options: Parameters<ShadowRewindEngine['listRecovery']>[0]): ReturnType<ShadowRewindEngine['listRecovery']>;
}
export default ShadowRewindService;
