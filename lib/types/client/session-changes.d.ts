/**
 * 会话级的产出文件推导：从一个已定稿的 Chat 快照里算出每一轮改了什么。
 *
 * 纯客户端、与模型无关：词汇来源是变更工具自己的**结果**，绝不是收尾文风
 * 的文本。这是 turn-deliverables.ts 的侧边栏版本——那边用
 * ConversationNodeDefinition 为轮尾槽累加单轮数据，这里则是从会话快照的
 * 已定稿节点推导出**窗口内每一轮**的变更，并借 `turnEnds`（已完结轮）或
 * live 轮计数器把每个工具结果归到它所属的轮。
 *
 * dsh 0.1.2 迁移：快照换成 ChatSnapshot（Chat 目标的视图快照），节点数据从
 * `legacy` 兼容切片读取；工具路径与 hunks 来自节点的 `call`（原始参数）与
 * `meta`（dsh-tool-fs 落地的 presentationMeta.diffs）。
 */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { ProducedFileDiff, RecordedMutation } from '../file-review/change-types.ts';
/** 写盘归因关联到的命令执行窗口（闸关归因命令级时附带）。 */
export interface FsCommandRef {
    readonly tool: string;
    readonly callId?: string;
    readonly sessionId: string;
    readonly startedAt: number;
    readonly endedAt: number;
}
/** 写盘归因字段（仅闸关时宿主提供；开闸/旧宿主全部缺省）：
 * 'target' = 本会话，'multi' = 多会话，'unknown' = 不可知，其它 = 会话 id。 */
export interface FsAttributionFields {
    readonly owner?: string;
    /** 归属本会话 → true（默认勾选）；其它/歧义 → false（须显式勾选）。 */
    readonly autoSelect?: boolean;
    /** 归因置信层级：命令级 / 歧义 / 外部写入 / 窗口级 / 不可知。 */
    readonly attribution?: 'command' | 'ambiguous' | 'external' | 'window' | 'unknown';
    /** 归因到的命令执行窗口（仅 attribution === 'command' 时附带）。 */
    readonly command?: FsCommandRef;
    /** 当前内容的写入时间（快照 mtime，ms epoch；旧清单无此字段则缺省）。 */
    readonly writtenAt?: number;
}
/** 一轮里被改过的一个文件，hunks 按结算顺序追加。 */
export interface SessionFileChange extends FsAttributionFields {
    readonly path: string;
    readonly diffs: readonly ProducedFileDiff[];
    /** 本轮的终端命令删掉了这个路径（仅展示用，不能撤销）。 */
    readonly deleted?: true;
    /** 条目来源：'fs' = 检查点对比派生（终端写盘）；缺省 = 工具结果视图。 */
    readonly origin?: 'fs';
    /** 空目录条目（撤销语义是 mkdir/rmdir，不涉内容）。 */
    readonly dir?: true;
    /** 服务端预算的行数（fs 条目懒加载全文前的显示用；缺省按 diffs 汇总）。 */
    readonly counts?: {
        readonly added: number;
        readonly removed: number;
    };
}
/** 一轮的产出文件，按首次出现顺序。 */
export interface TurnFileChanges {
    readonly turn: number;
    /** 所属轮是否仍在运行（它的变更集还可能增长）。 */
    readonly live: boolean;
    readonly files: readonly SessionFileChange[];
}
/** 校验跨宿主/浏览器传输进来的 diff hunks（未知即拒绝，绝不猜）。 */
export declare function producedDiffs(meta: unknown): readonly ProducedFileDiff[];
/** 对某个会话快照推导逐轮产出文件变更（带缓存入口）。 */
export declare function deriveSessionChanges(snapshot: ChatSnapshot | null | undefined): TurnFileChanges[];
/**
 * 快照里可见的一个 Code Mode（`run_code`）根调用，连同它结算进的那一轮。
 * 子调用（`subCalls`）没有可复用的视图，它们的审查数据以异步方式从宿主
 * 录制器补充回来；这些根调用就是联接键——`run_code` 的 `callId` 正是派发的
 * `rootCallId`。
 */
export interface SessionRoot {
    readonly turn: number;
    readonly live: boolean;
    readonly rootCallId: string;
}
/** 窗口内的全部 `run_code` 工具结果节点，按节点顺序。 */
export declare function deriveSessionRoots(snapshot: ChatSnapshot): SessionRoot[];
/**
 * 把宿主录制到的 Code Mode 变更合并进快照推导出的各轮：由完整 before / after
 * 重建的 hunks 追加到所属轮的文件组里（同路径条目保持一行，hunks 按派发顺序
 * 追加），于是 tab 的 diff 渲染、状态巡检与撤销对程序化改动与模型直发完全
 * 同路。所有入参都不可变；只有某条录制变更匹配上了可见根调用时，结果才是
 * 新数组（否则原样返回，避免无谓重渲染）。
 */
export declare function mergeRecordedTurns(turns: readonly TurnFileChanges[], roots: readonly SessionRoot[], recorded: readonly RecordedMutation[]): readonly TurnFileChanges[];
/** 统计跨所有轮的被改路径去重数（侧边栏徽标就是这个数）。 */
export declare function countChangedFiles(turns: readonly TurnFileChanges[]): number;
/** 路径末段——一眼就能认出文件的那一部分。 */
export declare function basename(path: string): string;
/** 把（可能相对的）工具路径按会话工作区目录解析成展示路径。 */
export declare function resolveSessionPath(cwd: string | undefined, path: string): string;
