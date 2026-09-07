import { coalesceCreatedFileDiffs, diffsFromBeforeAfter } from "./client-recorded-diffs.js";
import { isToolEntryRewound } from "./client/rewound-changes.js";
//#region src/client/session-changes.ts
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseArgs(argsRaw) {
	try {
		const args = JSON.parse(argsRaw);
		return isRecord(args) ? args : null;
	} catch {
		return null;
	}
}
function pathValue(value) {
	return typeof value === "string" && value !== "" ? value : null;
}
/** 校验跨宿主/浏览器传输进来的 diff hunks（未知即拒绝，绝不猜）。 */
function producedDiffs(meta) {
	if (!isRecord(meta) || !Array.isArray(meta.diffs)) return [];
	const diffs = [];
	for (const value of meta.diffs) {
		if (!isRecord(value)) return rejectDiffs(meta.diffs.length);
		const { path, oldText, newText, oldStart, newStart } = value;
		if (typeof path !== "string" || oldText !== null && typeof oldText !== "string" || typeof newText !== "string" || oldStart !== void 0 && (typeof oldStart !== "number" || !Number.isInteger(oldStart) || oldStart < 1) || newStart !== void 0 && (typeof newStart !== "number" || !Number.isInteger(newStart) || newStart < 1)) return rejectDiffs(meta.diffs.length);
		diffs.push({
			path,
			oldText,
			newText,
			...typeof oldStart === "number" ? { oldStart } : {},
			...typeof newStart === "number" ? { newStart } : {}
		});
	}
	return diffs;
}
/** 一条 hunk 形状不完整就整组丢弃是刻意设计（宿主撤销要求全量可逆）；
* 但静默丢弃曾让「文件在列、撤销永久禁用」无从排查——至少留痕。 */
function rejectDiffs(total) {
	console.warn(`[dsh-shadow-rewind] diff 视图中存在不可解析的 hunk，整组丢弃（共 ${String(total)} 条）`);
	return [];
}
/**
* 一个根变更调用的产出路径（按渲染意图，即工具名：`write` / `edit` /
* `str_replace_editor`）。其余工具一律没有产出——读就是看了看，终端就是跑了
* 一跑。
*/
function producedPathsOfCall(name, argsRaw) {
	const args = parseArgs(argsRaw);
	if (args === null) return [];
	switch (name) {
		case "write":
		case "edit": return pathValue(args.file_path) !== null ? [args.file_path] : [];
		case "str_replace_editor": return pathValue(args.path) !== null ? [args.path] : [];
		default: return [];
	}
}
/** 优先取落地结果 hunks；结果没带 meta 时退回调用意图直译的 hunks。 */
function reviewDiffs(node) {
	const fromMeta = producedDiffs(node.meta);
	if (fromMeta.length > 0) return fromMeta;
	const call = node.call;
	if (call === null) return [];
	const args = parseArgs(call.argsRaw);
	if (args === null) return [];
	switch (call.name) {
		case "write": {
			const path = pathValue(args.file_path);
			const content = args.content;
			return path === null || typeof content !== "string" ? [] : [{
				path,
				oldText: null,
				newText: content
			}];
		}
		case "edit": {
			const path = pathValue(args.file_path);
			const { old_string: oldString, new_string: newString } = args;
			return path === null || typeof oldString !== "string" || typeof newString !== "string" || oldString === "" || oldString === newString ? [] : [{
				path,
				oldText: oldString,
				newText: newString
			}];
		}
		case "str_replace_editor": {
			const path = pathValue(args.path);
			if (path === null) return [];
			if (args.command === "create" && typeof args.file_text === "string") return [{
				path,
				oldText: null,
				newText: args.file_text
			}];
			if (args.command === "str_replace" && typeof args.old_str === "string" && typeof args.new_str === "string" && args.old_str !== "") return [{
				path,
				oldText: args.old_str,
				newText: args.new_str
			}];
			return [];
		}
		default: return [];
	}
}
/**
* 把一个事件 seq 归属到它所属的轮。已完结轮占有直到自己 `turn/end` seq 的
* seq 区间；超出最后一个已完结 end 的统统属于 live 轮——即进行中的
* `partial` / running 调用所在轮，或当没有任何 live 信号可观察时的「下一轮」。
*/
function turnAttribution(legacy) {
	const ends = [...legacy.turnEnds.entries()].sort((a, b) => a[1] - b[1]);
	const liveTurn = legacy.partial?.turn ?? legacy.runningCalls[0]?.turn ?? (ends.at(-1)?.[0] ?? 0) + 1;
	return (seq) => {
		for (const [turn, endSeq] of ends) if (endSeq >= seq) return {
			turn,
			live: false
		};
		return {
			turn: liveTurn,
			live: true
		};
	};
}
/** 推导一个会话的逐轮产出文件变更（无缓存的实现核心）。 */
function derive(snapshot) {
	const legacy = snapshot.legacy;
	const attribute = turnAttribution(legacy);
	const byTurn = /* @__PURE__ */ new Map();
	for (const node of legacy.nodes) {
		if (node.kind !== "tool-result" || node.isError) continue;
		if (node.parentCallId !== void 0) continue;
		const call = node.call;
		if (call === null) continue;
		const paths = producedPathsOfCall(call.name, call.argsRaw);
		if (paths.length === 0) continue;
		const diffs = reviewDiffs(node);
		const { turn, live } = attribute(node.seq);
		let group = byTurn.get(turn);
		if (group === void 0) {
			group = {
				live,
				files: /* @__PURE__ */ new Map()
			};
			byTurn.set(turn, group);
		}
		for (const path of paths) {
			const own = diffs.filter((diff) => pathKey(diff.path) === pathKey(path));
			const key = pathKey(path);
			const existing = group.files.get(key);
			if (existing === void 0) group.files.set(key, {
				path,
				diffs: [...own],
				lastSeq: node.seq
			});
			else {
				existing.diffs.push(...own);
				existing.lastSeq = Math.max(existing.lastSeq ?? node.seq, node.seq);
			}
		}
	}
	return [...byTurn.entries()].sort((a, b) => a[0] - b[0]).map(([turn, group]) => ({
		turn,
		live: group.live,
		files: [...group.files.values()].map((own) => ({
			path: own.path,
			diffs: coalesceCreatedFileDiffs(own.diffs),
			lastSeq: own.lastSeq
		}))
	}));
}
/**
* 快照同一性缓存：侧边栏徽标在每次 tab-bar 渲染都会跑这个推导，结果因此按
* 不可变快照引用记忆化（会话只在内容真正变化时才发布新引用，WeakMap 键正好
* 适配——快照不再被引用时条目随之可回收）。
*/
const cache = /* @__PURE__ */ new WeakMap();
/** 对某个会话快照推导逐轮产出文件变更（带缓存入口）。 */
function deriveSessionChanges(snapshot) {
	if (snapshot === null || snapshot === void 0) return [];
	const hit = cache.get(snapshot);
	if (hit !== void 0) return hit;
	const derived = derive(snapshot);
	cache.set(snapshot, derived);
	return derived;
}
/** 窗口内的全部 `run_code` 工具结果节点，按节点顺序。 */
function deriveSessionRoots(snapshot) {
	const legacy = snapshot.legacy;
	const attribute = turnAttribution(legacy);
	const roots = [];
	for (const node of legacy.nodes) {
		if (node.kind !== "tool-result" || node.isError) continue;
		if (node.subCalls.length === 0) continue;
		const { turn, live } = attribute(node.seq);
		roots.push({
			turn,
			live,
			rootCallId: node.callId
		});
	}
	return roots;
}
/**
* 把宿主录制到的 Code Mode 变更合并进快照推导出的各轮：由完整 before / after
* 重建的 hunks 追加到所属轮的文件组里（同路径条目保持一行，hunks 按派发顺序
* 追加），于是 tab 的 diff 渲染、状态巡检与撤销对程序化改动与模型直发完全
* 同路。所有入参都不可变；只有某条录制变更匹配上了可见根调用时，结果才是
* 新数组（否则原样返回，避免无谓重渲染）。
*/
function mergeRecordedTurns(turns, roots, recorded) {
	if (recorded.length === 0 || roots.length === 0) return turns;
	const rootTurns = /* @__PURE__ */ new Map();
	for (const root of roots) rootTurns.set(root.rootCallId, {
		turn: root.turn,
		live: root.live
	});
	const byRoot = /* @__PURE__ */ new Map();
	for (const mutation of recorded) {
		const list = byRoot.get(mutation.rootCallId);
		if (list === void 0) byRoot.set(mutation.rootCallId, [mutation]);
		else list.push(mutation);
	}
	let matched = false;
	for (const root of roots) if (byRoot.has(root.rootCallId)) {
		matched = true;
		break;
	}
	if (!matched) return turns;
	const groups = /* @__PURE__ */ new Map();
	for (const turn of turns) {
		const files = /* @__PURE__ */ new Map();
		for (const file of turn.files) files.set(pathKey(file.path), {
			path: file.path,
			diffs: [...file.diffs],
			...file.lastSeq !== void 0 ? { lastSeq: file.lastSeq } : {}
		});
		groups.set(turn.turn, {
			live: turn.live,
			files
		});
	}
	for (const [rootCallId, mutations] of byRoot) {
		const owner = rootTurns.get(rootCallId);
		if (owner === void 0) continue;
		let group = groups.get(owner.turn);
		if (group === void 0) {
			group = {
				live: owner.live,
				files: /* @__PURE__ */ new Map()
			};
			groups.set(owner.turn, group);
		}
		for (const mutation of mutations) {
			const diffs = diffsFromBeforeAfter(mutation.path, mutation.before, mutation.after);
			if (diffs.length === 0) continue;
			const key = pathKey(mutation.path);
			const existing = group.files.get(key);
			if (existing === void 0) group.files.set(key, {
				path: mutation.path,
				diffs: [...diffs]
			});
			else existing.diffs.push(...diffs);
		}
	}
	return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([turn, group]) => ({
		turn,
		live: group.live,
		files: [...group.files.values()].map((own) => ({
			path: own.path,
			diffs: coalesceCreatedFileDiffs(own.diffs),
			...own.lastSeq !== void 0 ? { lastSeq: own.lastSeq } : {}
		}))
	}));
}
/**
* 回滚遮蔽过滤：把「磁盘上已不存在」的条目从轮列表里扣掉（live 条的会话
* 累计视图与徽标共用）。规则见 rewound-changes.ts——条目 lastSeq ≤ 标记
* 屏障且路径被恢复即遮蔽；没有 lastSeq 的条目（纯录制合入）一律放行。
*/
function filterRewoundTurns(turns, marks) {
	if (marks.length === 0) return turns;
	const result = [];
	for (const turn of turns) {
		const files = turn.files.filter((file) => file.lastSeq === void 0 || !isToolEntryRewound(marks, pathKey(file.path), file.lastSeq));
		if (files.length > 0) result.push({
			...turn,
			files
		});
	}
	return result;
}
/** 统计跨所有轮的被改路径去重数（侧边栏徽标就是这个数）。 */
function countChangedFiles(turns) {
	const paths = /* @__PURE__ */ new Set();
	for (const turn of turns) for (const file of turn.files) paths.add(pathKey(file.path));
	return paths.size;
}
/**
* 单一「可撤销」判定（H1 归一）：轮尾卡片与侧栏 tab 共用同一份条件集，
* 不再各自维护——mode-only fs 条目、fs 整文件形状（added/deleted）、目录
* 条目、完整可回放的 hunk 序列，四种可逆形态只在这里写一遍。
*/
function reversibleOf(file) {
	if (file.dir === true) return true;
	if (file.origin === "fs" && file.diffs.length === 1) {
		const only = file.diffs[0];
		if (only !== void 0 && only.path === file.path && only.oldText !== null && only.oldText === only.newText && only.oldMode !== void 0 && only.newMode !== void 0 && only.oldMode !== only.newMode) return true;
	}
	if (file.diffs.length === 1) {
		const only = file.diffs[0];
		if (only !== void 0 && only.path === file.path && (only.oldText === null || only.newText === "" && only.oldText !== "")) return true;
	}
	return file.diffs.length > 0 && file.diffs.every((diff) => diff.path === file.path && diff.oldText !== null && diff.oldText !== diff.newText && (diff.oldText !== "" || diff.oldStart !== void 0) && (diff.newText !== "" || diff.newStart !== void 0));
}
/** 路径末段——一眼就能认出文件的那一部分。 */
function basename(path) {
	const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return at === -1 ? path : path.slice(at + 1);
}
/**
* J4：列表层路径比较键——反斜杠统一成正斜杠。工具参数可能是 Windows
* 反斜杠相对路径，fs 条目恒为正斜杠（服务端 path-utils 语义）；裸 ===
* 会把同一文件劈成两行、+/− 统计减半。大小写不折叠：POSIX 区分大小写，
* 误并两个文件比漏并一个更危险。
*/
function pathKey(path) {
	return path.replace(/\\/g, "/");
}
/** 绝对路径判定：POSIX 根、盘符根或 UNC 前缀，分隔符无关。 */
function isAbsolutePath(path) {
	return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}
