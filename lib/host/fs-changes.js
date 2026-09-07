import { errorMessage } from "../errors.js";
import { isWithin } from "../path-utils.js";
import { attributePaths, serializeOwner } from "../attribution.js";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { diffLines } from "diff";
//#region src/host/fs-changes.ts
/**
* 宿主适配层·fs-changes 的服务端计算：行数统计 + 轮配对 diff + 窗口归属。
*
* 轮次配对与 live-tail 的两侧内容宿主本来就持有（检查点 blob / live 扫描读
* 盘），在服务端把 added/removed 算好随响应下发——过去客户端为渲染 +/− 要
* 把每个文件的新旧全文各拉一遍，一轮 30 个文件就是 60 个请求。
*
* 本文件的共享助手 {@link computeTurnFsChanges} 同时服务两个端点
* （/shadow-rewind 预览与 /shadow-rewind/fs-changes），配对轮与 live-tail
* 不再各持一份拷贝。
*/
/** 行数统计的单侧字节上限：超出视为统计不可得（数量级保护，非语义边界）。 */
const DIFF_COUNT_MAX_BYTES = 2097152;
/** 往返校验解码：非 UTF-8 内容按「统计不可得」处理（返回 null），绝不猜着算。 */
function decodeUtf8(bytes) {
	const text = bytes.toString("utf8");
	return Buffer.from(text, "utf8").equals(bytes) ? text : null;
}
/** 有界并发执行：保持结果与 tasks 输入同序，任意失败照常上抛。 */
async function runLimited(tasks, limit) {
	const results = new Array(tasks.length);
	let next = 0;
	const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
		while (next < tasks.length) {
			const index = next;
			next += 1;
			const task = tasks[index];
			if (task !== void 0) results[index] = await task();
		}
	});
	await Promise.all(workers);
	return results;
}
/** LF 计行：空串 0 行；最后一个换行后无内容不虚增一行。 */
function countLines(text) {
	if (text === "") return 0;
	let count = 0;
	for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) count += 1;
	return text.endsWith("\n") ? count : count + 1;
}
/** 行数按 LF 规范化统计：CRLF 文件不会产生幽灵增删。 */
function lineCounts(before, after) {
	let added = 0;
	let removed = 0;
	for (const part of diffLines(before.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), after.replace(/\r\n/g, "\n").replace(/\r/g, "\n"))) if (part.added === true) added += part.count ?? 0;
	else if (part.removed === true) removed += part.count ?? 0;
	return {
		added,
		removed
	};
}
/** 「读当前磁盘」的唯一实现（K8 归一：/file?checkpointId=live 与
* readChangeSide 此前是两份围栏各异的拷贝）。返回 null = 不可得
* （不在工作区内 / 软链接 / 缺失 / 读取失败），调用方按各自语义呈现。 */
async function readLiveFile(cwd, path) {
	const candidate = resolve(cwd, path);
	if (!isWithin(cwd, candidate)) return null;
	try {
		const stat = await lstat(candidate);
		if (stat.isSymbolicLink() || !stat.isFile()) return null;
		return await readFile(candidate);
	} catch {
		return null;
	}
}
/** 读变更单侧内容：checkpointId 或 'live'（当前磁盘，围栏同 /file 端点）。 */
async function readChangeSide(engine, cwd, sourceId, path) {
	if (sourceId === "live") return readLiveFile(cwd, path);
	return engine.getFileContentFromCheckpoint({
		cwd,
		checkpointId: sourceId,
		path
	});
}
/** 为一条变更补行数与元数据；内容缺失/超限/非 UTF-8/预算耗尽都静默省略行数字段。
* mode-changed（纯权限位变更）对外映射为 'modified'——内容两侧相同，行数自然为 0。 */
async function withLineCounts(engine, cwd, change, prevId, nextId, budget) {
	const base = {
		path: change.path,
		kind: change.kind === "mode-changed" ? "modified" : change.kind,
		...change.before !== void 0 && change.before.kind !== "dir" ? { oldMode: change.before.mode } : {},
		...change.after !== void 0 && change.after.kind !== "dir" ? { newMode: change.after.mode } : {},
		...change.before?.kind === "dir" || change.after?.kind === "dir" ? { dir: true } : {}
	};
	if (base.dir === true || budget.remaining <= 0) return base;
	budget.remaining -= 1;
	try {
		if (base.kind === "added") {
			const after = await readChangeSide(engine, cwd, nextId, change.path);
			if (after === null || after.byteLength > DIFF_COUNT_MAX_BYTES) return base;
			const text = decodeUtf8(after);
			return text === null ? base : {
				...base,
				added: countLines(text),
				removed: 0
			};
		}
		if (base.kind === "deleted") {
			const before = await readChangeSide(engine, cwd, prevId, change.path);
			if (before === null || before.byteLength > DIFF_COUNT_MAX_BYTES) return base;
			const text = decodeUtf8(before);
			return text === null ? base : {
				...base,
				added: 0,
				removed: countLines(text)
			};
		}
		const [before, after] = await Promise.all([readChangeSide(engine, cwd, prevId, change.path), readChangeSide(engine, cwd, nextId, change.path)]);
		if (before === null || after === null || before.byteLength > DIFF_COUNT_MAX_BYTES || after.byteLength > DIFF_COUNT_MAX_BYTES) return base;
		const beforeText = decodeUtf8(before);
		const afterText = decodeUtf8(after);
		if (beforeText === null || afterText === null) return base;
		return {
			...base,
			...lineCounts(beforeText, afterText)
		};
	} catch {
		return base;
	}
}
/**
* 共享配对助手：一轮的「检查点 diff + 窗口归属 + 行数预算」。轮配对
* （diffCheckpoints）与 live-tail（inspect = 最后检查点 vs 当前磁盘）共用，
* 两端点（/shadow-rewind 预览与 /shadow-rewind/fs-changes）不再各持一份拷贝。
*
* 归属行为：窗口内快照做网格归属（attributePaths），owner/autoSelect 随
* 条目透出，作为勾选清单的建议标签。归属失败保守保留全部路径。
*
* 返回 undefined = 结构性跳过（无 sessionId / 无配对终点）或对比失败
* （已记警告）；空 changes 数组原样返回，由调用方决定是否透出。
*/
async function computeTurnFsChanges(engine, deps, options) {
	const { cwd, current, countBudget } = options;
	const live = options.live === true;
	if (current.sessionId === void 0) return void 0;
	if (!live && options.pairEnd === void 0) return void 0;
	const pairEnd = options.pairEnd ?? {
		id: "live",
		createdAt: Number.MAX_SAFE_INTEGER
	};
	try {
		const raw = (live ? await engine.inspect({
			cwd,
			restorePointId: current.id
		}) : await engine.diffCheckpoints({
			cwd,
			prevCheckpointId: current.id,
			currCheckpointId: pairEnd.id
		})).changes.filter((change) => (change.kind === "added" || change.kind === "modified" || change.kind === "deleted" || change.kind === "mode-changed") && !(change.kind === "mode-changed" && change.before?.kind === "dir"));
		if (raw.length === 0) return finishTurnFsChange(current, live, pairEnd, [], options.intent);
		let ownership = /* @__PURE__ */ new Map();
		try {
			const attributed = await engine.listSnapshotsAfter({
				cwd,
				restorePointId: current.id,
				paths: raw.map((change) => change.path)
			});
			const within = attributed.snapshots.filter((snapshot) => snapshot.createdAt < pairEnd.createdAt);
			ownership = attributePaths({
				targetSessionId: attributed.targetSessionId,
				changes: raw,
				snapshots: within
			});
		} catch (error) {
			deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn)} ${live ? "live-tail " : ""}归因失败，保留全部路径：${errorMessage(error)}`);
		}
		return finishTurnFsChange(current, live, pairEnd, await runLimited(raw.map((change) => async () => {
			const item = await withLineCounts(engine, cwd, change, current.id, pairEnd.id, countBudget);
			const attr = ownership.get(change.path);
			return attr === void 0 ? item : {
				...item,
				owner: serializeOwner(attr.owner),
				autoSelect: attr.autoSelect
			};
		}), 4), options.intent);
	} catch (error) {
		deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn)} ${live ? "live " : ""}文件系统差异计算失败：${errorMessage(error)}`);
		return;
	}
}
/** 组装 TurnFsChange 的出口形状（live/intent 按需带字段）。 */
function finishTurnFsChange(current, live, pairEnd, changes, intent) {
	return {
		turn: current.turn,
		turnStartSeq: current.turnStartSeq,
		checkpointId: current.id,
		nextCheckpointId: pairEnd.id,
		...live ? { live: true } : {},
		...intent !== void 0 && intent.length > 0 ? { intent } : {},
		changes
	};
}
/** 并行只读探测检查点内容可读性；返回「不可读」的 id 集合（探测失败也算不可读）。 */
async function probeUnreadableCheckpoints(engine, cwd, ids) {
	const unreadable = /* @__PURE__ */ new Set();
	await Promise.all([...ids].map(async (id) => {
		try {
			if (!await engine.checkpointContentReadable({
				cwd,
				restorePointId: id
			})) unreadable.add(id);
		} catch {
			unreadable.add(id);
		}
	}));
	return unreadable;
}
//#endregion
export { computeTurnFsChanges, countLines, decodeUtf8, lineCounts, probeUnreadableCheckpoints, readChangeSide, readLiveFile, runLimited };
