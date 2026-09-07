/**
 * 核心引擎·基类：存储装配、当前树捕获、检查点内容读取与恢复路径执行。
 *
 * 拆分自原 engine.ts 的「存储/捕获半边」，子类（engine.ts 的
 * ShadowRewindEngine）继承后补齐计划/恢复/undo 生命周期。调用点全部保持
 * `this.xxx` 形态，行为零变化；仅原 private 成员中被子类访问的
 * （captureTree / assertReady）放宽为 protected。
 *
 * 两条铁律贯穿全部路径：
 *  1. 绝不调用工作区自身的任何 VCS——文件枚举只走目录扫描，快照字节只落在
 *     影子 jj 仓库或 SQLite 内容库；
 *  2. 恢复必须「恢复前自动 rescue 备份 + 事后哈希验证」，任何一步不符立即
 *     fail-closed（计划限时 + 确认串回显在子类实现）。
 */
import { WorkspaceStore } from './store.js';
import { BeforeJournal } from './before-journal.js';
import type { Manifest, ResolvedShadowRewindConfig, RestorePointSummary, ShadowRewindConfig, SkippedPath, SnapshotEntry, WorkspaceChange } from './types.js';
/** 一次当前树捕获的完整产物。 */
export interface CapturedTree {
    readonly root: string;
    readonly entries: Record<string, SnapshotEntry>;
    readonly skipped: readonly SkippedPath[];
    readonly treeHash: string;
    readonly fileCount: number;
    readonly totalBytes: number;
    /** full 模式下的产出：影子仓库 commit id。 */
    readonly commitId?: string;
}
/** 引擎存储/捕获半边的基类（一个插件进程共享一个，配置驱动，无隐藏全局状态）。 */
export declare class ShadowRewindEngineBase {
    readonly config: ResolvedShadowRewindConfig;
    readonly store: WorkspaceStore;
    /** 启动装配完成后的信号。 */
    readonly ready: Promise<void>;
    /**
     * 实际生效的内容后端：配置为 jj 但宿主机缺 CLI 时自动降级为内置
     * SQLite 内容库（自动检查点不断档）；显式配置 sqlite/off 不受影响。
     */
    readonly effectiveBackend: 'jj' | 'sqlite';
    /** 降级原因（未降级时为 undefined）。 */
    readonly downgradeReason?: string;
    private excludes;
    private readonly shadowRepos;
    /** BEFORE 捕获日志（主路捕获的存储半边；消息检查点的物化数据源）。 */
    protected readonly beforeJournal: BeforeJournal;
    constructor(config?: ShadowRewindConfig);
    /**
     * 运行时热更新配置（设置卡片 watch 链路，ABSORB-RECALL 1.2）：重新走
     * resolveConfig 落定（env 覆盖语义在热更路径同样成立），并按需重建排除
     * 编译缓存。storageDir / turnCheckpointMode 是启动级字段（存储根与后端
     * 装配在构造时定死），热更路径强制保留原值——schema 层已拒绝，这里是
     * 最后防线。
     */
    applyConfigPatch(patch: Record<string, unknown>): void;
    /** GC 双闸阈值：累计删除的 manifest 数达到该值即触发（与时间闸先到先触发）。 */
    private static readonly GC_PENDING_THRESHOLD;
    /** GC 双闸时间闸：距上次 GC 超过该间隔即触发。 */
    private static readonly GC_MIN_INTERVAL_MS;
    /** workspace → 双闸状态：累计删除 manifest 数与本次进程内上次 GC 时刻。 */
    private readonly gcPending;
    private readonly gcLastRun;
    /**
     * 删除后的 GC 统一入口（ABSORB-RECALL 六：双闸节流）。原实现挂在
     * create/delete/修剪后每次都跑——30 配额下修剪必触发，纯属浪费。改为
     * 「累计删除 ≥50 个 manifest」或「距上次 GC ≥24h」（gc.stamp 跨重启
     * 续存）先到先触发；孤儿 blob 至多滞留一个窗口期，换来修剪路径的零开销。
     * stamp 缺省 0 视为「很久以前」——每个工作区的首次删除照旧立即回收。
     */
    protected garbageCollectAfterDeletion(workspace: string, deletedManifests: number): Promise<{
        ran: boolean;
        deletedBlobs: number;
    }>;
    /** 立即回收指定工作区的孤儿内容（管理面板「立即 GC」；绕过双闸节流）。 */
    collectGarbageFor(cwd: string, signal?: AbortSignal): Promise<{
        deletedBlobs: number;
        retainedBlobs: number;
    }>;
    /** 自动检查点是否被配置关闭（与降级区分）。 */
    get turnCheckpointsDisabled(): boolean;
    /** 等启动恢复完成；带 signal 时与之竞争（中止即拒绝）。 */
    protected assertReady(signal?: AbortSignal): Promise<void>;
    private shadowRepo;
    /**
     * 扫描 + 捕获当前树（共用 stat 缓存增量，sqlite 与 jj 后端同路径）。
     *  - mode = 'inspect'：只构建 entries（供对比/计划）；缓存只读不写回，
     *    避免把对比时刻的 stat 事实污染成下一次持久捕获的增量依据；
     *  - mode = 'persist'：新读内容写入内容后端（sqlite 批量入库 / jj 镜像提交），
     *    并写回缓存，返回 commitId。
     */
    protected captureTree(workspace: string, options: {
        readonly mode: 'inspect' | 'persist';
        readonly message?: string;
        readonly signal?: AbortSignal;
    }): Promise<CapturedTree>;
    /**
     * jj 持久化：仓库丢失（JJ_REPO_LOST）时删残骸 + 清缓存 + 重试一次。
     * 关键不变量：仓库丢失时 verifyContent 必然拒绝所有命中项（镜像文件已
     * 随仓库消失），因此首轮捕获已是全量重读——newContent 完整，重试无需
     * 重新扫描读取，直接用首轮内容重建仓库即可。
     */
    private persistJj;
    /** 读取一个检查点的完整条目投影（B1：轨迹重放用它补重放基线）。 */
    getCheckpointEntries(options: {
        readonly cwd: string;
        readonly restorePointId: string;
        readonly signal?: AbortSignal;
    }): Promise<Readonly<Record<string, SnapshotEntry>>>;
    /** 查找一个回合的轮起检查点（可选校验 turnStartSeq；轮末相位不参与恢复点查找）。 */
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
    /** 列出某会话的所有 turn 检查点（轮起+轮末，按 turn 升序；摘要带 phase）。 */
    listTurnCheckpoints(options: {
        readonly cwd: string;
        readonly sessionId: string;
    }): Promise<readonly RestorePointSummary[]>;
    /**
     * 对比两个检查点的 entries，生成文件系统级别的变更列表。
     * 用于捕获 PowerShell 等终端命令创建/修改/删除的文件（这些没有工具结果节点）。
     * 返回的 changes 结构与 diffTrees 一致，但来源是快照间对比而非当前树。
     */
    diffCheckpoints(options: {
        readonly cwd: string;
        readonly prevCheckpointId: string;
        readonly currCheckpointId: string;
    }): Promise<{
        readonly changes: readonly WorkspaceChange[];
        readonly skippedPaths: readonly SkippedPath[];
    }>;
    /**
     * 从指定检查点读取文件内容。用于为文件系统变更生成完整 diff。
     * 返回 null 表示文件在该检查点不存在（新增或删除）。
     */
    getFileContentFromCheckpoint(options: {
        readonly cwd: string;
        readonly checkpointId: string;
        readonly path: string;
    }): Promise<Buffer | null>;
    /**
     * 降级标注（degraded）：检查点的快照内容是否仍可读。抽样「最小的文件条目」
     * 走真实读取路径探测两个后端（jj 影子仓库 / sqlite blob）；清单不存在或
     * 抽样读取失败 = 不可读。只读探测，绝不写任何数据。
     * 借鉴 dsh-checkpoint-diff 的 degraded 标注思路：丢失节点诚实标注，
     * 而不是等到恢复/读取时才响亮报错。
     */
    checkpointContentReadable(options: {
        readonly cwd: string;
        readonly restorePointId: string;
    }): Promise<boolean>;
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
    /** 从 manifest 的后端读取一个路径的快照字节。 */
    private readSnapshotContent;
    /** 把一组路径恢复成 manifest 记录的状态（先删后写；目录按需重建/回收）。 */
    protected restorePaths(workspace: string, manifest: Manifest, paths: readonly string[], signal?: AbortSignal): Promise<void>;
    /** 恢复后验证：每个路径重新落盘读取并与快照条目全等。 */
    protected verifyRestored(workspace: string, manifest: Manifest, paths: readonly string[], signal?: AbortSignal): Promise<void>;
}
