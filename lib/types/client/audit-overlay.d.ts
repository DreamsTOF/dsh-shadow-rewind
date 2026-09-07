/**
 * AuditOverlay —— 文件审查的全屏对话框界面（侧边栏 tab 移除后的新家）。
 *
 * 复用 FileReviewTab 的全部能力（逐轮 diff、hunk 级撤销/重做、每轮快照恢复），
 * 只是外壳从 better-sidebar tab 换成独立的模态对话框：入口在 live 条头部
 * 按钮（或点行深链到该文件的展开态）。回退遮罩点击关闭。
 *
 * 状态同步：FileReviewTab 的开关结果经 review-state 广播，live 条行内按钮
 * 随之翻转；反向（live 条行内撤销）也经同一存储回到本界面（订阅 → 重巡检）。
 */
import * as React from 'react';
import type { Context } from '@deepseek-ai/cordis';
export interface AuditOverlayProps {
    readonly ctx: Context;
    readonly sessionId: string;
    readonly cwd: string | undefined;
    /** 从 live 条某行点入时预展开的路径（深链）。 */
    readonly seedPaths?: readonly string[];
    readonly onClose: () => void;
}
export declare function AuditOverlay({ ctx, sessionId, cwd, seedPaths, onClose }: AuditOverlayProps): React.DetailedReactHTMLElement<{
    className: string;
    role: "dialog";
    'aria-modal': "true";
    onClick: (event: React.MouseEvent) => void;
}, HTMLElement>;
