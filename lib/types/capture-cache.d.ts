import type { ScannedPath } from './scan.js';
/** 缓存中一个路径的记录：stat 指纹 + 上次的内容哈希（符号链接为 target）。 */
export interface CacheEntry {
    readonly kind: 'file' | 'symlink';
    readonly size: number;
    readonly mode: number;
    readonly mtimeNs: string;
    readonly ctimeNs: string;
    readonly dev: string;
    readonly ino: string;
    /** 上次捕获的内容 SHA-256（kind === 'file' 时有值）。 */
    readonly blob?: string;
    /** 上次捕获的链接目标（kind === 'symlink' 时有值）。 */
    readonly target?: string;
}
/** 缓存持久化包装：校验和防篡改，损坏即整体作废（回落空缓存）。 */
export interface CaptureCache {
    readonly version: 1;
    readonly paths: Record<string, CacheEntry>;
    readonly checksum: string;
}
/** 读取缓存；缺失/损坏回落空缓存（缓存永不阻塞捕获）。 */
export declare function readCaptureCache(path: string): Promise<CaptureCache>;
/** 原子写回缓存。 */
export declare function writeCaptureCache(path: string, cache: CaptureCache): Promise<void>;
/**
 * 清空缓存（直接删除文件）。
 * 在「目标存储可能已失去缓存所引用内容」之后调用——例如 GC 删除 blob、
 * 影子仓库被外部清理。缺失即无操作。
 */
export declare function clearCaptureCache(path: string): Promise<void>;
/** 从扫描事实生成缓存记录（blob 由调用方在实际读到内容后补充）。 */
export declare function cacheEntryOf(file: ScannedPath, blob?: string, target?: string): CacheEntry;
/** stat 指纹比对：缓存记录 vs 扫描事实。 */
export declare function cacheMatches(cached: CacheEntry, file: ScannedPath): boolean;
