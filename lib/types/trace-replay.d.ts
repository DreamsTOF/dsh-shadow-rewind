import type { TurnIntent } from './types.js';
/** 会话事件的最小结构面（与 rewind-host 的 SessionLogEvent / 本地 SessionEvent
 * 同形；data 收成 object 保证宿主各事件形态都可直接传入，内部再按字段取值）。 */
export interface TraceEvent {
    readonly type: string;
    readonly seq: number;
    readonly data: object;
}
/** 内容型变更工具名单（与宿主内置工具一致）。 */
export declare const MUTATING_CONTENT_TOOLS: ReadonlySet<string>;
/** 轨迹节点：一个 tool/call 边界（寻址单位 trace:<seq>）。 */
export interface TraceNode {
    readonly seq: number;
    readonly turn?: number;
    readonly step?: number;
    readonly callId?: string;
    readonly name: string;
    /** 目标路径（可解析出路径时）。 */
    readonly path?: string;
    /** 是否内容型变更工具。 */
    readonly mutating: boolean;
    /** 对应 tool/result 报告了失败。 */
    readonly error?: boolean;
}
/** 一条可重放的内容操作。 */
export interface TraceContentOp {
    readonly seq: number;
    readonly callId?: string;
    readonly tool: string;
    readonly path: string;
    readonly kind: 'write' | 'str-replace' | 'insert';
    readonly content?: string;
    readonly oldString?: string;
    readonly newString?: string;
    readonly replaceAll?: boolean;
    readonly insertLine?: number;
}
/** 区间 diff 的单个文件变更（before/after 为重放态全文）。 */
export interface TraceChange {
    readonly path: string;
    readonly kind: 'added' | 'modified' | 'deleted';
    readonly before: string | null;
    readonly after: string | null;
    readonly added?: number;
    readonly removed?: number;
}
export interface TraceRangeResult {
    readonly changes: readonly TraceChange[];
    readonly notes: readonly string[];
}
/** 安全解析 tool/call 的原始 JSON 参数串。 */
export declare function parseToolArguments(raw: string | undefined): Record<string, unknown> | null;
/** 从参数中提取目标路径（工具间字段名不同：write/edit 用 file_path，str_replace_editor 用 path）。 */
export declare function toolTargetPath(name: string, args: Record<string, unknown> | null): string | null;
/** tool/result 是否报告失败：顶层 error 或 message.content 首个块的 isError。 */
export declare function toolResultError(data: object): boolean;
/**
 * 采集一个回合窗口 (fromSeq, ∞) 内的内容型工具调用意图（轮末检查点摘要）。
 * 顺序保持 seq 升序；上限 cap 条（防巨型回合撑爆清单）。
 */
/** 时间线 span：会话事件投影为泳道节点（拖选时间线用）。
 * 借鉴 dsh-checkpoint-diff 的 spans 投影（Input/Model/Tools 三泳道）：
 * user→lane 0、assistant→lane 1、tool→lane 2；噪声 chunk 事件天然排除
 * （白名单投影）。 */
export interface TraceSpan {
    readonly seq: number;
    readonly kind: 'user' | 'assistant' | 'tool';
    readonly lane: 0 | 1 | 2;
    readonly name?: string;
    readonly path?: string;
    readonly mutating?: boolean;
    readonly error?: boolean;
}
/** 事件流 → 三泳道 spans（等宽投影的槽位序 = 数组序）。 */
export declare function traceSpans(events: readonly TraceEvent[]): TraceSpan[];
/** turn 边界（turn/start 事件 seq 列表）：时间线的刻度线。 */
export declare function turnBoundaries(events: readonly TraceEvent[]): number[];
export declare function collectTurnIntent(events: readonly TraceEvent[], fromSeq: number, cap?: number): TurnIntent[];
/** 全部 tool/call 边界 → 时间线节点（错误标记从配对 result 合并）。 */
export declare function traceNodes(events: readonly TraceEvent[]): TraceNode[];
/** 成功调用的内容操作序列（str_replace_editor 的 view 等只读命令不进队列）。 */
export declare function contentOps(events: readonly TraceEvent[]): {
    ops: readonly TraceContentOp[];
    notes: readonly string[];
};
/**
 * 任意两个轨迹节点 (fromSeq, toSeq] 的内容区间 diff（同一 LCS 引擎语义：
 * chronologically from → to，del = 会被带走的行，add = 会出现的行）。
 */
export declare function traceRangeDiff(events: readonly TraceEvent[], fromSeq: number, toSeq: number): TraceRangeResult;
