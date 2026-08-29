import { parseManifest } from './manifest.js';
import type { RestoreOperation, ResolvedShadowRewindConfig } from './types.js';
/** 每个工作区的全部持久化状态。 */
export declare class WorkspaceStore {
    private readonly config;
    constructor(config: ResolvedShadowRewindConfig);
    /** 启动恢复：把遗留的 running 操作标记为 interrupted，返回处理条数。 */
    initialize(): Promise<number>;
    /** 规范工作区 → 状态目录（binding 校验通过后）。 */
    workspaceDir(workspace: string): Promise<string>;
    /**
     * 获取工作区互斥锁（单机自用简化版）：
     * O_EXCL 独占创建 lock.json；持有者进程已死且超过 staleLockMs 才允许回收。
     * 同机多实例靠 pid 判活；跨机共享存储不在设计范围内。
     */
    acquire(workspace: string, signal?: AbortSignal): Promise<() => Promise<void>>;
    writeManifest(workspace: string, manifest: Parameters<typeof parseManifest>[0]): Promise<void>;
    readManifest(workspace: string, id: string): Promise<ReturnType<typeof parseManifest>>;
    listManifests(workspace: string): Promise<readonly ReturnType<typeof parseManifest>[]>;
    deleteManifest(workspace: string, id: string): Promise<void>;
    writeOperation(operation: RestoreOperation): Promise<void>;
    listOperations(workspace: string): Promise<readonly RestoreOperation[]>;
    writeTurnSkip(workspace: string, skip: {
        sessionId: string;
        turn: number;
        turnStartSeq: number;
        reason: string;
    }): Promise<void>;
    readTurnSkip(workspace: string, sessionId: string, turn: number, turnStartSeq: number): Promise<{
        reason: string;
    } | undefined>;
    deleteTurnSkip(workspace: string, sessionId: string, turn: number, turnStartSeq: number): Promise<void>;
    /** 写入并校验一个 blob；已存在时读回比对（内容寻址下等价即安全）。 */
    putBlob(workspace: string, hash: string, content: Buffer): Promise<void>;
    /** 缓存命中校验用：blob 是否确实存在于存储（不读内容，仅 stat）。 */
    blobExists(workspace: string, hash: string): Promise<boolean>;
    /** 读取并校验一个 blob。 */
    readBlob(workspace: string, hash: string): Promise<Buffer>;
    /** 删除未被任何 manifest 引用的 blob（只统计 blob 后端的引用）。 */
    collectGarbage(workspace: string): Promise<{
        deletedBlobs: number;
        retainedBlobs: number;
    }>;
    /** 启动恢复用：列出全部工作区状态目录（key 形式）。 */
    listWorkspaceKeys(): Promise<readonly string[]>;
    /** 状态根必须不在被管理工作区内（防自吞）。 */
    assertStorageSeparated(workspace: string): Promise<void>;
}
//# sourceMappingURL=store.d.ts.map