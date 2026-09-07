/**
 * pending steering 消息撤回的纯计算层（抄 dsh-rewind client/pending.ts）。
 *
 * pending 行与队列镜像的配对是「索引优先 + 文本校验」：宿主按 next-step
 * inbox 顺序渲染 steering 气泡，DOM 行序即队列序；文本严格相等才认领，
 * 不匹配的行单独置 null（绝不把撤回按钮挂到错误的气泡上）。
 */
/** 队列镜像里的一条 steering 消息（结构子集）。 */
export interface SteeringItemLike {
    readonly id: string;
    readonly text: string | null;
}
/** DOM pending 行的文本投影。 */
export interface PendingRowLike {
    readonly text: string;
}
/**
 * DOM 行 × steering 队列的索引配对。返回与 rows 等长的数组：匹配上的行
 * 给出 itemId，不匹配的行是 null（按钮缺席，而非错误挂载）。
 */
export declare function matchPendingRows(rows: readonly PendingRowLike[], steering: readonly SteeringItemLike[]): readonly (string | null)[];
/**
 * 撤回区间：目标及其后的全部 steering（FIFO 序，最旧在前）。
 * 目标已不在队列（刚被运行中的回合领取）→ 空区间。不含 queued（下一回合）
 * 消息——QueueDock 已提供逐项编辑/移除。
 */
export declare function retractSpan(steering: readonly SteeringItemLike[], targetId: string): readonly string[];
