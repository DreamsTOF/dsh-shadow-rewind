/**
 * DiffPopover: shared hover preview for the turn-tail card AND the live bar.
 * The anchor is the host frame's rect (card or live bar), so the popover is
 * exactly as wide as the frame and left-aligned with it — both surfaces get
 * the same look by construction.
 */
import type { ProducedFileReview } from './turn-deliverables.ts';
import type { UnifiedDiffStats } from './UnifiedDiff.tsx';
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { NS } from './chat-locales.ts';
/** Host frame rect (viewport coordinates) the popover aligns to. */
export interface PopoverAnchorRect {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly width: number;
}
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
