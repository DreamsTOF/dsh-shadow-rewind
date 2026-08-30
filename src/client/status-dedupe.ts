/**
 * Host 状态巡检（fileReview.status）的 in-flight 去重：同一（会话×请求）
 * 的并发巡检只发一次，所有调用方共享同一个结果。
 *
 * 背景：轮尾卡片的巡检 effect 过去按数组/函数身份声明依赖，上游 slot 每次
 * 渲染都换新身份，导致同内容的巡检反复重放（按钮禁用窗口随之反复出现）。
 * 除入口侧改为内容签名依赖外，这里在传输层再做一层「同请求合并」兜底。
 * apply 有副作用，绝不参与去重。
 */
import type { FileReviewRequest, FileReviewResult } from '../file-review/change-types.ts'

const inflight = new Map<string, Promise<FileReviewResult>>()

/** 请求签名：路径 + 两侧文本 + 行锚点全文参与（仅 in-flight 存活，即用即弃）。 */
function requestKey(sessionId: string, request: FileReviewRequest): string {
  return JSON.stringify([sessionId, request.action, request.files])
}

export function dedupeStatus(
  sessionId: string,
  request: FileReviewRequest,
  invoke: (request: FileReviewRequest) => Promise<FileReviewResult>,
): Promise<FileReviewResult> {
  const key = requestKey(sessionId, request)
  const existing = inflight.get(key)
  if (existing !== undefined) return existing
  const task = invoke(request).finally(() => { inflight.delete(key) })
  inflight.set(key, task)
  return task
}
