import { ShadowRewindError } from "./errors.js";
import { diffTrees } from "./manifest.js";
//#region src/engine-helpers.ts
/**
* 核心引擎·模块级纯函数工具。
*
* 摘要投影（summarize）、恢复计划的新鲜度断言与等价比较、路径深度排序键、
* 有界文件读取、检查点错误码分类。全部无状态：引擎类与其基类共享。
*/
/**
* 恢复点 vs 当前树的路径级差异（partial 感知）。
* 部分树（kind 'message' 的 BEFORE 兜底恢复点）只覆盖捕获到的路径：磁盘上
* 其余路径一律「不在恢复范围」——`added` 方向的变更仅对 createdPaths
* （捕获时不存在、此后被工具创建的路径）成立，绝不能把整个工作区当新增删掉。
*/
function diffAgainstManifest(manifest, currentEntries) {
	const changes = diffTrees(manifest.entries, currentEntries);
	if (manifest.partial !== true) return changes;
	const created = new Set(manifest.createdPaths ?? []);
	return changes.filter((change) => change.kind !== "added" || created.has(change.path));
}
/** Manifest → 对外摘要（RestorePointSummary）：条目明细不外泄，只留计数。 */
function summarize(manifest) {
	return {
		format: manifest.version,
		id: manifest.id,
		kind: manifest.kind,
		workspace: manifest.workspace,
		storage: manifest.storage,
		...manifest.sessionId === void 0 ? {} : { sessionId: manifest.sessionId },
		...manifest.label === void 0 ? {} : { label: manifest.label },
		...manifest.turn === void 0 ? {} : { turn: manifest.turn },
		...manifest.turnStartSeq === void 0 ? {} : { turnStartSeq: manifest.turnStartSeq },
		...manifest.phase === void 0 ? {} : { phase: manifest.phase },
		...manifest.intent === void 0 ? {} : { intent: manifest.intent },
		createdAt: manifest.createdAt,
		treeHash: manifest.treeHash,
		fileCount: manifest.fileCount,
		totalBytes: manifest.totalBytes,
		skippedPathCount: manifest.skippedPaths.length,
		restoreCount: manifest.restoreCount,
		...manifest.lastRestoredAt === void 0 ? {} : { lastRestoredAt: manifest.lastRestoredAt }
	};
}
/** 深拷贝计划：对外返回的 RestorePlan 必须与引擎内存态脱钩（防外部篡改）。 */
function structuredClonePlan(plan) {
	return JSON.parse(JSON.stringify(plan));
}
/** 执行恢复前复核：每条待恢复路径的当前磁盘条目必须仍与计划生成时一致。 */
function assertPlanFresh(plan, currentEntries) {
	for (const change of plan.changes) if (!entriesEquivalent(plan.expected[change.path] ?? null, currentEntries[change.path] ?? null)) throw new ShadowRewindError("PLAN_STALE", `路径在计划生成后又被修改：${JSON.stringify(change.path)}；请重新检查`);
}
/**
* 条目等价（内容寻址语义）：kind/mode 相同；file 比 blob+size；dir 只比
* kind（目录无内容）；symlink 比 target。用于恢复计划复核与 undo 的 CAS。
*/
function entriesEquivalent(left, right) {
	if (left === null || right === null) return left === right;
	if (left.kind !== right.kind || left.mode !== right.mode) return false;
	if (left.kind === "file" && right.kind === "file") return left.blob === right.blob && left.size === right.size;
	if (left.kind === "dir") return true;
	return left.kind === "symlink" && right.kind === "symlink" && left.target === right.target;
}
/** 路径深度（'/' 段数）：恢复时删除深层优先、写入浅层优先的排序键。 */
function depthOf(path) {
	return path.split("/").length;
}
/** 该目录路径下是否存在快照条目（隐式目录由子条目在恢复时重建）。 */
function hasDescendantEntry(manifest, path) {
	const prefix = `${path}/`;
	for (const other of Object.keys(manifest.entries)) if (other.startsWith(prefix)) return true;
	return false;
}
/** 有界读文件：精确读满 expectedSize（不足即视为变化中的文件，返回短读由上层重试）。 */
async function readFileBounded(handle, expectedSize) {
	const buffer = Buffer.allocUnsafe(expectedSize);
	let offset = 0;
	while (offset < buffer.length) {
		const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
		if (bytesRead === 0) break;
		offset += bytesRead;
	}
	return buffer.subarray(0, offset);
}
/** 自动检查点的失败中，哪些属于「可预期跳过」而非故障。 */
function isCheckpointSkipCode(code) {
	return code === "TURN_CHECKPOINT_DISABLED" || code === "TURN_CHECKPOINT_TIMEOUT" || code === "TURN_CHECKPOINT_NEW_CONTENT_LIMIT" || code === "SNAPSHOT_TOO_LARGE" || code === "TOO_MANY_FILES";
}
/** 把捕获期错误包装为超时（保持外层 deadline 的语义）。 */
function wrapCheckpointDeadline(error, timeoutMs, deadlineAborted) {
	if (deadlineAborted && !(error instanceof ShadowRewindError && error.code === "TURN_CHECKPOINT_TIMEOUT")) return new ShadowRewindError("TURN_CHECKPOINT_TIMEOUT", `自动检查点超出 ${String(timeoutMs)} ms`, { cause: error });
	return error;
}
//#endregion
export { assertPlanFresh, depthOf, diffAgainstManifest, entriesEquivalent, hasDescendantEntry, isCheckpointSkipCode, readFileBounded, structuredClonePlan, summarize, wrapCheckpointDeadline };
