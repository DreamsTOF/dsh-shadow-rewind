/** 带稳定错误码的异常：HTTP 层据此映射状态码与用户文案，测试据此断言。 */
/**
 * 影子回退的全部可预期错误。
 * `code` 是跨版本稳定的机器标识（如 PLAN_STALE），消息仅用于人读。
 */
export declare class ShadowRewindError extends Error {
    readonly code: string;
    constructor(code: string, message: string, options?: {
        cause?: unknown;
    });
}
/** 把任意抛出值压成一条有界（2000 字符）的诊断文本。 */
export declare function errorMessage(error: unknown): string;
