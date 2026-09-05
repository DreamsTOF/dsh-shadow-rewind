import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client';
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives';
import type { ProducedFileDiff, ProducedFileReview } from '../file-review/change-types.ts';
export type { ProducedFileDiff, ProducedFileReview } from '../file-review/change-types.ts';
/** 同轮内的终端命令删掉了这个路径（仅展示，不能撤销）。 */
interface ProducedPath {
    readonly seq: number;
    readonly path: string;
    readonly diffs: readonly ProducedFileDiff[];
    readonly deleted?: true;
}
/** 针对某一 Turn 发布的不可变产出文件事实。 */
export interface DeliverablesTurnData {
    readonly produced: readonly ProducedPath[];
}
declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
    interface ConversationTurnDataMap {
        /** 这一 Turn 累积到的成功变更路径。 */
        deliverables: DeliverablesTurnData;
    }
}
/** One `tool/call` 的派生意图：路径 + 意图 hunks + 终端删除路径。 */
interface CallIntent {
    readonly path: string | null;
    /** 结果 meta 缺失时的回退 hunks（write/edit/str_replace_editor 的参数直译）。 */
    readonly intended: readonly ProducedFileDiff[];
    readonly deletions: readonly string[];
}
interface DeliverablesState extends DeliverablesTurnData {
    readonly turn: number;
    readonly calls: ReadonlyMap<string, CallIntent | null>;
}
/**
 * 某个收尾 Assistant 边界处可见的文件与审查 hunks。
 * @param data - 引擎为某一 Turn 发布的 Deliverables 数据。
 * @param seq - 收尾的 Assistant seq；在此之后的工具结算一律排除。
 * @returns 产出文件按首次出现顺序，同路径 hunks 按结算顺序追加。
 */
export declare function reviewsForClosing(data: Readonly<DeliverablesTurnData> | undefined, seq?: number): readonly ProducedFileReview[];
/**
 * 某个 Turn 数据值产出过的文件。
 *
 * 来源是变更工具自己的结果，不是收尾文风：无论模型有没有记得点名，产出过的
 * 文件都必须列出。变更靠工具名识别——`write` / `edit` / `str_replace_editor`
 * ——新变更工具只要声明自己的参数就能加入。读操作不产出任何东西（看看文件
 * 不算产出），删除与失败调用同样不算（删了就没东西可开了）。路径保持首次
 * 出现顺序且只出现一次，于是「同轮先写后改」的文件是单一条目。
 *
 * Turn 归属在函数运行前已由 Conversation Location 索引裁定，因此路径不会
 * 跨轮泄漏，这个推导也不必从相邻的展示节点反推边界。
 * @param data - 引擎为某一 Turn 发布的 Deliverables 数据。
 * @param seq - 收尾的 Assistant seq；在此之后的工具结算一律排除。
 * @returns 产出路径按首次出现顺序；这一轮什么都没写时返回空。
 */
export declare function producedForClosing(data: Readonly<DeliverablesTurnData> | undefined, seq?: number): readonly string[];
/**
 * 只有收尾轮真的产出过文件时才认领轮尾链。
 * @param owner - 收尾 assistant 的轮尾 owner 货币。
 * @returns 作为组件 match 的产出文件审查，或 null 表示在挂载前放弃认领。
 */
export declare function selectProducedFiles(owner: TurnTailOwnerProps): readonly ProducedFileReview[] | null;
/** Turn 局部的成功变更累积器；它不发布任何视图节点。 */
export declare const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState>;
/**
 * 路径末段——一眼就能认出文件的那一部分。
 * @param path - 用斜杠或反斜杠分隔的路径。
 * @returns 末段；没有分隔符时返回整串。
 */
export declare function basename(path: string): string;
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
