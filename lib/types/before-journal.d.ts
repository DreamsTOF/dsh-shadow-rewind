import type { ResolvedShadowRewindConfig } from './types.js';
import type { WorkspaceStore } from './store.js';
/** 一条 BEFORE 捕获记录（磁盘 JSON 的内存形态）。 */
export interface BeforeJournalEntry {
    readonly callId: string;
    readonly anchorSeq: number;
    /** 工作区相对路径（'/' 分隔）。 */
    readonly path: string;
    /** false = 该次调用创建了这个文件（content 为 null）。 */
    readonly existed: boolean;
    /** BEFORE 全文（UTF-8）；不存在为 null。 */
    readonly content: string | null;
    readonly size: number;
    readonly mode: number;
    readonly time: number;
}
export declare class BeforeJournal {
    private readonly store;
    private readonly config;
    /** `${workspace}\0${sessionId}\0${path}` → 最近一次已知内容（recheck 增量判定的单一事实源）。 */
    private readonly lastKnown;
    /** `${workspace}\0${sessionId}` → 跟踪路径集（进程内缓存；首条消息时从磁盘重建）。 */
    private readonly trackedCache;
    /** 每会话单调时钟：同毫秒提交保持捕获顺序。 */
    private readonly lastEntryTime;
    private readonly lastPruneAt;
    constructor(store: WorkspaceStore, config: ResolvedShadowRewindConfig);
    private sessionDir;
    private knownKey;
    /** 写入一条捕获记录（原子临时 + rename；内容内联）。 */
    record(workspace: string, sessionId: string, entry: Omit<BeforeJournalEntry, 'time'>): Promise<void>;
    /**
     * 读取 anchorSeq >= afterSeq（**含边界**：回滚目标消息自己回合的变更也要回滚）
     * 的全部记录，并对每个路径保留**最早**一条（anchorSeq 最小，其次 time 最小）。
     */
    earliestAfter(workspace: string, sessionId: string, afterSeq: number): Promise<ReadonlyMap<string, BeforeJournalEntry>>;
    /**
     * 某会话被跟踪的路径集（user/message 边界重查用）。进程内缓存优先；
     * 缓存未命中时扫描全部 anchor 目录的记录重建（每会话每进程至多一次全扫）。
     */
    trackedPaths(workspace: string, sessionId: string): Promise<Set<string>>;
    /** 最近一次已知内容（边界重查的增量判定基准；未记录过返回 undefined）。 */
    lastKnownContent(workspace: string, sessionId: string, path: string): string | null | undefined;
    /**
     * 保留每会话最新 MAX_ANCHOR_GROUPS 个 anchor 组，删除最旧的组目录。
     * 返回被清理的 anchorSeq 清单（调用方据此删除对应的 kind 'message' 恢复点，
     * 让内容 GC 回收独占 blob）。无 link（未做内容去重），整目录删除即安全。
     */
    prune(workspace: string, sessionId: string): Promise<readonly number[]>;
}
