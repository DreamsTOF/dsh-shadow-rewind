/** 影子回退（shadow-rewind）的共享类型：持久化格式、插件配置与对外结果。 */

/** 持久化格式版本。读取方拒绝一切其它版本（fail-closed，不做最佳努力兼容）。 */
export const FORMAT_VERSION = 1 as const

/** 恢复点 id（形如 rp_<time>_<rand12>）。 */
export type RestorePointId = string

/** 恢复操作日志 id（形如 op_<time>_<rand12>）。 */
export type RestoreOperationId = string

/** 内存中的限时恢复计划 id（形如 plan_<time>_<rand12>）。 */
export type RestorePlanId = string

/** 单个普通文件的快照条目。`blob` 是文件内容的 SHA-256。 */
export interface FileEntry {
  readonly kind: 'file'
  readonly blob: string
  readonly size: number
  /** 完整权限位（含可执行位），恢复时原样写回。 */
  readonly mode: number
}

/** 单个符号链接的快照条目。target 原样保留，mode 是链接自身的权限位。 */
export interface SymlinkEntry {
  readonly kind: 'symlink'
  readonly target: string
  readonly mode: number
}

/** 单个空目录的快照条目（子树里没有任何入选文件/链接的目录）。
 * 非空目录不入快照——它们由子条目在恢复时按需重建。 */
export interface DirEntry {
  readonly kind: 'dir'
  readonly mode: number
}

/** 快照条目：文件、符号链接或空目录。 */
export type SnapshotEntry = FileEntry | SymlinkEntry | DirEntry

/** 一个可见路径未能进入快照的原因。 */
export type SkipReason =
  /** 超过单文件字节上限（maxFileBytes）。 */
  | 'too-large'
  /** 既不是普通文件也不是符号链接（套接字/设备/FIFO 等）。 */
  | 'unsupported-type'
  /** 稳定读取重试后仍失败（内容阶段记录）。 */
  | 'read-failed'

/** 一个入选路径被显式跳过的记录——预览与恢复结果必须如实展示，绝不静默丢弃。 */
export interface SkippedPath {
  readonly path: string
  readonly reason: SkipReason
}

/** 快照字节由哪个后端持有。 */
export type ContentBackend =
  /** 隐藏影子 jj 仓库（默认）。 */
  | 'jj'
  /** 独立内容寻址 blob 目录（legacy；也是 jj 缺失时的自动降级目标）。 */
  | 'blob'

/** 恢复点的用途。 */
export type RestorePointKind =
  /** 用户手动创建。 */
  | 'user'
  /** 恢复前自动创建的安全备份。 */
  | 'rescue'
  /** 每轮对话开始前自动创建的隐藏检查点。 */
  | 'turn'

/** 持久化恢复点清单（磁盘 JSON 的内存形态，读取时全量校验）。 */
export interface Manifest {
  readonly version: typeof FORMAT_VERSION
  readonly id: RestorePointId
  readonly kind: RestorePointKind
  /** 规范化的工作区绝对路径——普通目录，与 VCS 完全无关。 */
  readonly workspace: string
  /** 本快照的字节由哪个后端持有。 */
  readonly storage: ContentBackend
  /** storage === 'jj' 时的影子仓库 commit id（40 位 git sha）。 */
  readonly commitId?: string
  readonly sessionId?: string
  readonly label?: string
  /** rescue 点指向触发它的恢复点。 */
  readonly parentRestorePoint?: RestorePointId
  /** 该检查点所属的 DSH 回合号（turn 专用）。 */
  readonly turn?: number
  /** 回合开始事件的 seq；快照在该回合第一步之前捕获（turn 专用）。 */
  readonly turnStartSeq?: number
  /** 轮内相位（turn 专用）：'start' = 轮起捕获（缺省/旧数据），'end' = 轮末
   * （turn/end 事件）捕获——轮末快照冻结轮末树状态，归属不再依赖下一轮轮起。 */
  readonly phase?: 'start' | 'end'
  /** 旧式回合边界 seq（保留字段，当前不写入）。 */
  readonly turnEndSeq?: number
  readonly createdAt: number
  /** 全部条目按 path 排序后的确定性哈希；读取时重算校验。 */
  readonly treeHash: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly entries: Readonly<Record<string, SnapshotEntry>>
  /** 可见但未入快照的路径。 */
  readonly skippedPaths: readonly SkippedPath[]
  readonly restoreCount: number
  readonly lastRestoredAt?: number
}

/** 一个路径在「快照 vs 当前」之间的差异。 */
export interface WorkspaceChange {
  readonly path: string
  readonly kind: 'added' | 'deleted' | 'modified' | 'mode-changed' | 'type-changed'
  readonly before?: SnapshotEntry
  readonly after?: SnapshotEntry
}

/** inspect 的结果：恢复点与当前工作区的对比。 */
export interface Inspection {
  readonly restorePoint: RestorePointSummary
  readonly currentTreeHash: string
  readonly changes: readonly WorkspaceChange[]
}

/** 恢复点的紧凑摘要（列表与预览用）。 */
export interface RestorePointSummary {
  readonly format: typeof FORMAT_VERSION
  readonly id: RestorePointId
  readonly kind: RestorePointKind
  readonly workspace: string
  readonly storage: ContentBackend
  readonly sessionId?: string
  readonly label?: string
  readonly turn?: number
  readonly turnStartSeq?: number
  readonly phase?: 'start' | 'end'
  readonly createdAt: number
  readonly treeHash: string
  readonly fileCount: number
  readonly totalBytes: number
  readonly skippedPathCount: number
  readonly restoreCount: number
  readonly lastRestoredAt?: number
}

