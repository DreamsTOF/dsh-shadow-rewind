/**
 * 文件开关（撤销/重做）的行级状态共享层。
 *
 * live 条的行内撤销按钮与审查界面的 hunk 撤销是**两个入口、同一事实**：
 * 任一侧执行 apply 后把结果写进这里，另一侧订阅变化并重查宿主真值，
 * 两侧内容因此保持同步（状态翻转为 undone ↔ applied）。
 *
 * 键 = `${sessionId}\0${canonicalKey(path, cwd)}`——物理文件唯一（绝对/相对、
 * `./`、反斜杠拼写差异在写入方带 cwd 时收敛到同键），消除「同一文件两种
 * 拼写导致翻转失效」。只存最近一次结果，不持久化（页面刷新后由审查界面的
 * 宿主巡检重建真值）。
 */
import type { FileReviewFileState } from '../file-review/change-types.ts'
import { canonicalKey, pathKey as normalizePath } from './path-keys.ts'

/** 一个路径的最新开关状态。 */
export type ReviewRowState = FileReviewFileState

const rows = new Map<string, ReviewRowState>()

const listeners = new Set<() => void>()

/**
 * 物理文件唯一键：传入 cwd 时用 canonicalKey（绝对/相对拼写收敛）；
 * cwd 缺失时退回路径归一（旧宿主/不可知 cwd 场景，语义不变）。
 */
function rowKey(sessionId: string, path: string, cwd: string | undefined): string {
  const normalized = cwd === undefined || cwd === '' ? normalizePath(path) : canonicalKey(path, cwd)
  return `${sessionId}\u0000${normalized}`
}

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * 写入一批开关结果（apply 的逐文件结果；status 巡检结果同形可用）。
 * 值全部相同（无变化）时不广播，避免订阅方空转。
 */
export function setReviewRows(
  sessionId: string,
  files: readonly { readonly path: string; readonly state: ReviewRowState }[],
  cwd?: string,
): void {
  let dirty = false
  for (const file of files) {
    const key = rowKey(sessionId, file.path, cwd)
    if (rows.get(key) === file.state) continue
    rows.set(key, file.state)
    dirty = true
  }
  if (dirty) notify()
}

/** 读一个路径的最新开关状态（缺省 = 未操作过）。 */
export function reviewRowOf(sessionId: string, path: string, cwd?: string): ReviewRowState | undefined {
  return rows.get(rowKey(sessionId, path, cwd))
}

/** 单一方向判定：已撤销（undone）→ redo，其余 → undo。
 * conflict/unsupported/error 条目保持 undo（真正执行时宿主会再校验）。 */
export function rowActionOf(state: ReviewRowState | undefined): 'undo' | 'redo' {
  return state === 'undone' ? 'redo' : 'undo'
}

/** 一个路径的下一个动作（reviewRowOf + rowActionOf 的封装，方便既有调用点）。 */
export function nextReviewAction(sessionId: string, path: string, cwd?: string): 'undo' | 'redo' {
  return rowActionOf(reviewRowOf(sessionId, path, cwd))
}

/** 订阅状态变化（live 条 / 审查界面据此刷新）。 */
export function subscribeReviewRows(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
