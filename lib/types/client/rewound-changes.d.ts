/**
 * 回滚遮蔽标记：会话内成功回滚文件后，live 条（会话累计视图）与徽标需要把
 * 「磁盘上已经不存在的那部分改动」从视图里扣掉——5 轮改了 10 个文件、回滚
 * 2 轮撤销 5 个，live 条应剩 5 个。
 *
 * 判别基准（为什么是 seq 屏障而不是轮号）：快照条目只有事件 seq 可与「恢复
 * 发生时刻」比较。恢复成功那一刻取会话快照的最大节点 seq 作为**屏障**——
 * lastSeq ≤ 屏障且路径被恢复的条目一律遮蔽；屏障之后新产生的条目（继续对话
 * 的再编辑）照常显示。「撤销本次恢复」弹出栈顶标记即整体还原视图。
 *
 * TODO: 天花板——轮中恢复（restore 与编辑交错在同一轮内）无法按条目切分，
 * 按「整条遮蔽」处理；若需要条目级精度，要升级为宿主在恢复事件里广播被
 * 恢复的 (path, seq) 清单。
 */
/** 一条恢复标记：屏障 seq + 被恢复的路径集合（pathKey；null = 整树恢复）。 */
export interface RewoundMark {
    readonly barrier: number;
    readonly paths: ReadonlySet<string> | null;
}
/**
 * 记录一次成功恢复。
 * @param paths - 被恢复的路径集合（pathKey 归一）；null 表示整树恢复。
 * @param barrier - 恢复成功那一刻会话快照的最大节点 seq；拿不到时传 -1
 *   （等价于「该会话全部已知条目按路径遮蔽」）。
 */
export declare function markRewound(sessionId: string, paths: ReadonlySet<string> | null, barrier: number): void;
/** 撤销最近一次恢复：弹出栈顶标记，视图还原。 */
export declare function popRewound(sessionId: string): void;
/** 读某会话的全部恢复标记（只读，调用方不得改动）。 */
export declare function rewoundMarksOf(sessionId: string): readonly RewoundMark[];
/** 订阅标记变化（live 条 / 徽标据此重推导）。 */
export declare function subscribeRewound(listener: () => void): () => void;
/** 一个工具条目是否被遮蔽：lastSeq ≤ 屏障且路径被恢复。 */
export declare function isToolEntryRewound(marks: readonly RewoundMark[], pathKey: string, lastSeq: number): boolean;
/**
 * 一个 fs 条目（终端写盘）是否被遮蔽。fs 条目没有自身 seq，用所属轮的
 * turn/start seq 近似（轮开始于屏障之前 → 该轮写盘被视为恢复前改动）。
 */
export declare function isFsTurnRewound(marks: readonly RewoundMark[], turnStartSeq: number, path: string): boolean;
/**
 * 从会话快照取「恢复屏障」：最大节点 seq。恢复成功那一刻调用；快照形态
 * 不可知（宿主版本差异）时返回 -1，等价于「该会话全部已知条目按路径遮蔽」。
 */
export declare function snapshotBarrierOf(snapshot: unknown): number;
