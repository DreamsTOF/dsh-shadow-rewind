/**
 * 对称模式（写入闸关闭）的恢复辅助：勾选路径 → 重新铸造一份只覆盖这些
 * 路径的恢复计划（planRestore 的 paths 过滤 + 全套安全闸原样保留），
 * 再由调用方用返回的 planId + confirmation 执行。两个恢复对话框共用。
 */
/** 服务端拒绝子集计划时的错误（code 用于区分 PLAN_STALE 等语义）。 */
export declare class SubsetPlanError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/**
 * 按预览请求的相同定位参数（sessionId&turn / sessionId&messageSeq）重新
 * 铸造只覆盖 `paths` 的计划。失败抛 SubsetPlanError。
 */
export declare function fetchSubsetPlan(query: string, paths: readonly string[]): Promise<{
    planId: string;
    confirmation: string;
}>;
/** URL 长度守卫：勾选过多时拒绝发起（避免请求行超限）。 */
export declare function pathsTooLong(paths: readonly string[]): boolean;
