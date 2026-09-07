/** 影子回退（shadow-rewind）的共享类型：持久化格式、插件配置与对外结果。 */
/** 持久化格式版本。读取方拒绝一切其它版本（fail-closed，不做最佳努力兼容）。
 * TODO: 版本演进策略——本插件自产自销该格式，bump 前必须先发布能读旧版本的
 * 消费方。届时借鉴 dsh-checkpoint-diff 的「容错超集」方案：新 schema 把旧版
 * 字段全部收为可选（严格性归生产者），open 按 version-mismatch 双版本回退，
 * 而不是整介质作废。当前全部新增字段（intent 等）都以可选字段无痛演进，
 * 不需要 bump。 */
export declare const FORMAT_VERSION: 1;
/** 恢复点 id（形如 rp_<time>_<rand12>）。 */
export type RestorePointId = string;
/** 内存中的限时恢复计划 id（形如 plan_<time>_<rand12>）。 */
export type RestorePlanId = string;
/** 单个普通文件的快照条目。`blob` 是文件内容的 SHA-256。 */
export interface FileEntry {
    readonly kind: 'file';
    readonly blob: string;
    readonly size: number;
    /** 完整权限位（含可执行位），恢复时原样写回。 */
    readonly mode: number;
    /** 当前内容的写入时间（十进制纳秒字符串，同缓存指纹形态；number 会丢精度）。
     * 写盘归因的「何时」信息源。旧清单无此字段，故可选；不参与树哈希与条目
     * 等价判定（树哈希内容寻址，恢复写回不保留时间戳）。 */
    readonly mtimeNs?: string;
}
/** 单个符号链接的快照条目。target 原样保留，mode 是链接自身的权限位。 */
export interface SymlinkEntry {
    readonly kind: 'symlink';
    readonly target: string;
    readonly mode: number;
}
/** 单个空目录的快照条目（子树里没有任何入选文件/链接的目录）。
 * 非空目录不入快照——它们由子条目在恢复时按需重建。 */
export interface DirEntry {
    readonly kind: 'dir';
    readonly mode: number;
}
/** 快照条目：文件、符号链接或空目录。 */
export type SnapshotEntry = FileEntry | SymlinkEntry | DirEntry;
/** 一个可见路径未能进入快照的原因。 */
export type SkipReason = 
/** 超过单文件字节上限（maxFileBytes）。 */
'too-large'
/** 既不是普通文件也不是符号链接（套接字/设备/FIFO 等）。 */
 | 'unsupported-type'
/** 稳定读取重试后仍失败（内容阶段记录）。 */
 | 'read-failed';
/** 一个入选路径被显式跳过的记录——预览与恢复结果必须如实展示，绝不静默丢弃。 */
export interface SkippedPath {
    readonly path: string;
    readonly reason: SkipReason;
}
/** 快照字节由哪个后端持有。 */
export type ContentBackend = 
/** 隐藏影子 jj 仓库（默认）。 */
'jj'
/** 内置 SQLite 内容库（node:sqlite；jj 缺失时的自动降级目标）。 */
 | 'sqlite';
/** 恢复点的用途。 */
export type RestorePointKind = 
/** 用户手动创建。 */
'user'
/** 恢复前自动创建的安全备份。 */
 | 'rescue'
/** 回合检查点（轮起/轮末自动捕获）。 */
 | 'turn'
/** 消息检查点（写盘前 BEFORE 捕获的兜底恢复点，partial 部分树）。 */
 | 'message';
/** 一条意图记录：本轮内触发文件变更的内容型工具调用摘要（轮末检查点专用）。
 * 回答「这一轮是谁改的」——工具名 + 目标路径 + 对应 tool/call 事件 seq。
 * 借鉴 dsh-checkpoint-diff 的意图标签（labels）思路。 */
