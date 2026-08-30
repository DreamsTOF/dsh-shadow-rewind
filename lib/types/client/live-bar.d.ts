import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ConversationSnapshot, ISessions } from '@deepseek-ai/dsh-client-runtime/client';
import type { NS } from './chat-locales.ts';
/** Owner share of the input-zone slots: point-in-time snapshots, re-rendered by the skeleton. */
interface LiveBarOwner {
    readonly session: ConversationSnapshot;
    readonly input: unknown;
}
export type LiveChangesBarProps = LiveBarOwner & PropsLocale<typeof NS>;
/** Called once from applyFileReview so the bar can resolve the session cwd. */
export declare function bindLiveBarSessions(sessions: ISessions): void;
/** Called once from applyFileReview so row clicks open the sidebar audit. */
export declare function bindLiveBarOpenSidebar(opener: (sessionId: string, paths: readonly string[], turn?: number) => void): void;
export declare function LiveChangesBar({ session, t }: LiveChangesBarProps): import("react").JSX.Element | null;
export {};
