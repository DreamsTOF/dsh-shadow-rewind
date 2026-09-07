/**
 * 核心引擎·模块级纯函数工具。
 *
 * 摘要投影（summarize）、恢复计划的新鲜度断言与等价比较、路径深度排序键、
 * 有界文件读取、检查点错误码分类。全部无状态：引擎类与其基类共享。
 */

import { ShadowRewindError } from './errors.js'
import { diffTrees } from './manifest.js'
import type { Manifest, WorkspaceChange } from './types.js'
import type { RestorePlan, RestorePointSummary, SnapshotEntry } from './types.js'

/**
 * 恢复点 vs 当前树的路径级差异（partial 感知）。
 * 部分树（kind 'message' 的 BEFORE 兜底恢复点）只覆盖捕获到的路径：磁盘上
 * 其余路径一律「不在恢复范围」——`added` 方向的变更仅对 createdPaths
 * （捕获时不存在、此后被工具创建的路径）成立，绝不能把整个工作区当新增删掉。
 */
export function diffAgainstManifest(
  manifest: Manifest,
  currentEntries: Readonly<Record<string, SnapshotEntry>>,
): readonly WorkspaceChange[] {
  const changes = diffTrees(manifest.entries, currentEntries)
  if (manifest.partial !== true) return changes
  const created = new Set(manifest.createdPaths ?? [])
  return changes.filter((change) => change.kind !== 'added' || created.has(change.path))
}

/** Manifest → 对外摘要（RestorePointSummary）：条目明细不外泄，只留计数。 */
export function summarize(manifest: Manifest): RestorePointSummary {
  return {
    format: manifest.version,
    id: manifest.id,
    kind: manifest.kind,
    workspace: manifest.workspace,
    storage: manifest.storage,
    ...(manifest.sessionId === undefined ? {} : { sessionId: manifest.sessionId }),
    ...(manifest.label === undefined ? {} : { label: manifest.label }),
    ...(manifest.turn === undefined ? {} : { turn: manifest.turn }),
    ...(manifest.turnStartSeq === undefined ? {} : { turnStartSeq: manifest.turnStartSeq }),
    ...(manifest.phase === undefined ? {} : { phase: manifest.phase }),
    ...(manifest.intent === undefined ? {} : { intent: manifest.intent }),
    createdAt: manifest.createdAt,
    treeHash: manifest.treeHash,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    skippedPathCount: manifest.skippedPaths.length,
    restoreCount: manifest.restoreCount,
    ...(manifest.lastRestoredAt === undefined ? {} : { lastRestoredAt: manifest.lastRestoredAt }),
  }
}

/** 深拷贝计划：对外返回的 RestorePlan 必须与引擎内存态脱钩（防外部篡改）。 */
export function structuredClonePlan(plan: RestorePlan): RestorePlan {
  return JSON.parse(JSON.stringify(plan)) as RestorePlan
}

/** 执行恢复前复核：每条待恢复路径的当前磁盘条目必须仍与计划生成时一致。 */
export function assertPlanFresh(plan: RestorePlan, currentEntries: Readonly<Record<string, SnapshotEntry>>): void {
  for (const change of plan.changes) {
    const expected = plan.expected[change.path] ?? null
    const actual = currentEntries[change.path] ?? null
    if (!entriesEquivalent(expected, actual)) {
      throw new ShadowRewindError('PLAN_STALE', `路径在计划生成后又被修改：${JSON.stringify(change.path)}；请重新检查`)
    }
  }
}

/**
 * 条目等价（内容寻址语义）：kind/mode 相同；file 比 blob+size；dir 只比
 * kind（目录无内容）；symlink 比 target。用于恢复计划复核与 undo 的 CAS。
 */
export function entriesEquivalent(left: SnapshotEntry | null, right: SnapshotEntry | null): boolean {
  if (left === null || right === null) return left === right
  if (left.kind !== right.kind || left.mode !== right.mode) return false
  if (left.kind === 'file' && right.kind === 'file') return left.blob === right.blob && left.size === right.size
  if (left.kind === 'dir') return true
  return left.kind === 'symlink' && right.kind === 'symlink' && left.target === right.target
}

/** 路径深度（'/' 段数）：恢复时删除深层优先、写入浅层优先的排序键。 */
export function depthOf(path: string): number {
  return path.split('/').length
}

/** 该目录路径下是否存在快照条目（隐式目录由子条目在恢复时重建）。 */
export function hasDescendantEntry(manifest: Manifest, path: string): boolean {
  const prefix = `${path}/`
  for (const other of Object.keys(manifest.entries)) {
    if (other.startsWith(prefix)) return true
  }
  return false
}

/** 有界读文件：精确读满 expectedSize（不足即视为变化中的文件，返回短读由上层重试）。 */
export async function readFileBounded(handle: import('node:fs/promises').FileHandle, expectedSize: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(expectedSize)
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

/** 自动检查点的失败中，哪些属于「可预期跳过」而非故障。 */
export function isCheckpointSkipCode(code: string): boolean {
  return code === 'TURN_CHECKPOINT_DISABLED'
    || code === 'TURN_CHECKPOINT_TIMEOUT'
    || code === 'TURN_CHECKPOINT_NEW_CONTENT_LIMIT'
    || code === 'SNAPSHOT_TOO_LARGE'
    || code === 'TOO_MANY_FILES'
}

/** 把捕获期错误包装为超时（保持外层 deadline 的语义）。 */
export function wrapCheckpointDeadline(error: unknown, timeoutMs: number, deadlineAborted: boolean): unknown {
  if (deadlineAborted && !(error instanceof ShadowRewindError && error.code === 'TURN_CHECKPOINT_TIMEOUT')) {
    return new ShadowRewindError('TURN_CHECKPOINT_TIMEOUT', `自动检查点超出 ${String(timeoutMs)} ms`, { cause: error })
  }
  return error
}
