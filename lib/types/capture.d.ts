import { type CaptureCache } from './capture-cache.js';
import type { ScannedPath } from './scan.js';
import type { SkippedPath, SnapshotEntry } from './types.js';
/** 一次捕获的完整产物。 */
export interface CaptureOutput {
    readonly entries: Readonly<Record<string, SnapshotEntry>>;
    readonly skipped: readonly SkippedPath[];
    readonly treeHash: string;
    readonly fileCount: number;
    readonly totalBytes: number;
    /** 本轮真正新读的文件内容（路径 → Buffer），由引擎按后端写入。 */
    readonly newContent: ReadonlyMap<string, Buffer>;
    /** 本轮 target 发生变化的符号链接（路径 → target），镜像类后端必须重建。 */
    readonly newLinks: ReadonlyMap<string, string>;
    /** 本轮结束后应写回的缓存（含命中复用的条目）。 */
    readonly nextCache: CaptureCache;
}
/** 捕获选项。 */
export interface CaptureOptions {
    readonly root: string;
    readonly paths: readonly ScannedPath[];
    /** 扫描阶段已产生的跳过项（too-large / unsupported-type）。 */
    readonly skippedAtScan: readonly SkippedPath[];
    /** 扫描发现的空目录：直接落 dir 条目（无内容、不进增量缓存）。 */
    readonly emptyDirs?: readonly {
        readonly path: string;
        readonly mode: number;
    }[];
    readonly maxFiles: number;
    readonly maxSnapshotBytes: number;
    readonly strict: boolean;
    readonly cache: CaptureCache;
    /**
     * 缓存命中时的存在性校验：上次的内容（blob / 镜像文件）是否真的还在。
     * 返回 false 则按未命中处理（重读 + 重写）。省略时跳过校验（信任缓存）。
     */
    readonly verifyContent?: (path: string, blob: string) => Promise<boolean>;
    readonly signal?: AbortSignal;
}
/** 执行捕获（见模块注释）。 */
export declare function captureSnapshot(options: CaptureOptions): Promise<CaptureOutput>;
/** 全树确定性哈希：路径 + 条目完整签名（与存储后端无关）。 */
export declare function hashTree(entries: Readonly<Record<string, SnapshotEntry>>): string;
