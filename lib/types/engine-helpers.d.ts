/**
 * 核心引擎·模块级纯函数工具。
 *
 * 摘要投影（summarize）、恢复计划的新鲜度断言与等价比较、路径深度排序键、
 * 有界文件读取、检查点错误码分类。全部无状态：引擎类与其基类共享。
 */
import type { Manifest, WorkspaceChange } from './types.js';
import type { RestorePlan, RestorePointSummary, SnapshotEntry } from './types.js';
/**
 * 恢复点 vs 当前树的路径级差异（partial 感知）。
 * 部分树（kind 'message' 的 BEFORE 兜底恢复点）只覆盖捕获到的路径：磁盘上
 * 其余路径一律「不在恢复范围」——`added` 方向的变更仅对 createdPaths
 * （捕获时不存在、此后被工具创建的路径）成立，绝不能把整个工作区当新增删掉。
 */
export declare function diffAgainstManifest(manifest: Manifest, currentEntries: Readonly<Record<string, SnapshotEntry>>): readonly WorkspaceChange[];
/** Manifest → 对外摘要（RestorePointSummary）：条目明细不外泄，只留计数。 */
export declare function summarize(manifest: Manifest): RestorePointSummary;
/** 深拷贝计划：对外返回的 RestorePlan 必须与引擎内存态脱钩（防外部篡改）。 */
export declare function structuredClonePlan(plan: RestorePlan): RestorePlan;
/** 执行恢复前复核：每条待恢复路径的当前磁盘条目必须仍与计划生成时一致。 */
export declare function assertPlanFresh(plan: RestorePlan, currentEntries: Readonly<Record<string, SnapshotEntry>>): void;
/**
 * 条目等价（内容寻址语义）：kind/mode 相同；file 比 blob+size；dir 只比
 * kind（目录无内容）；symlink 比 target。用于恢复计划复核与 undo 的 CAS。
 */
export declare function entriesEquivalent(left: SnapshotEntry | null, right: SnapshotEntry | null): boolean;
/** 路径深度（'/' 段数）：恢复时删除深层优先、写入浅层优先的排序键。 */
export declare function depthOf(path: string): number;
/** 该目录路径下是否存在快照条目（隐式目录由子条目在恢复时重建）。 */
export declare function hasDescendantEntry(manifest: Manifest, path: string): boolean;
/** 有界读文件：精确读满 expectedSize（不足即视为变化中的文件，返回短读由上层重试）。 */
export declare function readFileBounded(handle: import('node:fs/promises').FileHandle, expectedSize: number): Promise<Buffer>;
/** 自动检查点的失败中，哪些属于「可预期跳过」而非故障。 */
export declare function isCheckpointSkipCode(code: string): boolean;
/** 把捕获期错误包装为超时（保持外层 deadline 的语义）。 */
export declare function wrapCheckpointDeadline(error: unknown, timeoutMs: number, deadlineAborted: boolean): unknown;