export interface TurnIntent {
    readonly tool: string;
    readonly path: string;
    readonly seq: number;
}
/** 持久化恢复点清单（磁盘 JSON 的内存形态，读取时全量校验）。 */
export interface Manifest {
    readonly version: typeof FORMAT_VERSION;
    readonly id: RestorePointId;
    readonly kind: RestorePointKind;
    /** 规范化的工作区绝对路径——普通目录，与 VCS 完全无关。 */
    readonly workspace: string;
    /** 本快照的字节由哪个后端持有。 */
    readonly storage: ContentBackend;
    /** storage === 'jj' 时的影子仓库 commit id（40 位 git sha）。 */
    readonly commitId?: string;
    readonly sessionId?: string;
    readonly label?: string;
    /** rescue 点指向触发它的恢复点。 */
    readonly parentRestorePoint?: RestorePointId;
    /** 该检查点所属的 DSH 回合号（turn 专用）。 */
    readonly turn?: number;
    /** 回合开始事件的 seq；快照在该回合第一步之前捕获（turn 专用）。 */
    readonly turnStartSeq?: number;
    /** 轮内相位（turn 专用）：'start' = 轮起捕获（缺省/旧数据），'end' = 轮末
     * （turn/end 事件）捕获——轮末快照冻结轮末树状态，归属不再依赖下一轮轮起。 */
    readonly phase?: 'start' | 'end';
    /** 本轮的内容型工具调用摘要（turn + 轮末专用；轮起检查点不携带）。 */
    readonly intent?: readonly TurnIntent[];
    /** 旧式回合边界 seq（保留字段，当前不写入）。 */
    readonly turnEndSeq?: number;
    /** 消息检查点（kind 'message'）锚定的 user message seq。 */
    readonly messageSeq?: number;
    /** 部分树标记：entries 只覆盖 BEFORE 捕获到的路径，磁盘上其余路径
     * 一律「不在恢复范围」——计划绝不把它们当 added 删除。 */
    readonly partial?: true;
    /** partial 树里记录了「捕获时不存在」的路径（BEFORE=null 的创建）：
     * 计划把它们当成恢复删除的对象。 */
    readonly createdPaths?: readonly string[];
    readonly createdAt: number;
    /** 全部条目按 path 排序后的确定性哈希；读取时重算校验。 */
    readonly treeHash: string;
    readonly fileCount: number;
    readonly totalBytes: number;
    readonly entries: Readonly<Record<string, SnapshotEntry>>;
    /** 可见但未入快照的路径。 */
    readonly skippedPaths: readonly SkippedPath[];
    readonly restoreCount: number;
    readonly lastRestoredAt?: number;
}
/** 一个路径在「快照 vs 当前」之间的差异。 */
export interface WorkspaceChange {
    readonly path: string;
    readonly kind: 'added' | 'deleted' | 'modified' | 'mode-changed' | 'type-changed';
    readonly before?: SnapshotEntry;
    readonly after?: SnapshotEntry;
}
/** inspect 的结果：恢复点与当前工作区的对比。 */
export interface Inspection {
    readonly restorePoint: RestorePointSummary;
    readonly currentTreeHash: string;
    readonly changes: readonly WorkspaceChange[];
}
/** 恢复点的紧凑摘要（列表与预览用）。 */
export interface RestorePointSummary {
    readonly format: typeof FORMAT_VERSION;
    readonly id: RestorePointId;
    readonly kind: RestorePointKind;
    readonly workspace: string;
    readonly storage: ContentBackend;
    readonly sessionId?: string;
    readonly label?: string;
    readonly turn?: number;
    readonly turnStartSeq?: number;
    readonly phase?: 'start' | 'end';
    /** 消息检查点锚定的 user message seq（kind 'message' 专用）。 */
    readonly messageSeq?: number;
    /** 本轮的内容型工具调用摘要（轮末检查点才有；旧数据/轮起缺省）。 */
    readonly intent?: readonly TurnIntent[];
    readonly createdAt: number;
    readonly treeHash: string;
    readonly fileCount: number;
    readonly totalBytes: number;
    readonly skippedPathCount: number;
    readonly restoreCount: number;
    readonly lastRestoredAt?: number;
}
/** 限时恢复计划：执行前由 applyGuarded 核对计划与检查点同源。
 * TTL 仍计算但只作软警告（EXPECTED-DESIGN 1.4 #1）：过期不阻断执行，
 * 真正的防漂移闸是 apply 时的逐路径计划复核（assertPlanFresh）。 */
export interface RestorePlan {
    readonly id: RestorePlanId;
    readonly restorePointId: RestorePointId;
    readonly workspace: string;
    readonly sessionId?: string;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly changes: readonly WorkspaceChange[];
    /** 快照中显式跳过的路径（恢复不会碰它们，仅随计划透出展示）。 */
    readonly skippedPaths: readonly SkippedPath[];
    /** 每个待恢复路径在「计划生成时」的当前条目；apply 时逐路径复核防覆盖新修改。 */
    readonly expected: Readonly<Record<string, SnapshotEntry | null>>;
}
/** 恢复计划是否已超过 TTL（软警告：客户端据此提示，服务端不拒绝）。 */
export type PlanFreshness = {
    readonly expired: boolean;
};
/** 恢复成功的结果。
 * EXPECTED-DESIGN 1.4：操作日志状态机已废除——失败即进程内自动回滚到状态 A
 *（rescue 兜底），不再有持久化的 running/interrupted/recovery-required 中间态；
 * 会话绑定不匹配等流程性检查降级为 `warnings` 软警告字段。 */
