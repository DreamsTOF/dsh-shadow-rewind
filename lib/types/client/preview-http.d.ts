/** 引擎恢复预览的目标寻址（消息 seq 或轮号，与端点 query 对应）。 */
export type RewindTargetQuery = {
    readonly messageSeq: number;
} | {
    readonly turn: number;
};
/** 变更条目（归属徽标与净行数可选）。 */
export interface SharedPreviewChange {
    readonly path: string;
    readonly kind: string;
    readonly owner?: string;
    readonly added?: number;
    readonly removed?: number;
}
/** 共享解码的完整预览（宽松超集；弹窗再各自收敛）。 */
export type SharedRewindPreview = {
    readonly status: 'pending';
} | {
    readonly status: 'missing';
} | {
    readonly status: 'skipped';
    readonly reason?: string;
} | {
    readonly status: 'failed';
    readonly error?: string;
    readonly reason?: string;
} | {
    readonly status: 'ready';
    readonly sessionId?: string;
    readonly messageSeq?: number;
    readonly turn?: number;
    readonly checkpointId?: string;
    readonly workspace?: string;
    readonly planId?: string;
    readonly totalChanges: number;
    readonly changes: readonly SharedPreviewChange[];
    readonly truncated: boolean;
    readonly offset?: number;
    readonly skippedPaths: readonly {
        path: string;
        reason: string;
    }[];
};
/** 非 ok 的预览请求（带宿主错误码）。 */
export declare class RewindPreviewHttpError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** 宽松逐字段解码宿主预览响应；形状偏差一律退安全缺省，绝不抛。 */
export declare function decodeSharedRewindPreview(value: unknown): SharedRewindPreview;
/**
 * 拉取一次完整预览：首页 →（ready + truncated）自动按页拉全合并——恢复总是
 * 整树，清单必须完整。非 ready 状态（pending/missing/skipped/failed）原样返回；
 * 分页中途 PLAN_STALE 以带码错误抛出，由弹窗映射。
 */
export declare function fetchSharedRewindPreview(sessionId: string, target: RewindTargetQuery): Promise<SharedRewindPreview>;
