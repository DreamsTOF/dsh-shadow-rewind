/**
 * DiffPopover —— 轮尾卡片与轮中 live 条**共用**的悬停预览浮层。
 *
 * 锚点是宿主框（卡片或 live 条）自身的 rect：浮层与框同宽、左对齐，于是两
 * 个面天然长得一样，不需要各自维护一套定位逻辑。上下方向按视口余量翻转。
 */
import type { ProducedFileReview } from './turn-deliverables.ts';
import type { UnifiedDiffStats } from './UnifiedDiff.tsx';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { NS } from './chat-locales.ts';
/** 宿主框的 rect（视口坐标），浮层据此对齐与定宽。 */
export interface PopoverAnchorRect {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly width: number;
}
/** DiffPopover 的入参：一个文件的审查数据 + 锚点 + 已算好的行数字。 */
export interface DiffPopoverProps {
    readonly review: ProducedFileReview;
    readonly anchor: PopoverAnchorRect;
    readonly stats: UnifiedDiffStats;
    readonly statsLabel: string;
    readonly t: PropsLocale<typeof NS>['t'];
    readonly onEnter: () => void;
    readonly onLeave: () => void;
}
export declare function DiffPopover({ review, anchor, stats, statsLabel, t, onEnter, onLeave, }: DiffPopoverProps): import("react").JSX.Element;
