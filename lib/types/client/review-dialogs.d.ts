/**
 * 文件审查侧栏 tab·辅助对话框。
 *
 *  - MultiSessionConfirmDialog：提交批次含 owner === 'multi'（真多会话冲突）
 *    时的确认弹窗；纯同步确认，无 fetch 状态机。
 *  - FileTimelineDialog：文件级时间线——一个文件在本会话被改动的每一轮，
 *    点某轮的 +/- 跳到该轮差异。
 *
 * 骨架复刻 TurnRewindDialog 的 srw-* 样式（由会话回退面全局注入）。
 */
import type { FileReviewAction } from '../file-review/change-types.ts';
import { type FlatChange, type FileTurnEntry } from './file-review-tab-types.ts';
export interface MultiSessionConfirmProps {
    /** 已过提交闸（显式勾选）的待提交批次。 */
    readonly items: readonly FlatChange[];
    readonly action: FileReviewAction;
    /** 其它会话 id → displayTitle（列表快照查不到时回落原始 id）。 */
    readonly sessionTitle: (id: string) => string | undefined;
    readonly onCancel: () => void;
    /** 改为手动勾选：关弹窗 + 展开冲突行并滚动到位。 */
    readonly onManual: () => void;
    readonly onProceed: () => void;
}
/** 多会话确认弹窗：真冲突（multi）逐行列出，其余他会话条目汇总提示。 */
export declare function MultiSessionConfirmDialog({ items, action, sessionTitle, onCancel, onManual, onProceed }: MultiSessionConfirmProps): import("react").JSX.Element;
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
