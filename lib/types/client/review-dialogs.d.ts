/**
 * 文件审查侧栏 tab·辅助对话框。
 *
 *  - ReviewConflictDialog：apply 返回 conflict（内容漂移）时的三选项授权弹窗。
 *  - FileTimelineDialog：文件级时间线——一个文件在本会话被改动的每一轮，
 *    点某轮的 +/- 跳到该轮差异。
 *
 * 骨架复刻 TurnRewindDialog 的 srw-* 样式（由会话回退面全局注入）。
 */
import type { FileReviewAction } from '../file-review/change-types.ts';
import { type FlatChange, type FileTurnEntry } from './file-review-tab-types.ts';
export interface ReviewConflictProps {
    /** apply 批次里内容漂移（conflict）的条目。 */
    readonly items: readonly FlatChange[];
    readonly action: FileReviewAction;
    readonly busy: boolean;
    /** 拒绝：什么都不做（冲突路径保持原状）。 */
    readonly onAbort: () => void;
    /** 只回滚正常部分：跳过冲突路径。 */
    readonly onPartial: () => void;
    /** 全部回滚：force 重跑冲突条目，覆盖后续修改。 */
    readonly onForce: () => void;
}
/** 冲突三选项弹窗（EXPECTED-DESIGN 1.2）：审查面 apply 返回 conflict 时
 * 授权「拒绝 / 全部回滚 / 只回滚正常部分」——与消息回退撤销同一套语义。 */
export declare function ReviewConflictDialog({ items, busy, onAbort, onPartial, onForce }: ReviewConflictProps): import("react").JSX.Element;
export interface FileTimelineDialogProps {
    readonly path: string;
    /** 该文件的逐轮改动（轮次升序）。 */
    readonly entries: readonly FileTurnEntry[];
    /** 点击某轮的 +/- 统计：父级关闭对话框并滚动到那一轮的差异。 */
    readonly onPick: (turn: number) => void;
    readonly onClose: () => void;
}
/** 文件级时间线：最新轮在前；无 diff 的轮显示占位文案。 */
export declare function FileTimelineDialog({ path, entries, onPick, onClose }: FileTimelineDialogProps): import("react").JSX.Element;