/** 把（可能相对的）工具路径按会话工作区目录解析成展示路径。 */
function resolveSessionPath(cwd, path) {
	if (isAbsolutePath(path)) return path;
	const base = cwd ?? "";
	if (base === "") return path;
	const separator = base.includes("\\") ? "\\" : "/";
	return `${base.replace(/[\\/]+$/, "")}${separator}${path}`;
}
/**
* 合并工具侧条目与检查点 fs 条目为「每路径一行」，轮尾卡片与 live 条共用。
*
* 路径键用 pathKey 归一（J4：Windows 反斜杠与 fs 正斜杠是同一文件）。工具
* 条目优先——它带着精确 hunk，也是「回滚本轮 AI 更改」的范围来源；仅当工具
* 条目不可逆（典型：本轮新建 write(oldText=null) 后同轮又被 edit 修改，混合
* hunk 宿主无法回放、+/− 也虚增成 +6 −3）而存在检查点 fs 条目时，改用 fs
* 净条目：它的计数是「本轮相对轮起的净变化」（新建 = 最终行数而非 hunk 累加），
* 撤销语义也正确（新建撤销 = 删除文件）。
*/
function mergeToolFsEntries(tool, fs) {
	if (fs.length === 0) return tool;
	const byKey = /* @__PURE__ */ new Map();
	for (const entry of tool) {
		const key = pathKey(entry.path);
		if (!byKey.has(key)) byKey.set(key, entry);
	}
	for (const entry of fs) {
		const key = pathKey(entry.path);
		const existing = byKey.get(key);
		if (existing === void 0) {
			byKey.set(key, entry);
			continue;
		}
		if (!reversibleOf(existing)) byKey.set(key, entry);
	}
	return [...byKey.values()];
}
//#endregion
export { basename, countChangedFiles, deriveSessionChanges, deriveSessionRoots, filterRewoundTurns, mergeRecordedTurns, mergeToolFsEntries, pathKey, producedDiffs, resolveSessionPath, reversibleOf };
