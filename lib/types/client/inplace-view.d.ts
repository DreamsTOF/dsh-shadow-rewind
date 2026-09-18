/**
 * 就地遮蔽回退·客户端纯计算（M3，移植 dsh-rewind/src/client/hidden.ts 语义）。
 *
 * 从 chat 快照推导需要从 transcript 隐藏的行 anchor seq 集：一次就地回退切一个
 * 区间 [目标消息 seq, 标记 seq]，落在区间内的行（含目标与区间内助手/工具行）
 * 全部遮蔽，使渲染对话与模型上下文一致。遮蔽标记（空 user/message +
 * surface replace）在 dsh 视图里不渲染成任何行（非 append surface、非 compact
 * 插件），聊天流天然没有命令行/标记行；区间信息由执行方经
 * {@link recordInplaceSpan} 写入本模块的持久化存储（localStorage，刷新后仍能
 * 隐藏已撤回的历史行）。
 *
 * 无 DOM、不订阅——纯函数 + 一个本地 span 存储，输入只有会话 id 与 chat 快照。
 * TODO: span 存在浏览器本地，换设备打开同一会话时被遮蔽行会重新可见（与
 * restore-records 同一天花板）；宿主在快照里透出 surfaceOp 后可改为纯派生。
 */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
/** 记录一次就地回退的隐藏区间（执行成功后调用；广播给座位行隐藏刷新）。 */
export declare function recordInplaceSpan(sessionId: string, start: number, end: number): void;
/** 订阅 span 变化（返回释放器）。 */
export declare function subscribeInplaceSpans(listener: () => void): () => void;
/**
 * 需要从 transcript 遮蔽的行 anchor seq 集合：落在任一回退区间
 * [目标, 标记] 内的行（含目标自身与区间内助手/工具行）一并隐藏。多个回退
 * 各自独立成区间，绝不合并（后一次回退到更晚的点会在两个区间之间留下仍属
 * surface 的新流量）。
 */
export declare function hiddenSeqsOf(sessionId: string, snap: ChatSnapshot): Set<number>;
/** 被就地遮蔽隐藏掉的 chat key 集合（seat 行按 key 判 hide）。 */
export declare function hiddenKeysOf(sessionId: string, snap: ChatSnapshot): Set<string>;
/** chat 中 seq 处的用户/插话消息全文（composer 回填用；无状态→undefined）。 */
export declare function messageTextAt(snap: ChatSnapshot, seq: number): string | undefined;
