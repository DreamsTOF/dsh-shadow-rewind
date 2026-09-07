/**
 * 文件开关（撤销/重做）的行级状态共享层。
 *
 * live 条的行内撤销按钮与审查界面的 hunk 撤销是**两个入口、同一事实**：
 * 任一侧执行 apply 后把结果写进这里，另一侧订阅变化并重查宿主真值，
 * 两侧内容因此保持同步（状态翻转为 undone ↔ applied）。
 *
 * 键 = `${sessionId}\u0000${pathKey}`；只存最近一次结果，不持久化
 * （页面刷新后由审查界面的宿主巡检重建真值）。
 */
import type { FileReviewFileState } from '../file-review/change-types.ts';
/** 一个路径的最新开关状态。 */
export type ReviewRowState = FileReviewFileState;
/**
 * 写入一批开关结果（apply 的逐文件结果；status 巡检结果同形可用）。
 * 值全部相同（无变化）时不广播，避免订阅方空转。
 */
export declare function setReviewRows(sessionId: string, files: readonly {
    readonly path: string;
    readonly state: ReviewRowState;
}[]): void;
/** 读一个路径的最新开关状态（缺省 = 未操作过，动作视为 undo）。 */
export declare function reviewRowOf(sessionId: string, path: string): ReviewRowState | undefined;
/**
 * 一个路径的下一个动作：已撤销（undone）→ redo，其余 → undo。
 * conflict/unsupported/error 条目保持 undo（真正执行时宿主会再校验）。
 */
export declare function nextReviewAction(sessionId: string, path: string): 'undo' | 'redo';
/** 订阅状态变化（live 条 / 审查界面据此刷新）。 */
export declare function subscribeReviewRows(listener: () => void): () => void;
