/** Shared wire vocabulary for inspecting and toggling one turn's text changes. */
/** One validated contextual diff hunk attached to a produced file. */
export interface ProducedFileDiff {
    readonly path: string;
    readonly oldText: string | null;
    readonly newText: string;
    readonly oldStart?: number | undefined;
    readonly newStart?: number | undefined;
    /** 检查点记录的旧侧权限位（fs 派生条目）；写回时原样恢复。 */
    readonly oldMode?: number | undefined;
    /** 检查点记录的新侧权限位（fs 派生条目）；重做时原样恢复。 */
    readonly newMode?: number | undefined;
}
/** One produced file and the applied hunks available for review. */
export interface ProducedFileReview {
    readonly path: string;
    readonly diffs: readonly ProducedFileDiff[];
    /**
     * The turn's terminal commands deleted this path (dsh has no delete-file
     * tool, so deletions arrive as parsed rm-family arguments). Deleted entries
     * carry no hunks, no undo, and no openable file — review-display vocabulary
     * only.
     */
    readonly deleted?: true;
    /** 条目来源：'fs' = 检查点对比派生（终端写盘）；缺省 = 工具结果视图。 */
    readonly origin?: 'fs';
    /** 空目录条目（检查点 dir 条目派生）：撤销语义是 mkdir/rmdir，不涉内容。 */
    readonly dir?: true;
    /** 服务端预算的行数（fs 条目懒加载全文前的显示用；缺省按 diffs 汇总）。 */
    readonly counts?: {
        readonly added: number;
        readonly removed: number;
    };
}
/** Direction requested by the produced-files toggle. */
export type FileReviewAction = 'undo' | 'redo';
/** One turn-scoped file supplied to the Host toggle service. */
export interface FileReviewChange {
    readonly path: string;
    readonly diffs: readonly ProducedFileDiff[];
    /**
     * 条目来源标记：'fs' 表示该条目由检查点对比派生（终端写盘），其撤销
     * 走宿主的 fs 语义（创建→删除、删除→写回）。缺省时宿主按 diff 形状
     * 识别（旧行为，兼容旧 bundle）；显式标记消除了「write 创建的文件」
     * 与「fs 派生条目」在形状上的歧义。
     */
    readonly origin?: 'fs';
    /**
     * 空目录条目方向标记：'added' = 本轮新建的目录（撤销=删空目录），
     * 'deleted' = 本轮删除的目录（撤销=重建）。走宿主目录语义，不涉内容。
     */
    readonly dirKind?: 'added' | 'deleted';
}
/** Host request for status inspection or one toggle direction. */
export interface FileReviewRequest {
    readonly action: FileReviewAction;
    readonly files: readonly FileReviewChange[];
}
/** Current relationship between a file and the recorded turn change. */
export type FileReviewFileState = 'applied' | 'undone' | 'conflict' | 'unsupported' | 'error';
/** Per-file result; a request never hides skipped or failed files. */
export interface FileReviewFileResult {
    readonly path: string;
    readonly state: FileReviewFileState;
    readonly changed: boolean;
    readonly reason?: string | undefined;
}
/** Complete result returned by both Host endpoints. */
export interface FileReviewResult {
    readonly files: readonly FileReviewFileResult[];
}
/**
 * One mutation a Code Mode `run_code` program dispatched to a file-editing
 * tool, captured host-side with the FULL before/after content. The wire views
 * (diff cards) only ride model-direct tool/call frames; nested dispatches
 * carry neither a view nor hunks, so review of programmatic edits must
 * reconstruct the diff from these two snapshots instead.
 */
export interface RecordedMutation {
    /** The `run_code` call that owns this dispatch (its `callId`). */
    readonly rootCallId: string;
    /** The dispatched tool name (`edit`, `write`, …). */
    readonly name: string;
    /** Display path the tool reported; resolved against the session cwd. */
    readonly path: string;
    /** Full file content before the mutation; `null` when the file was created. */
    readonly before: string | null;
    /** Full file content after the mutation. */
    readonly after: string;
}
/** Host request for the recorded Code Mode mutations of one session. */
export interface RecordedRequest {
    /** Root (`run_code`) call-ids whose recorded mutations are wanted. */
    readonly rootCallIds: readonly string[];
}
/** Host response: every requested root's mutations, in dispatch order. */
export interface RecordedResult {
    readonly mutations: readonly RecordedMutation[];
}
