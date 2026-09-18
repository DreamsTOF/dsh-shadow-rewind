//#region src/client/client-http.ts
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
const REWIND_BASE = "/shadow-rewind";
//#endregion
export { REWIND_BASE };
