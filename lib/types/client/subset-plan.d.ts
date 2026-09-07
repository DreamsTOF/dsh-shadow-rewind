/**
 * 对称模式（写入闸关闭）的恢复辅助：勾选路径 → 重新铸造一份只覆盖这些
 * 路径的恢复计划（planRestore 的 paths 过滤），再由调用方用返回的 planId
 * 执行。两个恢复对话框共用。确认串已废除（EXPECTED-DESIGN 1.4 #2），
 * 「确认」由 GUI 弹窗承担。
 */
/** 服务端拒绝子集计划时的错误（code 用于区分 PLAN_STALE 等语义）。 */
export declare class SubsetPlanError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/**
 * 按预览请求的相同定位参数（sessionId&turn / sessionId&messageSeq）重新
 * 铸造只覆盖 `paths` 的计划。失败抛 SubsetPlanError。
 *
 * 注意：不带 `details=1`——服务端把 detailsOnly 请求当「纯详情预览」早退，
 * 永远不铸计划；带 paths 的计划请求必须让服务端走到 planRestore。
 */
export declare function fetchSubsetPlan(query: string, paths: readonly string[]): Promise<{
    planId: string;
}>;
/** URL 长度守卫：勾选过多时拒绝发起（避免请求行超限）。 */
export declare function pathsTooLong(paths: readonly string[]): boolean;
