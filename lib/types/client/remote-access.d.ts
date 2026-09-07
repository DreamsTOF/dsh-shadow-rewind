/**
 * fileReview 远端命名空间的弹性访问层。
 *
 * 背景（inject 故障的根因）：客户端每个 Typert 命名空间是 cordis 服务
 * `remote.<namespace>`（api-gateway 的 RemoteNamespaceService 以此键注册），
 * `scope.remote.fileReview` 经 cordis traceable 代理解析该组合键——命名空间
 * 挂载丢失（`$mount` 失败 / fiber 被卸载）而声明仍在时，cordis 抛出
 * `cannot get property "remote.fileReview" without inject`。这里把「挂载」
 * 与「访问」收拢成一处：挂载幂等可重试；访问失败自动重挂一次再试，
 * 并把不可恢复的失败转译成可读的错误文案。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { FileReviewRequest, FileReviewResult, RecordedRequest, RecordedResult } from '../file-review/change-types.ts';
/** 浏览器半边需要的 fileReview 命名空间方法面。 */
export interface FileReviewRemote {
    status(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>;
    apply(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>;
    recorded(request: RecordedRequest): Promise<RemoteResult<RecordedResult>>;
}
/**
 * 幂等挂载 fileReview 远端贡献。并发调用共享同一任务；失败后允许再次调用
 * 重试（mountTask 复位）。
 */
export declare function mountFileReviewRemote(ctx: Context): Promise<void>;
export declare function disposeFileReviewRemote(): void;
/**
 * 解析会话 scope 的 fileReview 命名空间（带一次自愈重试）：
 * 首次访问失败即重挂贡献再取一次；仍失败返回 undefined。
 */
export declare function resolveFileReviewRemote(ctx: Context, sessionId: string): Promise<FileReviewRemote | undefined>;
/** fileReview/status|apply 的调用包装（结果 error 分支转译成异常）。 */
export declare function invokeFileReview(ctx: Context, sessionId: string, method: 'status' | 'apply', request: FileReviewRequest): Promise<FileReviewResult>;
/** fileReview/recorded 的调用包装（Code Mode 录制读取）。 */
export declare function invokeFileReviewRecorded(ctx: Context, sessionId: string, request: RecordedRequest): Promise<RecordedResult>;
