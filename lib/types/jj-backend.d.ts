import type { ScannedPath } from './scan.js';
/** 探测宿主机上 `jj` CLI 是否可用（一次性开销，启动时调用）。 */
export declare function jjAvailable(): boolean;
/** 单个工作区的影子仓库句柄。 */
export declare class ShadowJj {
    readonly repoDir: string;
    private initialized;
    constructor(repoDir: string);
    /**
     * 幂等初始化：建仓（git 后端）。
     * 「镜像目录存在但 .jj 没了」意味着仓库本体曾被外部清理——此时共享
     * stat 缓存仍可能指向这个空仓库，默默重建会产出「成功但为空」的检查点。
     * 因此抛出 JJ_REPO_LOST，由引擎清缓存并重建后再重试捕获。
     */
    initialize(signal?: AbortSignal): Promise<void>;
    /**
     * 把本轮快照镜像进 `checkpoint/` 并显式提交为一个 change。
     *
     * 增量语义由共享 stat 缓存（capture.ts）决定：newContent 是需要重写的
     * 文件、newLinks 是需要重建的符号链接——缓存命中的路径工作副本里已是
     * 当前内容，保持原样；快照中不存在的路径（工作区已删除）从镜像中清除。
     * 随后 `jj commit` 把 working copy 收进 @ 并新开空 @，checkpoint change
     * 恒为提交后的 `@-`。
     */
    capture(paths: readonly ScannedPath[], newContent: ReadonlyMap<string, Buffer>, newLinks: ReadonlyMap<string, string>, message: string, options: {
        readonly maxNewBytes: number;
        readonly signal?: AbortSignal;
    }): Promise<{
        readonly commitId: string;
        readonly writtenBytes: number;
    }>;
    /**
     * 从某个 checkpoint 读取一个路径的字节；路径不存在返回 null。
     * 读文件的子命令在 jj 0.40 起从 `cat` 迁移为 `file show`，两种都试。
     */
    readSnapshot(commitId: string, path: string, signal?: AbortSignal): Promise<Buffer | null>;
}
//# sourceMappingURL=jj-backend.d.ts.map