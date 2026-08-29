import { WorkspaceStore } from './store.js';
import { type ResolvedShadowRewindConfig, type RestorePlan, type RestorePointKind, type RestorePointSummary, type RestoreResult, type ShadowRewindConfig, type SkippedPath, type SnapshotEntry, type WorkspaceChange } from './types.js';
/** 默认排除清单：VCS 目录、依赖、构建产物与常见缓存（自用取向：宁多勿漏）。 */
export declare const DEFAULT_EXCLUDES: readonly string[];
/** 解析配置：全部字段落定；非法值直接抛错（宁可拒绝启动也不带病运行）。 */
export declare function resolveConfig(config: ShadowRewindConfig): ResolvedShadowRewindConfig;
/** 引擎实例：一个插件进程共享一个（配置驱动，无隐藏全局状态）。 */
export declare class ShadowRewindEngine {
    readonly config: ResolvedShadowRewindConfig;
    readonly store: WorkspaceStore;
    /** 启动恢复完成后的信号（恢复条数）。 */
    readonly ready: Promise<number>;
    /**
     * 实际生效的内容后端：配置为 jj 但宿主机缺 CLI 时自动降级为 blob
     * （自动检查点不断档）；显式配置 legacy/off 不受影响。
     */
    readonly effectiveBackend: 'jj' | 'blob';
    /** 降级原因（未降级时为 undefined）。 */
    readonly downgradeReason?: string;
    private readonly excludes;
    private readonly plans;
    private readonly applying;
    private readonly shadowRepos;
    constructor(config?: ShadowRewindConfig);
    /** 自动检查点是否被配置关闭（与降级区分）。 */
    get turnCheckpointsDisabled(): boolean;
    private assertReady;
    private shadowRepo;
    /**
     * 扫描 + 捕获当前树（共用 stat 缓存增量，blob 与 jj 后端同路径）。
     *  - mode = 'inspect'：只构建 entries（供对比/计划）；缓存只读不写回，
     *    避免把对比时刻的 stat 事实污染成下一次持久捕获的增量依据；
     *  - mode = 'persist'：新读内容写入内容后端（blob putBlob / jj 镜像提交），
     *    并写回缓存，返回 commitId。
     */
    private captureTree;
    /**
     * jj 持久化：仓库丢失（JJ_REPO_LOST）时删残骸 + 清缓存 + 重试一次。
     * 关键不变量：仓库丢失时 verifyContent 必然拒绝所有命中项（镜像文件已
     * 随仓库消失），因此首轮捕获已是全量重读——newContent 完整，重试无需
     * 重新扫描读取，直接用首轮内容重建仓库即可。
     */
    private persistJj;
    /** 创建一个持久化恢复点（user / rescue）。 */
    create(options: {
        readonly cwd: string;
        readonly kind?: Extract<RestorePointKind, 'user' | 'rescue'>;
        readonly sessionId?: string;
        readonly label?: string;
        readonly parentRestorePoint?: string;
        readonly signal?: AbortSignal;
    }): Promise<RestorePointSummary>;
    /** 捕获回合检查点（turn）；重复请求同一回合时幂等返回已有检查点。 */
    createTurnCheckpoint(options: {
        readonly cwd: string;
        readonly sessionId: string;
        readonly turn: number;
        readonly turnStartSeq: number;
        readonly signal?: AbortSignal;
    }): Promise<RestorePointSummary>;
    /** 查找一个回合的检查点（可选校验 turnStartSeq）。 */
    findTurnCheckpoint(options: {
        readonly cwd: string;
        readonly sessionId: string;
        readonly turn: number;
        readonly turnStartSeq?: number;
    }): Promise<RestorePointSummary | undefined>;
    /** 持久化一次检查点跳过（UI 重启后仍可见）。 */
    recordTurnCheckpointSkip(options: {
        readonly cwd: string;
        readonly sessionId: string;
        readonly turn: number;
        readonly turnStartSeq: number;
        readonly reason: string;
    }): Promise<void>;
    /** 读取持久化的检查点跳过记录。 */
    findTurnCheckpointSkip(options: {
        readonly cwd: string;
        readonly sessionId: string;
        readonly turn: number;
        readonly turnStartSeq: number;
    }): Promise<{
        reason: string;
    } | undefined>;
    /** 实际创建 manifest 的内部路径：调用方必须已持有工作区锁。 */
    private createLocked;
    /** 列出恢复点（默认不含 turn 与 rescue；调用方按需打开）。 */
    list(options: {
        readonly cwd: string;
        readonly includeTurnCheckpoints?: boolean;
        readonly includeRescue?: boolean;
    }): Promise<readonly RestorePointSummary[]>;
    /** 对比一个恢复点与当前工作区（跳过项以明细透出，不混入 changes）。 */
    inspect(options: {
        readonly cwd: string;
        readonly restorePointId: string;
        readonly signal?: AbortSignal;
    }): Promise<{
        restorePoint: RestorePointSummary;
        currentTreeHash: string;
        changes: readonly WorkspaceChange[];
        skippedPaths: readonly SkippedPath[];
    }>;
    /** 生成限时恢复计划（确认串必须逐字回显）。 */
    /**
     * 对称模式路径归因的数据源：晚于目标恢复点的全部快照（其它会话的 turn
     * 检查点、rescue 点等），按时间升序，entries 投影到给定路径集。检查点在
     * 回合开始时捕获，因此窗口 [S_j, S_{j+1}) 的写者就是 S_j 的会话。
     * 上限 64 个：归因只是预览里的建议标签（勾选权在用户），更早的时间线
     * 不再细分。
     */
    listSnapshotsAfter(options: {
        readonly cwd: string;
        readonly restorePointId: string;
        readonly paths: readonly string[];
        readonly signal?: AbortSignal;
    }): Promise<{
        readonly targetSessionId: string | undefined;
        readonly snapshots: readonly {
            readonly id: string;
            readonly sessionId?: string;
            readonly createdAt: number;
            readonly entries: Readonly<Record<string, SnapshotEntry | null>>;
        }[];
    }>;
    planRestore(options: {
        readonly cwd: string;
        readonly restorePointId: string;
        readonly sessionId?: string;
        readonly expectedCurrentTreeHash?: string;
        /** 对称模式的勾选式子集：计划只覆盖这些路径（必须都是变更清单成员）。 */
        readonly paths?: readonly string[];
        readonly signal?: AbortSignal;
    }): Promise<RestorePlan>;
    /** 执行一个已批准的恢复计划：rescue → 日志 → 恢复 → 验证（失败自动回滚）。 */
    applyRestore(options: {
        readonly planId: string;
        readonly confirmation: string;
        readonly sessionId?: string;
        readonly signal?: AbortSignal;
    }): Promise<RestoreResult>;
    /** 删除一个恢复点（确认串必须逐字等于 `DELETE <id>`）。 */
    delete(options: {
        readonly cwd: string;
        readonly restorePointId: string;
        readonly confirmation: string;
        readonly signal?: AbortSignal;
    }): Promise<{
        restorePointId: string;
        deletedBlobs?: number;
    }>;
    /** 列出中断/需要人工介入的恢复操作。 */
    listRecovery(options: {
        readonly cwd: string;
    }): Promise<readonly {
        operationId: string;
        restorePointId: string;
        rescuePointId: string;
        state: 'interrupted' | 'recovery-required';
        paths: readonly string[];
        startedAt: number;
        error?: string;
        rollbackError?: string;
    }[]>;
    /** 从 manifest 的后端读取一个路径的快照字节。 */
    private readSnapshotContent;
    /** 把一组路径恢复成 manifest 记录的状态（先删后写；目录按需重建/回收）。 */
    private restorePaths;
    /** 恢复后验证：每个路径重新落盘读取并与快照条目全等。 */
    private verifyRestored;
    private isReferencedByRecovery;
    private expirePlans;
}
/** 自动检查点的失败中，哪些属于「可预期跳过」而非故障。 */
export declare function isCheckpointSkipCode(code: string): boolean;
//# sourceMappingURL=engine.d.ts.map