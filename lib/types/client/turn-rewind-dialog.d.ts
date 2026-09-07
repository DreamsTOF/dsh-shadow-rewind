/**
 * 文件审查侧栏 tab·「从快照恢复此轮」对话框。
 *
 * 每轮头部按钮唤起，走本插件宿主的 /shadow-rewind?turn= 分支：预览 →
 * （对称模式）勾选子集 → POST 执行。全部状态自持（loading/preview/applying/
 * stale/error/done/selected），父组件只提供窗口统计与跳转回调。
 *
 * srw-* 对话框样式由本插件的会话回退面（rewind.ts）全局注入，直接复用，
 * 保证两个恢复入口的视觉与交互一致。
 */
import type { PathWindowStats } from './file-review-tab-types.ts';
export interface TurnRewindDialogProps {
    readonly sessionId: string;
    readonly turn: number;
    /** 恢复窗口（该轮起）内本会话对每个路径的累计 +/-；其它会话写入的路径没有
     * 客户端 diff 数据，因此没有条目（对话框里这些行不显示统计）。 */
    readonly windowStats: ReadonlyMap<string, PathWindowStats>;
    /** 点击某路径的 +/-：跳到该文件最近一轮的差异（父级负责关闭对话框）。 */
    readonly onJumpToDiff: (turn: number, path: string) => void;
    /** 其它会话 id → displayTitle（会话列表快照查不到时回落截断 id）。 */
    readonly sessionTitle: (id: string) => string | undefined;
    readonly onClose: () => void;
    /** 恢复成功后回调（刷新 tab 的状态巡检）。 */
    readonly onRestored: () => void;
}
/** `/shadow-rewind?turn=` 预览的浏览器侧形态（宽松解析）。 */
export interface TurnRewindPreview {
    readonly status: 'ready' | 'pending' | 'skipped' | 'failed' | 'missing';
    readonly checkpointId?: string;
    readonly planId?: string;
    /** 恢复语义模式：current-wins=以当前为准（整树），symmetric=对称（勾选式子集）。 */
    readonly mode?: 'current-wins' | 'symmetric';
    readonly totalChanges: number;
    readonly changes: readonly {
        readonly path: string;
        readonly kind: string;
        /** 对称模式归属：'target' | 'multi' | 'unknown' | 其它会话 id。 */
        readonly owner?: string;
        /** 对称模式默认勾选（只属于目标会话的路径）。 */
        readonly autoSelect?: boolean;
    }[];
    readonly activeSessionIds: readonly string[];
    readonly skippedPaths: readonly {
        readonly path: string;
        readonly reason: string;
    }[];
    readonly reason?: string;
    readonly error?: string;
    /** 分页（对称模式拉全清单时使用）。 */
    readonly truncated?: boolean;
    readonly offset?: number;
    /** 下一轮检查点 ID（本轮的变更 = 本轮轮起检查点与该检查点对比）。 */
    readonly nextCheckpointId?: string;
    /** 文件系统级别的变更（PowerShell 等终端命令创建/修改/删除的文件）。 */
    readonly fileSystemChanges?: readonly {
        readonly path: string;
        readonly kind: 'added' | 'modified' | 'deleted';
    }[];
}
/** 逐字段宽松解析宿主预览响应：任何形状偏差都退到安全缺省而非抛错。 */
export declare function decodeTurnPreview(value: unknown): TurnRewindPreview;
/** 快照跳过原因的用户文案。 */
export declare function skipReasonLabel(reason: string): string;
/** 快照差异类别的用户文案（与回退对话框的 kindLabel 语义一致）。 */
export declare function snapshotKindLabel(kind: string): string;
/** 按轮恢复对话框本体（状态机见文件头注释）。 */
export declare function TurnRewindDialog({ sessionId, turn, windowStats, onJumpToDiff, sessionTitle, onClose, onRestored }: TurnRewindDialogProps): import("react").JSX.Element;
