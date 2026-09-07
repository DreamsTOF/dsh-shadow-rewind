import type { ShadowRewindEngine } from '../engine.js';
/** 一条等待提交的 BEFORE 捕获。 */
interface PendingCapture {
    readonly rel: string;
    readonly existed: boolean;
    readonly content: string | null;
    readonly mode: number;
}
/** anchor：当前回合最新 user/message 的事件 seq（增量缓存，同 dsh-rewind）。 */
interface AnchorCacheEntry {
    readonly anchor: number | undefined;
    readonly eventsLength: number;
}
export interface BeforeCaptureRuntime {
    readonly pending: Map<string, PendingCapture>;
    readonly anchorCache: WeakMap<object, AnchorCacheEntry>;
    readonly workspaceCache: Map<string, string | undefined>;
}
/**
 * 装配 BEFORE 捕获管道。幂等性由调用方（插件入口的一次性 apply）保证。
 * 捕获/提交的任何失败都只记警告、绝不拦截工具执行——捕获是尽力而为的
 * 安全网，不是工具的前置闸。
 */
export declare function installBeforeCapture(ctx: unknown, engine: ShadowRewindEngine): void;
export {};
