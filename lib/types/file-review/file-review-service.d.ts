/**
 * 宿主半边的产出文本 diff 撤销 / 重做服务（工作区围栏内）。
 *
 * 三条并行的执行路径，共用同一套 applied / undone / conflict 状态模型：
 *  - **hunk 文本回放**：工具结果视图与 Code Mode 录制的常规改动，逐 hunk
 *    逆序回放 + 行锚点匹配 + 提交前字节级 CAS 复核；
 *  - **fs 整文件形状**：检查点对比派生的终端写盘（新增 / 删除 / 纯权限位），
 *    天然互逆，无需回放；
 *  - **目录条目**：mkdir / rmdir 互逆，删除侧带「必须为空」闸门。
 *
 * 全局不变式：**绝不猜着改**。任何一侧对不上就报 `conflict` 或
 * `unsupported` 并原样不动；所有路径都被工作区围栏（realpath 解析后必须仍在
 * 会话 cwd 内）与符号链接拒绝共同约束。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { FileReviewAction, FileReviewChange, FileReviewRequest, FileReviewResult, RecordedMutation, RecordedRequest, RecordedResult } from './change-types.ts';
/**
 * 在内存里回放一个文件的完整 hunk 序列；任一 hunk 对不上就返回 null。
 * 导出是为了让单测直接断言「纯变换」这一段，不必走 IO。
 */
export declare function transformFile(text: string, file: FileReviewChange, action: FileReviewAction): string | null;
/** 录制持久化选项。 */
export interface FileReviewServiceOptions {
    /** 记录目录根（shadow-rewind 存储根）；缺省/空串时保持纯内存（不落盘）。 */
    readonly storageDir?: string;
}
/**
 * 以 `fileReview` 远端命名空间发布的宿主服务。
 *
 * 方法粒度刻意保持「一次请求 = 一批文件」：`status` 只读巡检，`apply` 在
 * 会话空闲窗口（`agent.runMaintenance`）里逐文件执行——绝不打断正在跑的
 * 回合，也绝不在请求内部并行（避免同一文件被两个动作交错）。
 */
export declare class FileReviewService extends TypertRemoteService {
    /** 每 agent 的 Code Mode（`run_code`）文件变更记录，按派发顺序。 */
    private readonly recordLog;
    /** 已完成懒加载的 agent（此后变更直写 recordLog 并调度落盘）。 */
    private readonly loadedAgents;
    /** 进行中的懒加载任务（recordMutation 与 recorded 共用，保证合并顺序）。 */
    private readonly loadingAgents;
    /** 懒加载完成前到达的变更缓冲；加载完成后按「磁盘在前、缓冲在后」合并。 */
    private readonly preLoad;
    /** 每 agent 的落盘防抖定时器。 */
    private readonly flushTimers;
    /** 每 agent 的串行化落盘链（防抖触发可能晚于前一次写入）。 */
    private readonly flushChains;
    /** 录制记录落盘目录；undefined = 纯内存模式（不落盘）。 */
    private readonly recordsDir;
    /** 删除类 fs 撤销的安全网目录：<storageDir>/file-review/rescue/。 */
    private readonly rescueDir;
    constructor(ctx: Context, options?: FileReviewServiceOptions);
    /** 为接收方 agent 追加一条嵌套（Code Mode）文件变更。 */
    recordMutation(agent: Agent, mutation: RecordedMutation): void;
    /** 返回被请求的那些 `run_code` 根调用所录制的变更（按派发顺序）。 */
    recorded(agent: Agent, request: RecordedRequest): Promise<RecordedResult>;
    /** 确保该 agent 的磁盘记录已合并进内存；并发调用共享同一个加载任务。 */
    private ensureLoaded;
    /** 从磁盘读入并与加载期间缓冲的变更合并（磁盘在前、缓冲在后）。 */
    private loadFromDisk;
    /** 调度一次防抖落盘；窗口内重复调用只保留一个定时器。 */
    private scheduleFlush;
    /** 接在前一次落盘之后串行执行，避免两次写入交错。 */
    private flushNow;
    /** 原子写入该 agent 的录制记录；超限时淘汰最旧条目并把内存态裁剪一致。 */
    private writeRecords;
    /** 只巡检当前磁盘状态，不动任何文件（可并发）。 */
    status(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult>;
    /**
     * 在接收方 Agent 空闲时逐个开关「各自独立安全」的文件。
     * 逐文件串行而非并行：同一路径的两个动作交错会让 CAS 闸门失去意义。
     * 单个文件失败不影响其余文件——结果里逐条如实报告。
     */
    apply(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult>;
}
