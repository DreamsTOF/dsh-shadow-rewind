import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
export { basename } from './path-keys.ts';
/** 同轮内产出过的一个路径（按首次出现）。 */
interface ProducedPath {
    readonly seq: number;
    readonly path: string;
}
/** 针对某一 Turn 发布的不可变产出文件事实（仅路径，供提及解析）。 */
export interface DeliverablesTurnData {
    readonly produced: readonly ProducedPath[];
}
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ConversationTurnDataMap {
        /** 这一 Turn 累积到的成功变更路径。 */
        deliverables: DeliverablesTurnData;
    }
}
interface DeliverablesState extends DeliverablesTurnData {
    readonly turn: number;
    readonly calls: ReadonlyMap<string, string | null>;
}
/**
 * 某个 Turn 数据值产出过的文件路径（首次出现顺序、去重）。
 *
 * 来源是变更工具自己的结果，不是收尾文风：无论模型有没有记得点名，产出过的
 * 文件都必须可被提及解析。读操作不产出任何东西，删除与失败调用同样不算。
 * @param data - 引擎为某一 Turn 发布的 Deliverables 数据。
 * @param seq - 收尾的 Assistant seq；在此之后的工具结算一律排除。
 */
export declare function producedForClosing(data: Readonly<DeliverablesTurnData> | undefined, seq?: number): readonly string[];
/**
 * 只有收尾轮真的产出过文件时才认领轮尾链。
 * @param owner - 收尾 assistant 的轮尾 owner 货币。
 * @returns 产出路径；无产出返回 null 表示在挂载前放弃认领。
 */
export declare function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null;
/** Turn 局部的成功变更路径累积器；它不发布任何视图节点。 */
export declare const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState>;
/**
 * 一轮产出路径之上的「文件提及」词汇，供收尾消息的行文使用：行内代码 token
 * 会打开它点名的文件。token 先按完整路径精确解析，再退而求其次——恰好等于
 * **唯一一个**产出路径的 basename。两个路径共用的 basename 保持惰性、绝不
 * 猜，于是提及链接永远不会打开错误的文件或 404。
 * @param paths - 本轮产出路径（工具顺序，已去重）。
 * @param openFile - 聊天视图的文件 opener。
 * @param label - 为已解析路径本地化可访问的打开标签。
 * @returns MarkdownText 消费的 resolver；完整路径乘在 `title` 上，与文件行
 * 上的 chip 用同一消歧标识。
 */
export declare function producedFileMentions(paths: readonly string[], openFile: (path: string) => void, label: (path: string) => string): MarkdownFileMentions;