export interface RestoreResult {
    readonly restorePointId: RestorePointId;
    readonly rescuePointId: RestorePointId;
    readonly restoredPaths: readonly string[];
    /** 软警告（会话绑定不匹配等）：不阻断执行，如实呈现给用户。 */
    readonly warnings?: readonly string[];
}
/** 撤销探查结果（EXPECTED-DESIGN 1.2 两段式协议的第一段）：
 * 逐路径 CAS 只读比对，不动磁盘。`conflicted` 是「恢复后又被修改过」的
 * 路径清单，客户端据此弹三选项对话框（拒绝 / 全部回滚 / 只回滚正常部分）。 */
export interface RestoreUndoProbe {
    readonly restorePointId: RestorePointId;
    readonly rescuePointId: RestorePointId;
    readonly time: number;
    /** CAS 通过（当前磁盘仍等于恢复完成瞬间状态）的路径。 */
    readonly clean: readonly string[];
    /** CAS 失配的路径与原因；force 回滚可覆盖这些路径（用户显式授权）。 */
    readonly conflicted: readonly {
        readonly path: string;
        readonly reason: string;
    }[];
}
/** 恢复后撤销的结果（借鉴 dsh-checkpoint-diff 的 rollback-undo）。
 * 被后续修改过的路径跳过并如实报告；force 回滚（用户授权）可覆盖——
 * before=null 的路径（恢复新建的文件）强制撤销 = 删除，即使被改过。 */
export interface RestoreUndoResult {
    readonly restorePointId: RestorePointId;
    readonly rescuePointId: RestorePointId;
    readonly undonePaths: readonly string[];
    readonly skippedPaths: readonly {
        readonly path: string;
        readonly reason: string;
    }[];
}
/** 插件公开配置（全部可选，缺省走 DEFAULTS）。 */
export interface ShadowRewindConfig {
    /** 状态根目录，必须不在任何被管理工作区内。 */
    readonly storageDir?: string;
    /** 每工作区保留的 user/rescue 恢复点上限。 */
    readonly maxRestorePoints?: number;
    /** 每会话保留的自动 turn 检查点上限。 */
    readonly maxTurnCheckpointsPerSession?: number;
    /** 单个恢复点的文件数上限。 */
    readonly maxFiles?: number;
    /** 单文件读取字节上限；超限文件被显式跳过（不失败）。 */
    readonly maxFileBytes?: number;
    /** 单个恢复点的文件总字节上限。 */
    readonly maxSnapshotBytes?: number;
    /** 恢复计划有效期（毫秒）；过期只作软警告，不再阻断执行（EXPECTED-DESIGN 1.4 #1）。 */
    readonly planTtlMs?: number;
    /**
     * 自动 turn 检查点实现：
     *  - `jj`（默认）：写入隐藏影子 jj 仓库；宿主机缺 jj CLI 时自动降级 sqlite；
     *  - `sqlite`：内置 SQLite 内容库（node:sqlite），无需任何外部 CLI；
     *  - `off`：关闭自动检查点。
     */
    readonly turnCheckpointMode?: 'off' | 'sqlite' | 'jj';
    /** 单次自动检查点允许占用的最长时间（毫秒）。 */
    readonly turnCheckpointTimeoutMs?: number;
    /** 单次自动检查点允许新写入镜像的字节上限（增量同步下的最坏写入量）。 */
    readonly turnCheckpointMaxNewBytes?: number;
    /** fast 信任 stat 缓存跳过未变文件；strict 每次全量重读重写。 */
    readonly turnCheckpointTrust?: 'fast' | 'strict';
    /**
     * 工作区相对的排除 glob。命中目录整棵剪枝，命中文件不入快照。
     * 字面路径（如 `node_modules`）视为「任意层级下的同名目录及其内容」。
     */
    readonly excludePatterns?: readonly string[];
}
/** 解析完成（全部字段有值）的配置。 */
export interface ResolvedShadowRewindConfig {
    readonly storageDir: string;
    readonly maxRestorePoints: number;
    readonly maxTurnCheckpointsPerSession: number;
    readonly maxFiles: number;
    readonly maxFileBytes: number;
    readonly maxSnapshotBytes: number;
    readonly planTtlMs: number;
    readonly turnCheckpointMode: 'off' | 'sqlite' | 'jj';
    readonly turnCheckpointTimeoutMs: number;
    readonly turnCheckpointMaxNewBytes: number;
    readonly turnCheckpointTrust: 'fast' | 'strict';
    readonly excludePatterns: readonly string[];
}
