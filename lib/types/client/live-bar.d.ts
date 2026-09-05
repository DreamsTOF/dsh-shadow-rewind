import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ISessions, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { UseChat } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { NS } from './chat-locales.ts';
/**
 * Owner share of the input-zone slot（dsh 0.1.2 `InputZone`：会话生命周期
 * 快照 + 输入机状态），外加 session 槽位的标准 props——`useChat` 由 ui-chat
 * 并入 SessionStandardProps，组件用它读取本会话的 Chat 快照（会话变更
 * 推导的数据源；旧 runtime 的 ConversationSnapshot 随包移除）。
 */
interface LiveBarOwner {
    readonly session: SessionSnapshot;
    readonly input: InputState;
}
export type LiveChangesBarProps = LiveBarOwner & {
    /** 框架解析出的会话标识（session 作用域槽位的标准 props）。 */
    readonly sessionId: SessionId;
    /** 选取当前 Conversation 绑定之 Chat 目标的 selector hook。 */
    readonly useChat: UseChat;
} & PropsLocale<typeof NS>;
/** 由 applyFileReview 调用一次，让 live 条能解析出会话工作区目录。 */
export declare function bindLiveBarSessions(sessions: ISessions): void;
/** 由 applyFileReview 调用一次，让点击行能在侧边栏打开审计。 */
export declare function bindLiveBarOpenSidebar(opener: (sessionId: string, paths: readonly string[], turn?: number) => void): void;
export declare function LiveChangesBar({ session, sessionId, useChat, t }: LiveChangesBarProps): import("react").JSX.Element | null;
export {};
