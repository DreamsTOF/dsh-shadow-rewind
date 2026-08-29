/**
 * 对称模式（写入闸关闭）的恢复辅助：勾选路径 → 重新铸造一份只覆盖这些
 * 路径的恢复计划（planRestore 的 paths 过滤 + 全套安全闸原样保留），
 * 再由调用方用返回的 planId + confirmation 执行。两个恢复对话框共用。
 */

/** 服务端拒绝子集计划时的错误（code 用于区分 PLAN_STALE 等语义）。 */
export class SubsetPlanError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/**
 * 按预览请求的相同定位参数（sessionId&turn / sessionId&messageSeq）重新
 * 铸造只覆盖 `paths` 的计划。失败抛 SubsetPlanError。
 */
export async function fetchSubsetPlan(query: string, paths: readonly string[]): Promise<{ planId: string; confirmation: string }> {
  const url = `/shadow-rewind?${query}&details=1&paths=${encodeURIComponent(JSON.stringify(paths))}`
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
  const value: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const record = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown> : {}
    throw new SubsetPlanError(
      typeof record.code === 'string' ? record.code : 'REWIND_FAILED',
      typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`,
    )
  }
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : {}
  if (typeof record.planId !== 'string' || typeof record.confirmation !== 'string') {
    throw new SubsetPlanError('REWIND_FAILED', '恢复计划响应无效')
  }
  return { planId: record.planId, confirmation: record.confirmation }
}

/** URL 长度守卫：勾选过多时拒绝发起（避免请求行超限）。 */
export function pathsTooLong(paths: readonly string[]): boolean {
  return JSON.stringify(paths).length > 6000
}
