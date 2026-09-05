import type { ProducedFileDiff as DiffHunk } from '../file-review/change-types.ts';
/** 审查 diff 需要的本地化标签（由宿主从字典注入）。 */
export interface UnifiedDiffLabels {
    readonly copy: string;
    readonly copied: string;
    readonly showUnchanged: (count: number) => string;
    readonly hideUnchanged: (count: number) => string;
    /** 显示在勾选框旁的 hunk 序数（「块 {n}」）。 */
    readonly hunkN: (n: number) => string;
    /** 勾选框的提示：被勾选的 hunk 才参与撤销/重新应用。 */
    readonly hunkInclude: string;
}
/** 与视图渲染同一 hunk 源推导出的增/删行数合计。 */
export interface UnifiedDiffStats {
    readonly added: number;
    readonly removed: number;
}
/** UnifiedDiff 的入参。 */
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
    /** 修改点跳转（可选）：渲染 ↑/↓ 导航 + 挂载时自动定位首个变更块。
     * 长 diff 的滚动刚需（借鉴 dsh-checkpoint-diff 的块级跳转 UX）。 */
    readonly navigation?: boolean | undefined;
}
/** 把录制的 hunks 序列化成一段纯文本 unified diff（复制按钮的输出）。 */
export declare function unifiedDiffText(diffs: readonly DiffHunk[]): string;
/** 用与视图完全相同的行级 diff 算法统计增/删行数（与渲染零偏差）。 */
export declare function summarizeDiffs(diffs: readonly DiffHunk[]): UnifiedDiffStats;
/**
 * 渲染带单一行号槽 + 可展开上下文 gap 的行对齐 hunks。
 * @param props - unified diff 数据、本地化标签与展示选项。
 * @returns 带行号的 unified diff 视图。
 */
export declare function UnifiedDiff({ diffs, contextLines, labels, className, showCopyButton, showFileHeaders, selectable, selectedHunks, onSelectedHunksChange, navigation, }: UnifiedDiffProps): import("react").JSX.Element | null;
export {};
