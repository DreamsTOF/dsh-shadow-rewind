/**
 * 文件审查侧栏 tab·小组件。
 *
 * 统计徽标 / 撤销重做图标 / 折叠箭头 / 宿主巡检状态徽标 / diff 懒渲染容器。
 * 全部是纯展示件：状态由父组件持有，这里不发起任何请求。
 */
import type { ReactNode } from 'react';
import type { FileReviewFileState } from '../file-review/change-types.ts';
import type { UnifiedDiffStats } from './UnifiedDiff.tsx';
/** 行内 +/− 统计徽标（aria-label 供读屏，数字供扫读）。 */
export declare function Stats({ stats }: {
    readonly stats: UnifiedDiffStats;
}): import("react").JSX.Element;
/** 撤销动作图标（轮/文件按钮共用）。 */
export declare function UndoIcon(): import("react").JSX.Element;
/** 重做动作图标（撤销后的按钮从 undo 换成 redo）。 */
export declare function RedoIcon(): import("react").JSX.Element;
/** 文件行折叠箭头（open 时旋转指向下方）。 */
export declare function Chevron({ open }: {
    readonly open: boolean;
}): import("react").JSX.Element;
/** 每个 (轮, 文件) 的宿主巡检状态徽标；'applied' 时不渲染任何东西。 */
export declare function StateBadge({ state }: {
    readonly state: FileReviewFileState | undefined;
}): import("react").JSX.Element | null;
/** 懒渲染：只有行接近视口时才挂载重的 diff 渲染器（200px 预读余量）。 */
export declare function LazyDiff({ children }: {
    children: ReactNode;
}): import("react").JSX.Element;
