/**
 * 文件审查的线上词汇表 —— 宿主半边与浏览器半边共用的「一轮文本变更」协议。
 *
 * 这一层只描述**线上形状**，不含任何宿主逻辑：三种条目来源（工具结果视图 /
 * 检查点对比派生的 fs 条目 / Code Mode 录制）在这里被压成同一个
 * `ProducedFileReview`，浏览器据此渲染，宿主据此撤销。
 *
 * 语义约束：撤销是**文本回放**（逐 hunk 逆序 + 行锚点 + 提交前 CAS 复核），
 * 因此每个 hunk 必须自带足够的上下文（`oldText` / `newText` 与起止行）；
 * 缺失即判定为 `unsupported`，绝不猜着改。fs 派生条目另带权限位与目录标记，
 * 走宿主的 mkdir/rmdir 语义而非文本回放。
 */
/** 一个已校验的上下文 diff 块（hunk），挂在某个产出文件上。 */
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
/** 一个产出文件，以及它身上可供审查的全部已应用 hunk。 */
export interface ProducedFileReview {
    readonly path: string;
    readonly diffs: readonly ProducedFileDiff[];
    /**
     * 本轮的终端命令删掉了这个路径（dsh 没有「删除文件」工具，删除只能从
     * 解析出的 rm 系列参数里认出来）。删除条目没有 hunk、不能撤销、也不能
     * 在编辑器里打开——纯粹是审查展示用的词汇。
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
/** 产出文件开关请求的方向：撤销（回到变更前）或重做（重新应用）。 */
export type FileReviewAction = 'undo' | 'redo';
/** 交给宿主开关服务的一个轮内文件。 */
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
/** 对宿主的状态巡检请求，或一次带方向的开关请求。 */
export interface FileReviewRequest {
    readonly action: FileReviewAction;
    readonly files: readonly FileReviewChange[];
}
/** 一个文件与「本轮录制到的变更」之间的当前关系。
 * `conflict` / `unsupported` / `error` 都表示「没动它」——绝不猜着改。 */
export type FileReviewFileState = 'applied' | 'undone' | 'conflict' | 'unsupported' | 'error';
/** 单文件结果：一次请求永不隐藏被跳过或失败的文件，全部如实带回。 */
export interface FileReviewFileResult {
    readonly path: string;
    readonly state: FileReviewFileState;
    readonly changed: boolean;
    readonly reason?: string | undefined;
}
/** 两个宿主端点（status / apply）返回的完整结果。 */
export interface FileReviewResult {
    readonly files: readonly FileReviewFileResult[];
}
/**
 * Code Mode（`run_code`）程序向文件编辑工具派发的一次变更，在宿主侧连同
 * **完整 before / after 内容**一起录制下来。
 *
 * 为什么必须录全文：线上视图（diff 卡片）只挂在模型直发的 tool/call 帧上，
 * 嵌套派发既不带视图也没有 hunk——想审查程序化改动，只能从这两份快照反
 * 推出 diff。
 */
export interface RecordedMutation {
    /** 拥有这次派发的 `run_code` 调用（其 `callId`）。 */
    readonly rootCallId: string;
    /** 被派发的工具名（`edit` / `write` 等）。 */
    readonly name: string;
    /** 工具上报的展示路径；按会话 cwd 解析。 */
    readonly path: string;
    /** 变更前的完整文件内容；文件是新建时为 `null`。 */
    readonly before: string | null;
    /** 变更后的完整文件内容。 */
    readonly after: string;
}
/** 宿主侧请求：取某个会话录制到的 Code Mode 变更。 */
export interface RecordedRequest {
    /** 想要其录制变更的根（`run_code`）call-id 列表。 */
    readonly rootCallIds: readonly string[];
}
/** 宿主侧响应：每个被请求根调用的变更，按派发顺序排列。 */
export interface RecordedResult {
    readonly mutations: readonly RecordedMutation[];
}
