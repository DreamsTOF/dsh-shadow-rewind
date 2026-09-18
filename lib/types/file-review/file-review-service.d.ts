/**
 * 宿主半边的产出文本 diff 撤销 / 重做服务（工作区围栏内）。
 *
 * 三条并行的执行路径，共用同一套 applied / undone / conflict 状态模型：
 *  - **hunk 文本回放**：检查点 diff 派生的常规改动（含 Code Mode 嵌套写盘），
 *    逐 hunk 逆序回放 + 行锚点匹配 + 提交前 CAS 复核；
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
import type { FileReviewAction, FileReviewChange, FileReviewRequest, FileReviewResult } from './change-types.ts';
/**
 * 在内存里回放一个文件的完整 hunk 序列；任一 hunk 对不上就返回 null。
 * 导出是为了让单测直接断言「纯变换」这一段，不必走 IO。
 */
export declare function transformFile(text: string, file: FileReviewChange, action: FileReviewAction): string | null;
/** 文件审查服务选项。 */
export interface FileReviewServiceOptions {
    /** 存储根（shadow-rewind 存储根）：删除类 fs 撤销的安全网副本落在其下。 */
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
    /** 删除类 fs 撤销的安全网目录：<storageDir>/file-review/rescue/。 */
    private readonly rescueDir;
    constructor(ctx: Context, options?: FileReviewServiceOptions);
    /** 只巡检当前磁盘状态，不动任何文件（可并发）。 */
    status(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult>;
    /**
     * 在接收方 Agent 空闲时逐个开关「各自独立安全」的文件。
     * 逐文件串行而非并行：同一路径的两个动作交错会让 CAS 闸门失去意义。
     * 单个文件失败不影响其余文件——结果里逐条如实报告。
     * force（EXPECTED-DESIGN 1.2）：冲突弹窗授权「全部回滚」后为 true——
     * CAS 失配的条目强制覆盖（详见 applyOne / applyFsChange）。
     */
    apply(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult>;
}
