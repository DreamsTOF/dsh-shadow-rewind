/**
 * AuditOverlay —— 文件审查的全屏界面（原侧边栏 tab 移除后的新家）。
 *
 * 参照 dsh-prompt-customizer 的 PanelShell 形态：**覆盖会话主区的右侧抽屉**，
 * 不再是居中弹窗——侧栏保持可点、可随时切会话；portal 到 document.body，
 * 避免宿主 React 树重建连带回收与 transform 祖先使 position:fixed 失效。
 *
 * 复用 FileReviewTab 的全部能力（逐轮 diff、hunk 级撤销/重做、每轮快照恢复、
 * 文件级时间线），入口在 live 条头部「审查」按钮（或点行深链到该文件）。
 * Esc / ✕ 关闭。
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
export declare function AuditOverlay({ ctx, sessionId, cwd, seedPaths, onClose }: AuditOverlayProps): React.ReactPortal;
