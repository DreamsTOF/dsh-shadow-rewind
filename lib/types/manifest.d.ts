import type { Manifest, RestoreOperation, SnapshotEntry, WorkspaceChange } from './types.js';
/** 生成形如 `rp_<timeBase36>_<rand12>` 的持久化 id。 */
export declare function makeId(prefix: 'rp' | 'op' | 'plan'): string;
/** 内容寻址：文件字节 → SHA-256 hex。 */
export declare function sha256Hex(content: Buffer): string;
/**
 * 全树确定性哈希：路径逐条目序列化后统一 SHA-256。
 * 快照条目只含 kind/blob/size/mode/target——与字节存放在哪个后端无关，
 * 因此同一棵树在 jj 与 blob 两种后端下 treeHash 一致。
 * 刻意不含 mtimeNs：树哈希是内容寻址，恢复写回不保留时间戳——若时间戳进哈希，
 * 恢复后树哈希必变，会击穿 planRestore 的树哈希 CAS（旧清单也因而判「损坏」）。
 */
export declare function hashTree(entries: Readonly<Record<string, SnapshotEntry>>): string;
/** 两个条目是否字节/类型/权限完全等价。
 * mtimeNs 不参与：等价判定与树哈希同为内容寻址，恢复写回不保留时间戳。 */
export declare function entriesEqual(left: SnapshotEntry | undefined, right: SnapshotEntry | undefined): boolean;
/**
 * 计算快照树之间的路径级差异。
 * `before` 是旧树（缺路径 → added），`after` 是新树（缺路径 → deleted）。
 */
export declare function diffTrees(before: Readonly<Record<string, SnapshotEntry>>, after: Readonly<Record<string, SnapshotEntry>>): WorkspaceChange[];
/** 解析并全量校验一份不受信任的 manifest JSON。 */
export declare function parseManifest(value: unknown): Manifest;
/** 解析并校验一份恢复操作日志。 */
export declare function parseOperation(value: unknown): RestoreOperation;
