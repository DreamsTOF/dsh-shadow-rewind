/**
 * 就地遮蔽回退·客户端运行通道：经宿主同源 HTTP 端点执行，命令面已移除
 * （回退入口只保留 live 条 / 消息旁回退按钮 / 审计面板三处，聊天流不再出现
 * 命令行）。端点同步执行（宿主侧完成打断等待 + 追加遮蔽标记），返回即结果。
 *
 * 通道事实（0.1.2 客户端服务面，结构类型）：
 *  - chat 快照：`ctx.get('uiConversation')` 的 `binding(sessionId).target('chat')`
 *    `getSnapshot()`（同名 chat 视图由 dsh-client-ui-chat 贡献）——遮蔽后的
 *    座位行隐藏由 rewind.ts 的 applyHiddenSeats 依快照刷新；
 *  - composer 写：`ctx.get('conversation').input.for(sessions.scope(id)).setDraft`。
 */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
/** 一次就地遮蔽的完整结果（HTTP 同步返回）。 */
export type InplaceMaskResult = {
    readonly status: 'ok';
    readonly marker: number;
    readonly text?: string;
} | {
    readonly status: 'error';
    readonly text: string;
};
/** 当前 chat 快照（无视图/会话消失 → undefined，绝不抛）。 */
export declare function chatSnapshotOf(ctx: unknown, sessionId: string): ChatSnapshot | undefined;
/** 执行一次就地遮蔽（宿主 HTTP 端点）。结果以响应为准，网络失败归入 error。 */
export declare function runInplaceMask(sessionId: string, targetSeq: number, signal?: AbortSignal): Promise<InplaceMaskResult>;
