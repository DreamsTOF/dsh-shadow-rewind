/**
 * 会话恢复记录（restore-records）——回滚遮蔽标记 + 恢复元数据的**单一真相**。
 *
 * 三份审计（live 条 / 审查面板 / 回退弹窗）对「某会话发生过哪些恢复、撤销到
 * 哪一步、磁盘上已被还原的路径」读同一个 store、写同一组动作：
 *  - 写入方：回退弹窗（rewind.ts）、审查面板按轮快照恢复（FileReviewTab）
 *    统一走 {@link commitRestore}（自动带记录 id / 时间 / 检查点 / 模式）；
 *  - 撤销方：任何「撤销本次恢复」统一走 {@link popRewound}（栈式、后进先出，
 *    与宿主引擎的 workspace 级 undo 记录语义对应）；
 *  - 读取方：live 条（过滤被遮蔽条目）、审查面板（收到恢复/撤销广播后刷新
 *    巡检与 fs 清单，避免展示已被恢复的行）等，经 {@link subscribeRewound} 订阅。
 *
 * 遮蔽判别基准（为什么是 seq 屏障）：快照条目只有事件 seq 可与「恢复发生时刻」
 * 比较。恢复成功那一刻取会话快照的**最大节点 seq** 作为屏障——lastSeq ≤ 屏障
 * 且路径被恢复的条目一律遮蔽；屏障之后新产生的条目照常显示。
 *
 * TODO: 天花板——轮中恢复（restore 与编辑交错在同一轮内）无法按条目切分，
 * 按「整条遮蔽」处理；条目级精度需宿主在恢复事件里广播被恢复的 (path, seq)
 * 清单（对应 rewound-changes 的历史 TODO，抽层后仍成立）。
 */
/** 一条恢复标记：屏障 seq + 被恢复的路径集合（pathKey；null = 整树恢复）。 */
export interface RewoundMark {
    readonly barrier: number;
    readonly paths: ReadonlySet<string> | null;
}
/** 带元数据的一次恢复（commitRestore 产出的完整记录；兼容旧 RewoundMark 读法）。 */
export interface RestoreRecord extends RewoundMark {
    /** 会话内恢复记录的自增 id（「撤销最近一次」与弹窗撤销锚定用）。 */
    readonly id: string;
    /** 恢复发生的 epoch ms。 */
    readonly at: number;
    readonly checkpointId?: string;
    /** 恢复模式：'code' | 'both' | 'inplace'（来自引擎/弹窗）。 */
    readonly mode?: string;
    /** 恢复所在工作区（预览响应的 workspace/cwd）——恢复是工作区级事实，撤销按
     * workspace 对齐，多会话共享 cwd 时避免 marks 与宿主 undo 槽身份分裂。 */
    readonly workspace?: string;
}
/**
 * 记录一次成功恢复（三面写恢复的统一入口）。
 * @param paths - 被恢复的路径集合（pathKey 归一）；null 表示整树恢复。
 * @param barrier - 恢复成功那一刻会话快照的最大节点 seq；拿不到时传 -1
 *   （等价于「该会话全部已知条目按路径遮蔽」）。
 */
export declare function commitRestore(options: {
    readonly sessionId: string;
    readonly paths: ReadonlySet<string> | null;
    readonly barrier: number;
    readonly checkpointId?: string;
    readonly mode?: string;
    readonly workspace?: string;
}): RestoreRecord;
/** 撤销最近一次恢复：弹出栈顶记录，视图还原。返回被弹出的记录（无则 undefined）。 */
export declare function popRewound(sessionId: string): RestoreRecord | undefined;
/** 读某会话的全部恢复记录（只读，调用方不得改动）。 */
export declare function restoreRecordsOf(sessionId: string): readonly RestoreRecord[];
/** 读某会话最近一次恢复记录（无则 undefined）。 */
export declare function lastRestoreOf(sessionId: string): RestoreRecord | undefined;
/** 读某会话的全部恢复标记（旧 API 只读视图，等同 restoreRecordsOf）。 */
export declare function rewoundMarksOf(sessionId: string): readonly RewoundMark[];
/** 订阅恢复/撤销变化（live 条 / 审查面板 / 弹窗据此重推导或刷新）。 */
export declare function subscribeRewound(listener: () => void): () => void;
/** 一个 fs 条目是否被遮蔽（唯一谓词）：最早触碰轮的 turn/start seq ≤ 屏障，
 * 且该次恢复覆盖了这条路径（paths === null = 整树恢复 → 全部遮蔽）。
 * barrier < 0（快照不可得的兜底）短路为「按路径无条件命中」。 */
export declare function isFsTurnRewound(marks: readonly RewoundMark[], turnStartSeq: number, path: string): boolean;
/**
 * 从会话快照取「恢复屏障」：最大节点 seq。恢复成功那一刻调用；快照形态
 * 不可知（宿主版本差异）时返回 -1，等价于「该会话全部已知条目按路径遮蔽」。
 */
export declare function snapshotBarrierOf(snapshot: unknown): number;
