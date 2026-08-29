import type { ProducedFileDiff as DiffHunk } from '../file-review/change-types.ts';
/** Locale labels required by the review diff. */
export interface UnifiedDiffLabels {
    readonly copy: string;
    readonly copied: string;
    readonly showUnchanged: (count: number) => string;
    readonly hideUnchanged: (count: number) => string;
    /** Hunk ordinal shown next to the selection checkbox ('块 {n}'). */
    readonly hunkN: (n: number) => string;
    /** Checkbox tooltip: checked hunks participate in undo/reapply. */
    readonly hunkInclude: string;
}
/** Added and removed line totals derived from the same hunks the viewer renders. */
export interface UnifiedDiffStats {
    readonly added: number;
    readonly removed: number;
}
interface UnifiedDiffProps {
    readonly diffs: readonly DiffHunk[];
    readonly contextLines: number;
    readonly labels: UnifiedDiffLabels;
    readonly className?: string | undefined;
    readonly showCopyButton?: boolean | undefined;
    readonly showFileHeaders?: boolean | undefined;
    /** 块级选择（可选）：提供后每个 hunk 上方渲染勾选框。 */
    readonly selectable?: boolean | undefined;
    /** 选中 hunk 的下标集合；undefined 表示隐式全选。 */
    readonly selectedHunks?: ReadonlySet<number> | undefined;
    readonly onSelectedHunksChange?: ((next: ReadonlySet<number>) => void) | undefined;
}
/** Serialize recorded hunks as one plain-text unified diff. */
export declare function unifiedDiffText(diffs: readonly DiffHunk[]): string;
/** Count added and removed lines using the viewer's exact line-diff algorithm. */
export declare function summarizeDiffs(diffs: readonly DiffHunk[]): UnifiedDiffStats;
/**
 * Render line-aligned hunks with a single gutter and expandable context gaps.
 * @param props - Unified diff data, locale labels, and presentation options.
 * @returns The line-numbered unified diff surface.
 */
export declare function UnifiedDiff({ diffs, contextLines, labels, className, showCopyButton, showFileHeaders, selectable, selectedHunks, onSelectedHunksChange, }: UnifiedDiffProps): import("react").JSX.Element | null;
export {};
