/**
 * ProducedFiles —— 一轮结束后收尾的审查卡片。路径与 hunks 一律来自变更工具
 * 的**结果**，绝不是收尾文风。
 *
 * 侧边栏 tab 移植：原先的 Review DRAWER（劫持宿主网格的细节列）已移除——它
 * 跟 better-sidebar 面板争同一块屏幕边缘。现在「审查」按钮与单文件 chip 改
 * 打开本插件的 better-sidebar `file-review` tab，把整轮路径（或点中的那一个
 * 路径）作为 `meta.expandPaths` 带上，tab 据此精确展开那些 diff。
 * 撤销/重新应用开关保持不变。
 */
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { FileReviewRequest, FileReviewResult } from '../file-review/change-types.ts';
import { type ProducedFileReview } from './turn-deliverables.ts';
import type { NS } from './chat-locales.ts';
/**
 * Registration-side helpers (dsh 0.1.2 起轮尾链槽位的 inject 为零参工厂，不
 * 再携带 sessionId——会话身份由组件的标准 props `sessionId` 提供，这里的
 * 回调都以 sessionId 为首参在调用点绑定）。
 */
export interface ProducedFilesInjected {
    /** 会话工作区根（预留字段；聊天卡片按工具原样展示路径）。 */
    projectRootFor: (sessionId: string) => string | undefined;
    inspectChanges: (sessionId: string, request: FileReviewRequest) => Promise<FileReviewResult>;
    applyChanges: (sessionId: string, request: FileReviewRequest) => Promise<FileReviewResult>;
    /**
     * 用给定路径预展开地打开本插件的侧边栏 tab（「审查」按钮传全部产出路径，
     * 单个文件 chip 传它自己的）。所属轮号随行，让 tab 只展开这一轮的行——在
     * 其它轮反复出现的路径在那里保持折叠。
     */
    openInSidebarTab: (sessionId: string, paths: readonly string[], turn?: number) => void;
}
/** 匹配到的文件审查，加上轮尾槽供给的 opener 与 locale。 */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile' | 'turn'> & {
    matched: readonly ProducedFileReview[];
    /** 框架解析出的会话标识（session 作用域槽位的标准 props）。 */
    sessionId: SessionId;
} & InjectFace<ProducedFilesInjected> & PropsLocale<typeof NS>;
/** 把一轮的产出文件渲染成摘要卡片，并提供打开侧边栏 tab 的入口。 */
export declare function ProducedFiles({ matched: matchedReviews, openFile, turn: turnLocation, sessionId, projectRootFor, inspectChanges: inspectChangesFor, applyChanges: applyChangesFor, openInSidebarTab: openInSidebarTabFor, t, }: ProducedFilesProps): import("react").JSX.Element;
