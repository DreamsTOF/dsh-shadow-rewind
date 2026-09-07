import type { LineageEntry } from './store.js';
import type { WorkspaceChange } from './types.js';
import { type RestorePlan, type RestorePointKind, type RestorePointSummary, type RestoreResult, type RestoreUndoProbe, type RestoreUndoResult, type ShadowRewindConfig, type SkippedPath, type TurnIntent, type RestorePlanId } from './types.js';
import { ShadowRewindEngineBase } from './engine-base.js';
export { DEFAULT_EXCLUDES, resolveConfig } from './engine-config.js';
export { isCheckpointSkipCode } from './engine-helpers.js';
/** 引擎实例：一个插件进程共享一个（配置驱动，无隐藏全局状态）。 */
export declare class ShadowRewindEngine extends ShadowRewindEngineBase {
    private readonly plans;
    private readonly applying;
    /** 恢复后单次撤销（B1）：workspace → 最近一次恢复的逐路径 before/after。
     * 进程内记录，重启即失效；每次 applyRestore 替换上一次（无 redo）。
     * 部分撤销时按成功路径收缩，全部撤销完才销毁。 */
    private readonly undoRecords;
    constructor(config?: ShadowRewindConfig);
    /** 创建一个持久化恢复点（user / rescue）。 */
    create(options: {
        readonly cwd: string;
        readonly kind?: Extract<RestorePointKind, 'user' | 'rescue'>;
        readonly sessionId?: string;
        readonly label?: string;
        readonly parentRestorePoint?: string;
        readonly signal?: AbortSignal;
    }): Promise<RestorePointSummary>;
    /** 捕获回合检查点（turn）；重复请求同一回合同一相位时幂等返回已有检查点。
     * phase 'start'（缺省）= 轮第一步之前；'end' = turn/end 事件时的轮末快照。 */
    createTurnCheckpoint(options: {
        readonly cwd: string;
        readonly sessionId: string;
        readonly turn: number;
        readonly turnStartSeq: number;
        readonly phase?: 'start' | 'end';
        /** 轮末检查点的本轮内容型工具调用摘要（仅 phase='end' 合法）。 */
        readonly intent?: readonly TurnIntent[];
        readonly signal?: AbortSignal;
    }): Promise<RestorePointSummary>;
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
    planRestore(options: {
        readonly cwd: string;
        readonly restorePointId: string;
        readonly sessionId?: string;
        readonly expectedCurrentTreeHash?: string;
        /** 对称模式的勾选式子集：计划只覆盖这些路径（必须都是变更清单成员）。 */
        readonly paths?: readonly string[];
        readonly signal?: AbortSignal;
    }): Promise<RestorePlan>;
    /** 查询内存中的恢复计划（不存在返回 undefined；TTL 过期不拒绝——
     * 软警告字段 `expired` 随计划透出，EXPECTED-DESIGN 1.4 #1）。
     * 供 HTTP 层核对「计划与所选检查点同源」。 */
    getRestorePlan(planId: RestorePlanId): (RestorePlan & {
        expired?: boolean;
    }) | undefined;
    /** 执行一个已批准的恢复计划：rescue → 恢复 → 验证（失败自动回滚到状态 A）。
     * EXPECTED-DESIGN 1.4：确认串（#2）与会话绑定拒绝（#3）已废除——后者降级
     * 为结果里的软警告；TTL 过期（#1）不阻断；真正的防漂移闸是 assertPlanFresh。
     * skipUndoRecord：补偿性质的恢复（如 fork 失败的自动回滚）不写 undo 单槽
     * ——它会把「撤销最近一次恢复」的指向覆盖成补偿自己，语义反转。 */
    applyRestore(options: {
        readonly planId: string;
        readonly sessionId?: string;
        readonly signal?: AbortSignal;
        readonly skipUndoRecord?: boolean;
    }): Promise<RestoreResult>;
    /**
     * 撤销最近一次恢复（B1，EXPECTED-DESIGN 1.2 两段式协议）。
     *
     * mode = 'probe'：只做逐路径 CAS 只读比对，返回 {clean, conflicted}——
     * 客户端据此弹三选项对话框（拒绝 / 全部回滚 / 只回滚正常部分），不动磁盘。
     *
     * mode = 'apply'（缺省）执行撤销：
     *  - 逐路径 CAS：当前磁盘条目必须仍等于「恢复后」的状态（内容寻址等价）；
     *    失配路径跳过并如实报告，绝不猜着回退；全部失配 → 409（UNDO_CONFLICT）；
     *  - force = true（用户在弹窗显式授权「全部回滚 / 二次回滚」）：对指定
     *    路径绕过 CAS，直接从 rescue 清单回写——覆盖恢复之后的用户修改；
     *    before=null 的路径（恢复新建的）强制撤销即删除，即使被改过——这是
     *    「绝不删除」的第二处用户授权例外；
     *  - paths：子集撤销（二次回滚按清单来）；成功路径从 undo 记录中收缩，
     *    记录清空才销毁——部分成功永远可重试；
     *  - 撤销动作复用 rescue 清单的 restorePaths（全套安全路径：围栏断言、
     *    原子写、空目录回收、非空拒删、跳过项不删）。
     */
    undoLastRestore(options: {
        readonly cwd: string;
        readonly mode?: 'apply';
        readonly force?: boolean;
        readonly paths?: readonly string[];
        readonly signal?: AbortSignal;
    }): Promise<RestoreUndoResult>;
    undoLastRestore(options: {
        readonly cwd: string;
        readonly mode: 'probe';
        readonly paths?: readonly string[];
        readonly signal?: AbortSignal;
    }): Promise<RestoreUndoProbe>;
    /** 删除一个恢复点（EXPECTED-DESIGN 1.4 #2：确认串废除；被进程内 undo
     * 记录引用的 rescue 点仍拒绝删除——那是「撤销最近一次恢复」的命脉）。 */
    delete(options: {
        readonly cwd: string;
        readonly restorePointId: string;
        readonly signal?: AbortSignal;
    }): Promise<{
        restorePointId: string;
        deletedBlobs?: number;
    }>;
    /**
     * 记录一条写盘前捕获（宿主 tools/execute 瀑布调用）。
     * 内容内联进 BEFORE 日志；超限文件（maxFileBytes）直接放弃——
     * 兜底覆盖不到的字节仍有影子整树快照兜着。
     */
    recordBeforeEntry(options: {
        readonly workspace: string;
        readonly sessionId: string;
        readonly anchorSeq: number;
        readonly callId: string;
        /** 工作区相对路径（'/' 分隔）。 */
        readonly rel: string;
        readonly existed: boolean;
        readonly content: string | null;
        readonly mode: number;
    }): Promise<void>;
    /**
     * user/message 边界重查（抄 dsh-rewind reconcileTracked）：把本会话全部
     * 被跟踪路径与最近已知内容比对，变化者（含外部编辑/删除）补一条以本消息
     * 锚定的 BEFORE 记录。返回补录条数（仅诊断用）。
     */
    reconcileTrackedBefore(options: {
        readonly workspace: string;
        readonly sessionId: string;
        readonly anchorSeq: number;
    }): Promise<number>;
    /**
     * 物化「消息 S 之前」的部分树检查点（BEFORE 日志 → kind 'message' 恢复点）。
     *
     * 这是检查点缺席（关闭/失败/被修剪）时的兜底：每路径取 anchorSeq >= S 的
     * 最早 BEFORE（含边界），existed=true 的进 entries（内容入库 sqlite，
     * id 稳定、重复物化为增量合并）；existed=false（工具创建）进 createdPaths，
     * 计划按「恢复删除」处理。部分树绝不携带 createdPaths 之外的 added 语义
     * ——未捕获路径留在磁盘上不动。
     */
    ensureMessageRestorePoint(options: {
        readonly cwd: string;
        readonly sessionId: string;
        readonly messageSeq: number;
        readonly turn: number;
        readonly turnStartSeq: number;
    }): Promise<RestorePointSummary | undefined>;
    /** 删除被 prune 掉的 anchor 对应的消息检查点（内容 GC 随后回收独占 blob）。 */
    pruneMessageRestorePoints(workspace: string, sessionId: string, anchorSeqs: readonly number[]): Promise<number>;
    /**
     * 记录 fork 谱系：「恢复并从新会话继续」成功后由宿主端点调用，把
     * childId ↔ parentId 写进工作区状态的 lineage.json，时间线据此显示
     * 「v2 · 恢复自 <检查点>」徽标。谱系是展示性增强：工作区无法定位或
     * 落盘失败都静默吞掉（丢徽标，不丢功能），绝不影响恢复主流程。
     */
    recordForkLineage(options: {
        readonly cwd: string;
        readonly parentSessionId: string;
        readonly childSessionId: string;
        readonly restorePointId: string;
    }): Promise<void>;
    /** 读取该工作区的 fork 谱系链（时间线/管理面板用）；工作区无效时为空链。 */
    loadForkLineage(cwd: string): Promise<readonly LineageEntry[]>;
    private isReferencedByUndo;
    private expirePlans;
}
