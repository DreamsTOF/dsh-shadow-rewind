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
import type { ProducedFileDiff, ProducedFileReview, RecordedMutation } from '../file-review/change-types.ts';
import { type RewoundMark } from './rewound-changes.ts';
/** 窗口归属字段（检查点网格推导，勾选清单的建议标签）：
 * 'target' = 本会话，'multi' = 多会话，'unknown' = 不可知，其它 = 会话 id。 */
export interface FsAttributionFields {
    readonly owner?: string;
    /** 归属本会话 → true（默认勾选）；其它/歧义 → false（须显式勾选）。 */
    readonly autoSelect?: boolean;
}
/** 一轮里被改过的一个文件，hunks 按结算顺序追加。 */
export interface SessionFileChange extends FsAttributionFields {
    readonly path: string;
    readonly diffs: readonly ProducedFileDiff[];
    /** fs 删除条目（检查点对比 kind='deleted'）：展示为全红，撤销=写回旧内容。 */
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
    /** 条目内最后一个工具结果节点的事件 seq（回滚遮蔽的判别基准；录制条目缺省）。 */
    readonly lastSeq?: number;
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
/**
 * 回滚遮蔽过滤：把「磁盘上已不存在」的条目从轮列表里扣掉（live 条的会话
 * 累计视图与徽标共用）。规则见 rewound-changes.ts——条目 lastSeq ≤ 标记
 * 屏障且路径被恢复即遮蔽；没有 lastSeq 的条目（纯录制合入）一律放行。
 */
export declare function filterRewoundTurns(turns: readonly TurnFileChanges[], marks: readonly RewoundMark[]): readonly TurnFileChanges[];
/** 统计跨所有轮的被改路径去重数（侧边栏徽标就是这个数）。 */
export declare function countChangedFiles(turns: readonly TurnFileChanges[]): number;
/**
 * 单一「可撤销」判定（H1 归一）：轮尾卡片与侧栏 tab 共用同一份条件集，
 * 不再各自维护——mode-only fs 条目、fs 整文件形状（added/deleted）、目录
 * 条目、完整可回放的 hunk 序列，四种可逆形态只在这里写一遍。
 */
export declare function reversibleOf(file: {
    readonly path: string;
    readonly diffs: readonly ProducedFileDiff[];
    readonly origin?: 'fs';
    readonly dir?: boolean;
}): boolean;
/** 路径末段——一眼就能认出文件的那一部分。 */
export declare function basename(path: string): string;
/**
 * J4：列表层路径比较键——反斜杠统一成正斜杠。工具参数可能是 Windows
 * 反斜杠相对路径，fs 条目恒为正斜杠（服务端 path-utils 语义）；裸 ===
 * 会把同一文件劈成两行、+/− 统计减半。大小写不折叠：POSIX 区分大小写，
 * 误并两个文件比漏并一个更危险。
 */
export declare function pathKey(path: string): string;
/** 把（可能相对的）工具路径按会话工作区目录解析成展示路径。 */
export declare function resolveSessionPath(cwd: string | undefined, path: string): string;
/**
 * 合并工具侧条目与检查点 fs 条目为「每路径一行」，轮尾卡片与 live 条共用。
 *
 * 路径键用 pathKey 归一（J4：Windows 反斜杠与 fs 正斜杠是同一文件）。工具
 * 条目优先——它带着精确 hunk，也是「回滚本轮 AI 更改」的范围来源；仅当工具
 * 条目不可逆（典型：本轮新建 write(oldText=null) 后同轮又被 edit 修改，混合
 * hunk 宿主无法回放、+/− 也虚增成 +6 −3）而存在检查点 fs 条目时，改用 fs
 * 净条目：它的计数是「本轮相对轮起的净变化」（新建 = 最终行数而非 hunk 累加），
 * 撤销语义也正确（新建撤销 = 删除文件）。
 */
export declare function mergeToolFsEntries(tool: readonly ProducedFileReview[], fs: readonly ProducedFileReview[]): readonly ProducedFileReview[];
