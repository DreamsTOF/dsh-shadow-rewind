/** Host-side, workspace-contained undo / redo service for produced text diffs. */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { FileReviewAction, FileReviewChange, FileReviewRequest, FileReviewResult, RecordedMutation, RecordedRequest, RecordedResult } from './change-types.ts';
/** Apply a complete file's hunk sequence in memory, or report a strict mismatch. */
export declare function transformFile(text: string, file: FileReviewChange, action: FileReviewAction): string | null;
/** 录制持久化选项。 */
export interface FileReviewServiceOptions {
    /** 记录目录根（shadow-rewind 存储根）；缺省/空串时保持纯内存（不落盘）。 */
    readonly storageDir?: string;
}
/** Host service published as the `fileReview` Remote namespace. */
export declare class FileReviewService extends TypertRemoteService {
    /** Per-agent record of Code Mode (`run_code`) file mutations, dispatch order. */
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
    private readonly recordsDir;
    constructor(ctx: Context, options?: FileReviewServiceOptions);
    /** Append one nested (Code Mode) file mutation for the receiving agent. */
    recordMutation(agent: Agent, mutation: RecordedMutation): void;
    /** Return the recorded mutations for the requested `run_code` roots. */
    recorded(agent: Agent, request: RecordedRequest): Promise<RecordedResult>;
    private ensureLoaded;
    private loadFromDisk;
    private scheduleFlush;
    private flushNow;
    private writeRecords;
    /** Inspect current disk state without changing files. */
    status(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult>;
    /** Toggle every independently safe file while the receiving Agent is idle. */
    apply(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult>;
}
//# sourceMappingURL=file-review-service.d.ts.map