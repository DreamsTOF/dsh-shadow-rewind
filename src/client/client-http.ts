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
export const REWIND_BASE = '/shadow-rewind'

/** 带宿主错误码的请求异常。 */
export class HttpError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'HttpError'
    this.code = code
  }
}

/** 解析 {code,error} 信封：非 ok 响应抛 {@link HttpError}。 */
export async function readJson(response: Response): Promise<unknown> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new HttpError('REWIND_FAILED', `响应无效：${response.url}`)
  }
  if (!response.ok) {
    const record = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    throw new HttpError(
      typeof record.code === 'string' ? record.code : 'REWIND_FAILED',
      typeof record.error === 'string' ? record.error : `HTTP ${String(response.status)}`,
    )
  }
  return value
}

/** 恢复流程错误码 → 中文文案；未覆盖的码返回 undefined（调用方回落 error.message）。 */
export function rewindErrorText(code: string): string | undefined {
  switch (code) {
    case 'PLAN_STALE':
      return '项目文件在检查后又发生了变化。为避免覆盖新修改，请重新检查后再恢复。'
    case 'RESTORE_POINT_NOT_FOUND':
      return '没有找到对应的文件状态，可能已被清理。'
    case 'NO_CHANGES':
      return '项目文件已经是这条消息发送前的状态，无需恢复。'
    case 'RESTORE_FAILED_ROLLED_BACK':
      return '恢复未能完成，项目文件已自动还原到操作前的状态。'
    case 'CONVERSATION_REWIND_FAILED':
      return '文件已恢复，但无法创建新对话；项目文件已自动还原。'
    default:
      return undefined
  }
}

/** GET 一个 JSON（含非 ok 转 HttpError）。 */
export async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' })
  return readJson(response)
}
