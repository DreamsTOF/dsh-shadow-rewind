/**
 * 客户端 HTTP/错误收口（批次二 T5）：
 *  - {@link REWIND_BASE}：本插件宿主端点的基路径单一常量（此前 6+ 文件各自
 *    硬编码 '/shadow-rewind'）；
 *  - {@link HttpError}：带宿主错误码的请求异常（{code,error} 信封解析）；
 *  - {@link rewindErrorText}：恢复流程错误码 → 中文文案的单一映射（此前
 *    rewind.friendlyError / previewHttpMessage / preview-http 各写一份）。
 * 语义默认「保底 error.message」：映射表未覆盖的码返回 undefined，由调用方
 * 回落宿主原文。
 */
/** 本插件宿主端点基路径（单一事实；所有客户端 fetch 均应由此拼接）。 */
export declare const REWIND_BASE = "/shadow-rewind";
/** 带宿主错误码的请求异常。 */
export declare class HttpError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** 解析 {code,error} 信封：非 ok 响应抛 {@link HttpError}。 */
export declare function readJson(response: Response): Promise<unknown>;
/** 恢复流程错误码 → 中文文案；未覆盖的码返回 undefined（调用方回落 error.message）。 */
export declare function rewindErrorText(code: string): string | undefined;
/** GET 一个 JSON（含非 ok 转 HttpError）。 */
export declare function getJson(path: string): Promise<unknown>;
