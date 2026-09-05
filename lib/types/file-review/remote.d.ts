/**
 * 浏览器半边的 Typert 贡献 —— 为宿主的文件审查服务声明远端调用面。
 *
 * `status` / `apply` / `recorded` 三个方法在这里只做**类型登记**：模块增强
 * 把 `fileReview` 命名空间挂进 `TypertRemoteNamespaceMap` 与 scope 映射表，
 * 浏览器因此拿到强类型的远端调用签名；真正的实现在宿主半边
 * （`file-review-service.ts`），两端靠 `typert-descriptors.ts` 里同一份
 * 描述符对齐。
 */
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import type { FileReviewRequest, FileReviewResult, RecordedRequest, RecordedResult } from './change-types.ts';
declare module '@deepseek-ai/dsh-typert-protocol' {
    interface TypertRemoteNamespaceMap {
        fileReview: {
            status: (agentId: SessionId, request: FileReviewRequest) => Promise<RemoteResult<FileReviewResult>>;
            apply: (agentId: SessionId, request: FileReviewRequest) => Promise<RemoteResult<FileReviewResult>>;
            recorded: (agentId: SessionId, request: RecordedRequest) => Promise<RemoteResult<RecordedResult>>;
        };
    }
    interface TypertRemoteMap {
        'fileReview/status': (agentId: SessionId, request: FileReviewRequest) => Promise<RemoteResult<FileReviewResult>>;
        'fileReview/apply': (agentId: SessionId, request: FileReviewRequest) => Promise<RemoteResult<FileReviewResult>>;
        'fileReview/recorded': (agentId: SessionId, request: RecordedRequest) => Promise<RemoteResult<RecordedResult>>;
    }
    interface TypertRemoteScopeMap {
        'agent:fileReview/status': (request: FileReviewRequest) => Promise<RemoteResult<FileReviewResult>>;
        'agent:fileReview/apply': (request: FileReviewRequest) => Promise<RemoteResult<FileReviewResult>>;
        'agent:fileReview/recorded': (request: RecordedRequest) => Promise<RemoteResult<RecordedResult>>;
    }
}
/** 随客户端 bundle 分发的远端贡献声明。 */
export declare const TYPERT_REMOTE: TypertRemoteContribution;
export default TYPERT_REMOTE;