/** 限时恢复计划：确认串必须逐字回显才会被执行。 */
export interface RestorePlan {
  readonly id: RestorePlanId
  readonly restorePointId: RestorePointId
  readonly workspace: string
  readonly sessionId?: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly confirmation: string
  readonly changes: readonly WorkspaceChange[]
  /** 快照中显式跳过的路径（恢复不会碰它们，仅随计划透出展示）。 */
  readonly skippedPaths: readonly SkippedPath[]
  /** 每个待恢复路径在「计划生成时」的当前条目；apply 时逐路径复核防覆盖新修改。 */
  readonly expected: Readonly<Record<string, SnapshotEntry | null>>
}

/** 一次恢复操作的持久化日志（崩溃恢复的依据）。 */
export interface RestoreOperation {
  readonly version: typeof FORMAT_VERSION
  readonly id: RestoreOperationId
  readonly workspace: string
  readonly restorePointId: RestorePointId
  readonly rescuePointId: RestorePointId
  readonly sessionId?: string
  readonly paths: readonly string[]
  readonly startedAt: number
  readonly finishedAt?: number
  readonly state:
    | 'running'
    | 'rollback-running'
    | 'completed'
    | 'rolled-back'
    | 'interrupted'
    | 'recovery-required'
  readonly error?: string
  readonly rollbackError?: string
}

/** 恢复成功的结果。 */
export interface RestoreResult {
  readonly operationId: RestoreOperationId
  readonly restorePointId: RestorePointId
  readonly rescuePointId: RestorePointId
  readonly restoredPaths: readonly string[]
}

/** 中断操作的恢复摘要。 */
export interface RecoverySummary {
  readonly operationId: RestoreOperationId
  readonly restorePointId: RestorePointId
  readonly rescuePointId: RestorePointId
  readonly state: 'interrupted' | 'recovery-required'
  readonly paths: readonly string[]
  readonly startedAt: number
  readonly error?: string
  readonly rollbackError?: string
}

/** 插件公开配置（全部可选，缺省走 DEFAULTS）。 */
export interface ShadowRewindConfig {
  /** 状态根目录，必须不在任何被管理工作区内。 */
  readonly storageDir?: string
  /** 每工作区保留的 user/rescue 恢复点上限。 */
  readonly maxRestorePoints?: number
  /** 每会话保留的自动 turn 检查点上限。 */
  readonly maxTurnCheckpointsPerSession?: number
  /** 单个恢复点的文件数上限。 */
  readonly maxFiles?: number
  /** 单文件读取字节上限；超限文件被显式跳过（不失败）。 */
  readonly maxFileBytes?: number
  /** 单个恢复点的文件总字节上限。 */
  readonly maxSnapshotBytes?: number
  /** 恢复计划有效期（毫秒）。 */
  readonly planTtlMs?: number
  /** 锁主人消失多久后允许回收其锁（毫秒）。 */
  readonly staleLockMs?: number
  /**
   * 自动 turn 检查点实现：
   *  - `jj`（默认）：写入隐藏影子 jj 仓库；宿主机缺 jj CLI 时自动降级 legacy；
   *  - `legacy`：内容寻址 blob 目录，无需任何外部 CLI；
   *  - `off`：关闭自动检查点。
   */
  readonly turnCheckpointMode?: 'off' | 'legacy' | 'jj'
  /** 单次自动检查点允许占用的最长时间（毫秒）。 */
  readonly turnCheckpointTimeoutMs?: number
  /** 单次自动检查点允许新写入镜像的字节上限（增量同步下的最坏写入量）。 */
  readonly turnCheckpointMaxNewBytes?: number
  /** fast 信任 stat 缓存跳过未变文件；strict 每次全量重读重写。 */
  readonly turnCheckpointTrust?: 'fast' | 'strict'
  /**
   * 工作区相对的排除 glob。命中目录整棵剪枝，命中文件不入快照。
   * 字面路径（如 `node_modules`）视为「任意层级下的同名目录及其内容」。
   */
  readonly excludePatterns?: readonly string[]
  /**
   * 写入闸（「以当前为准」，默认开启）：同一工作区任一时刻只允许最近一个
   * 开始回合的会话写入；其它会话的可变工具（含终端与 run_code）被拒绝，
   * 只读工具照常。开启后恢复的占用闸放宽为「仅请求者自身与当前所有者
   * 运行中才阻塞」。关闭时恢复保持旧行为（任何运行中的会话都阻塞）。
   */
  readonly writeGate?: boolean
  /** 写入闸在只读白名单之外额外放行的工具名（白名单语义见 README）。 */
  readonly writeGateAllow?: readonly string[]
}

/** 解析完成（全部字段有值）的配置。 */
export interface ResolvedShadowRewindConfig {
  readonly storageDir: string
  readonly maxRestorePoints: number
  readonly maxTurnCheckpointsPerSession: number
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxSnapshotBytes: number
  readonly planTtlMs: number
  readonly staleLockMs: number
  readonly turnCheckpointMode: 'off' | 'legacy' | 'jj'
  readonly turnCheckpointTimeoutMs: number
  readonly turnCheckpointMaxNewBytes: number
  readonly turnCheckpointTrust: 'fast' | 'strict'
  readonly excludePatterns: readonly string[]
}