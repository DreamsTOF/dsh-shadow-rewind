/**
 * Session-wide produced-file derivation from a finalized ConversationSnapshot.
 * Client-only and model-free: the vocabulary is the mutation tools' own
 * follow-along `locations` and diff views, never the closing prose. This is
 * the sidebar-tab analogue of dsh-file-review's turn-deliverables.ts: instead
 * of a ConversationNodeDefinition accumulating one turn's data for the
 * turn-tail slot, it derives EVERY in-window turn's changes from the session
 * snapshot's finalized nodes, attributing each tool result to its owning
 * turn through `turnEnds` (completed turns) or the live turn counters.
 */
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client';
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
/** One changed file inside one turn, hunks appended in settlement order. */
export interface SessionFileChange extends FsAttributionFields {
    readonly path: string;
    readonly diffs: readonly ProducedFileDiff[];
    /** Terminal commands deleted this path in this turn (display-only). */
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
/** One turn's produced files, in first-seen order. */
export interface TurnFileChanges {
    readonly turn: number;
    /** Whether the owning turn is still running (its change set may grow). */
    readonly live: boolean;
    readonly files: readonly SessionFileChange[];
}
/**
 * Paths a call view reports having created or changed, by render intent
 * rather than tool name: a diff card, or a generic card whose kind is `edit`.
 * Mirrors dsh-file-review's producedPaths exactly (unknown-safe).
 */
export declare function producedPaths(view: unknown): readonly string[];
/** Validate diff hunks crossing the Host/browser transport (unknown-safe). */
export declare function producedDiffs(view: unknown): readonly ProducedFileDiff[];
/** Derive per-turn produced-file changes for one session snapshot. */
export declare function deriveSessionChanges(snapshot: ConversationSnapshot | null): TurnFileChanges[];
/**
 * One Code Mode (`run_code`) root visible in the snapshot, with the turn it
 * settles into. Children (`subCalls`) carry no reusable views, so the reset of
 * their review data arrives asynchronously from the Host recorder; these roots
 * are the join keys (the `run_code` `callId` is the dispatch `rootCallId`).
 */
export interface SessionRoot {
    readonly turn: number;
    readonly live: boolean;
    readonly rootCallId: string;
}
/** Every `run_code` tool-result node in the window, in node order. */
export declare function deriveSessionRoots(snapshot: ConversationSnapshot): SessionRoot[];
/**
 * Merge Host-recorded Code Mode mutations into the snapshot-derived turns:
 * hunks rebuilt from the full before/after are appended to the owning turn's
 * file groups (same-path entries stay one row, hunks appended in dispatch
 * order), so the tab's diff rendering, status inspection and undo all work on
 * programmatic edits exactly like model-direct ones. All inputs are immutable;
 * the result is a fresh array only when a recorded mutation matched a visible
 * root.
 */
export declare function mergeRecordedTurns(turns: readonly TurnFileChanges[], roots: readonly SessionRoot[], recorded: readonly RecordedMutation[]): readonly TurnFileChanges[];
/** Count distinct changed paths across every turn (the sidebar badge count). */
export declare function countChangedFiles(turns: readonly TurnFileChanges[]): number;
/** Trailing path segment, the part that identifies the file at a glance. */
export declare function basename(path: string): string;
/** Resolve a (possibly relative) tool path against the session cwd. */
export declare function resolveSessionPath(cwd: string | undefined, path: string): string;
