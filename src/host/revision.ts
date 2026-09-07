/**
 * 宿主适配层·工作区数据版本。
 *
 * 检查点捕获 / 恢复成功即递增；客户端 fs-changes 的 warm 缓存据此跳过
 * 无变化轮询。键为 canonical realpath。进程内计数即可：它只回答「变没变」，
 * 不需要跨进程唯一。
 *
 * 顺序约定（fs-changes 端点依赖）：调用方必须**先读 rev 再算清单**——
 * bump 是 fire-and-forget，反过来会产出「旧数据 + 新 rev」的响应，
 * 让客户端把旧数据当新鲜缓存。
 */

import { canonicalDirectory } from '../path-utils.js'

const workspaceRevisions = new Map<string, number>()

/** 递增工作区数据版本（canonical realpath 失败时静默忽略——无键可递增）。 */
export async function bumpWorkspaceRevision(cwd: string): Promise<void> {
  const key = await canonicalDirectory(cwd).catch(() => undefined)
  if (key === undefined) return
  workspaceRevisions.set(key, (workspaceRevisions.get(key) ?? 0) + 1)
}

/** 读取工作区数据版本（读不到 canonical 路径返回 0）。 */
export async function workspaceRevision(cwd: string): Promise<number> {
  const key = await canonicalDirectory(cwd).catch(() => undefined)
  return key === undefined ? 0 : workspaceRevisions.get(key) ?? 0
}
