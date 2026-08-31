/**
 * Utilities for generating diffs from file-system-level changes
 * (PowerShell-created/modified/deleted files detected via checkpoint comparison).
 *
 * Attribution: turn N's changes = diff(turn N's start checkpoint, turn N+1's
 * start checkpoint) — the capture before turn N+1's first step IS turn N's
 * end-of-turn tree state. The host's /shadow-rewind/fs-changes endpoint
 * already applies this pairing (plus a live-tail entry comparing the newest
 * checkpoint against the current disk), and — same build — precomputes each
 * change's added/removed line counts so the client can render rows and stats
 * WITHOUT fetching any content. Full texts ride a lazy per-(turn, path) layer:
 * they are fetched only when a diff body or an undo actually needs them
 * (hover popover, expanded row, undo submit), memoized until the underlying
 * cache entry changes (warm replacement invalidates the turn's memo).
 */
import type { ProducedFileReview } from '../file-review/change-types.ts';
import type { FsAttributionFields, TurnFileChanges, SessionFileChange } from './session-changes.ts';
/** One fs-level change; added/removed 是服务端预算好的行数（缺省 = 旧宿主）。 */
export interface FsChange extends FsAttributionFields {
    readonly path: string;
    readonly kind: 'added' | 'modified' | 'deleted';
    readonly added?: number;
    readonly removed?: number;
    /** 检查点记录的两侧权限位（透传给宿主，写回时恢复）。 */
    readonly oldMode?: number;
    readonly newMode?: number;
    /** 空目录条目：撤销语义是 mkdir/rmdir，无全文。 */
    readonly dir?: boolean;
}
/** 归因字段投影（占位/补齐/提交各构造点共用）：全缺省时返回空对象。 */
export declare function fsAttributionOf(source: FsAttributionFields): FsAttributionFields;
/** One turn's file-system changes as returned by /shadow-rewind/fs-changes. */
export interface FsChangeTurn {
    readonly turn: number;
    /** turn/start event seq — unique per session per turn; the cache key. */
    readonly turnStartSeq: number;
    readonly checkpointId: string;
    /** Next turn's checkpoint id, or 'live' (= compare against current disk). */
    readonly nextCheckpointId: string;
    readonly live?: boolean;
    /** Attached when the entry lives in the module cache (warm knows the session). */
    readonly sessionId?: string;
    readonly changes: readonly FsChange[];
}
/** /shadow-rewind/fs-changes 响应（含数据版本 rev，见 warmFsChanges）。 */
export interface FsChangesPayload {
    readonly turns: readonly FsChangeTurn[];
    /** 工作区数据版本：检查点捕获/恢复成功即递增；缺省 = 旧宿主。 */
    readonly rev?: number;
}
/**
 * Fetch every turn's file-system changes from the batch endpoint
 * (lenient parse: unknown/missing fields degrade to an empty list).
 */
export declare function fetchAllFsChanges(sessionId: string): Promise<FsChangesPayload>;
/** Subscribe to cache refreshes (cards re-derive their fs reviews). */
export declare function subscribeFsCache(listener: () => void): () => void;
/** Synchronous read for the turn-tail select(): does this turn have fs changes? */
export declare function cachedFsTurnFor(turnStartSeq: number): FsChangeTurn | undefined;
/**
 * Throttled fire-and-forget warm of one session's fs-changes into the cache.
 * Safe to call from hot paths (badge renders, snapshot subscriptions).
 * rev 未变时（同构建宿主必带）直接跳过解析、缓存写入与通知——warm 的正确性
 * 不再依赖 JSON 深比较；rev 缺省（旧宿主）回退到逐条 JSON 比较。
 */
export declare function warmFsChanges(sessionId: string): void;
/** Synchronous read by session + turn (the live bar's lookup; cache entries carry sessionId). */
export declare function cachedFsTurnForSessionTurn(sessionId: string, turn: number): FsChangeTurn | undefined;
/**
 * 一个 fs 条目的占位形态：零全文、带服务端行数。卡片/侧边栏/live 条先用它
 * 渲染行与 +/−，内容在悬停、展开或撤销时经 ensureFsFileDiff 按需补齐。
 */
export declare function fsTurnReviews(fsTurn: FsChangeTurn): readonly ProducedFileReview[];
/**
 * 取一个 fs 条目的完整全文条目（撤销/展示 diff 用）。同一 (turn, path) 的
 * 并发与后续调用复用同一个请求；该轮缓存条目被 warm 替换时记忆自动失效
 * （live 条的磁盘内容会随回合推进而变化，绝不能跨更新复用）。
 */
export declare function ensureFsFileDiff(fsTurn: FsChangeTurn, path: string, cwd: string): Promise<SessionFileChange | null>;
/**
 * Convert one turn's file-system changes into full-diff TurnFileChanges.
 * 保留给「确知需要整轮全文」的调用方（如恢复对话框窗口统计）；常规渲染
 * 走 fsTurnReviews + ensureFsFileDiff，避免无谓的全文 HTTP。
 */
export declare function convertFsTurnToFiles(fsTurn: FsChangeTurn, cwd: string): Promise<TurnFileChanges | null>;
