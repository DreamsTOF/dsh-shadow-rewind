import { diffLines } from "diff";
//#region src/trace-replay.ts
/**
* 轨迹重放（Trace Replay）——从会话事件流重放 write / edit / str_replace_editor
* 的内容参数，把每个工具调用边界当作时间节点做区间 diff。
*
* 借鉴 dsh-checkpoint-diff 0.5.0 的轨迹重放（lib/trace/*，Apache-2.0）思路，
* 按本插件的宿主事实（dsh 0.1.2）重新实现：
*  - 数据源是统一的 readSession（live 优先、sessionQuery 冷读兜底），不需要
*    zstd 直读兜底（那是旧宿主时代的 workaround）；
*  - `tool/call` 的 `arguments` 是原始 JSON 字符串；`tool/result` 没有顶层
*    isError——错误在 `data.error` 与 `message.content[].isError`；
*  - 只重放成功的调用；结果缺失（回合进行中）按成功处理并在 notes 计数。
*
* 固有盲区（与 checkpoint-diff 相同，诚实标注而非掩盖）：终端命令与外部进程
* 的写盘不经过工具参数，轨迹不可见——那正是影子快照与终端写盘审计的领地。
* 快照优先、轨迹兜底，两者并存不互相覆盖。
*
* TODO: 天花板——只覆盖会话内首次 write 之后的内容状态；文件在会话开始前
* 就存在但从未被内容型工具写过时，重放图里没有它的基线，区间 diff 会把它
* 标成 added。升级路径：用最近的轮起检查点条目补齐基线。
*/
function eventFields(event) {
	return event.data;
}
/** 内容型变更工具名单（与宿主内置工具一致）。 */
const MUTATING_CONTENT_TOOLS = /* @__PURE__ */ new Set([
	"write",
	"edit",
	"str_replace_editor"
]);
/** 单次区间 diff 的文件数上限（超出截断并记 note；防失控响应）。 */
const MAX_CHANGES = 200;
/** 单侧全文进入响应的字节上限（超出则全文置 null，行数仍保留）。 */
const MAX_TEXT_BYTES = 524288;
/** 安全解析 tool/call 的原始 JSON 参数串。 */
function parseToolArguments(raw) {
	if (typeof raw !== "string" || raw === "") return null;
	try {
		const parsed = JSON.parse(raw);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}
/** 从参数中提取目标路径（工具间字段名不同：write/edit 用 file_path，str_replace_editor 用 path）。 */
function toolTargetPath(name, args) {
	if (args === null) return null;
	const value = args[name === "str_replace_editor" ? "path" : "file_path"];
	return typeof value === "string" && value !== "" ? value : null;
}
/** tool/result 是否报告失败：顶层 error 或 message.content 首个块的 isError。 */
function toolResultError(data) {
	const fields = data;
	if (fields.error !== void 0 && fields.error !== null) return true;
	const content = fields.message?.content;
	if (Array.isArray(content)) {
		for (const block of content) if (block !== null && typeof block === "object" && block.isError === true) return true;
	}
	return false;
}
/** 事件流 → 三泳道 spans（等宽投影的槽位序 = 数组序）。 */
function traceSpans(events) {
	const nodes = traceNodes(events);
	const bySeq = new Map(nodes.map((node) => [node.seq, node]));
	const spans = [];
	for (const event of events) {
		if (event.type === "user/message") {
			spans.push({
				seq: event.seq,
				kind: "user",
				lane: 0
			});
			continue;
		}
		if (event.type === "assistant/message") {
			spans.push({
				seq: event.seq,
				kind: "assistant",
				lane: 1
			});
			continue;
		}
		const node = bySeq.get(event.seq);
		if (event.type === "tool/call" && node !== void 0) spans.push({
			seq: event.seq,
			kind: "tool",
			lane: 2,
			name: node.name,
			...node.path === void 0 ? {} : { path: node.path },
			...node.mutating ? { mutating: true } : {},
			...node.error === true ? { error: true } : {}
		});
	}
	return spans;
}
/** turn 边界（turn/start 事件 seq 列表）：时间线的刻度线。 */
function turnBoundaries(events) {
	const seqs = [];
	for (const event of events) if (event.type === "turn/start" && typeof event.seq === "number") seqs.push(event.seq);
	return seqs;
}
function collectTurnIntent(events, fromSeq, cap = 16) {
	const intent = [];
	for (const event of events) {
		if (event.type !== "tool/call" || typeof event.seq !== "number" || event.seq <= fromSeq) continue;
		const fields = eventFields(event);
		const name = fields.name;
		if (typeof name !== "string" || !MUTATING_CONTENT_TOOLS.has(name)) continue;
		const args = parseToolArguments(fields.arguments);
		if (name === "str_replace_editor") {
			const command = typeof args?.command === "string" ? args.command : "";
			if (command !== "create" && command !== "str_replace" && command !== "insert") continue;
		}
		const path = toolTargetPath(name, args);
		if (path === null) continue;
		intent.push({
			tool: name,
			path,
			seq: event.seq
		});
		if (intent.length >= cap) break;
	}
	return intent;
}
/** 全部 tool/call 边界 → 时间线节点（错误标记从配对 result 合并）。 */
function traceNodes(events) {
	const failedCalls = /* @__PURE__ */ new Set();
	for (const event of events) {
		if (event.type !== "tool/result") continue;
		const callId = eventFields(event).callId;
		if (typeof callId !== "string") continue;
		if (toolResultError(event.data)) failedCalls.add(callId);
	}
	const nodes = [];
	for (const event of events) {
		if (event.type !== "tool/call" || typeof event.seq !== "number") continue;
		const fields = eventFields(event);
		const name = typeof fields.name === "string" ? fields.name : "";
		if (name === "") continue;
		const callId = typeof fields.callId === "string" ? fields.callId : void 0;
		const path = toolTargetPath(name, parseToolArguments(fields.arguments));
		nodes.push({
			seq: event.seq,
			...typeof fields.turn === "number" ? { turn: fields.turn } : {},
			...typeof fields.step === "number" ? { step: fields.step } : {},
			...callId === void 0 ? {} : { callId },
			name,
			...path === null ? {} : { path },
			mutating: MUTATING_CONTENT_TOOLS.has(name),
			...callId !== void 0 && failedCalls.has(callId) ? { error: true } : {}
		});
	}
	return nodes;
}
/** 成功调用的内容操作序列（str_replace_editor 的 view 等只读命令不进队列）。 */
function contentOps(events) {
	const failedCalls = /* @__PURE__ */ new Set();
	const seenResults = /* @__PURE__ */ new Set();
	for (const event of events) {
		if (event.type !== "tool/result") continue;
		const callId = eventFields(event).callId;
		if (typeof callId !== "string") continue;
		seenResults.add(callId);
		if (toolResultError(event.data)) failedCalls.add(callId);
	}
	const ops = [];
	const notes = [];
	for (const event of events) {
		if (event.type !== "tool/call" || typeof event.seq !== "number") continue;
		const fields = eventFields(event);
		const callId = typeof fields.callId === "string" ? fields.callId : void 0;
		const args = parseToolArguments(fields.arguments);
		const name = typeof fields.name === "string" ? fields.name : "";
		if (!MUTATING_CONTENT_TOOLS.has(name)) continue;
		const path = toolTargetPath(name, args);
		if (path === null) {
			notes.push(`seq ${String(event.seq)}：${name} 参数无法解析（跳过重放）`);
			continue;
		}
		if (callId !== void 0 && failedCalls.has(callId)) continue;
		if (callId !== void 0 && !seenResults.has(callId)) notes.push(`seq ${String(event.seq)}：${name} 结果未返回（进行中，按成功重放）`);
		if (name === "write") {
			const content = args?.content;
			if (typeof content !== "string") {
				notes.push(`seq ${String(event.seq)}：write 缺少 content（跳过重放）`);
				continue;
			}
			ops.push({
				seq: event.seq,
				...callId === void 0 ? {} : { callId },
				tool: name,
				path,
				kind: "write",
				content
			});
			continue;
		}
		if (name === "edit") {
			const oldString = args?.old_string;
			const newString = args?.new_string;
			if (typeof oldString !== "string" || typeof newString !== "string") {
				notes.push(`seq ${String(event.seq)}：edit 参数不完整（跳过重放）`);
				continue;
			}
			ops.push({
				seq: event.seq,
				...callId === void 0 ? {} : { callId },
				tool: name,
				path,
				kind: "str-replace",
				oldString,
				newString,
				...args?.replace_all === true ? { replaceAll: true } : {}
			});
			continue;
		}
		const command = typeof args?.command === "string" ? args.command : "";
		if (command === "create") {
			const fileText = args?.file_text;
			if (typeof fileText !== "string") {
				notes.push(`seq ${String(event.seq)}：str_replace_editor create 缺少 file_text（跳过重放）`);
				continue;
			}
			ops.push({
				seq: event.seq,
				...callId === void 0 ? {} : { callId },
				tool: name,
				path,
				kind: "write",
				content: fileText
			});
			continue;
		}
		if (command === "str_replace") {
			const oldString = args?.old_str;
			const newString = args?.new_str;
			if (typeof oldString !== "string" || typeof newString !== "string") {
				notes.push(`seq ${String(event.seq)}：str_replace_editor str_replace 参数不完整（跳过重放）`);
				continue;
			}
			ops.push({
				seq: event.seq,
				...callId === void 0 ? {} : { callId },
				tool: name,
				path,
				kind: "str-replace",
				oldString,
				newString,
				...args?.replace_all === true ? { replaceAll: true } : {}
			});
			continue;
		}
		if (command === "insert") {
			const insertLine = args?.insert_line;
			const newString = args?.new_str;
			if (typeof insertLine !== "number" || typeof newString !== "string") {
				notes.push(`seq ${String(event.seq)}：str_replace_editor insert 参数不完整（跳过重放）`);
				continue;
			}
			ops.push({
				seq: event.seq,
				...callId === void 0 ? {} : { callId },
				tool: name,
				path,
				kind: "insert",
				newString,
				insertLine
			});
		}
	}
	return {
		ops,
		notes
	};
}
/** LF 归一：与宿主行数统计同一基准（CRLF 不产生幽灵差异）。 */
function normalizeLf(text) {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function countLines(text) {
	if (text === "") return 0;
	let count = 0;
	for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) count += 1;
	return text.endsWith("\n") ? count : count + 1;
}
function lineCounts(before, after) {
	let added = 0;
	let removed = 0;
	for (const part of diffLines(normalizeLf(before), normalizeLf(after))) if (part.added === true) added += part.count ?? 0;
	else if (part.removed === true) removed += part.count ?? 0;
	return {
		added,
		removed
	};
}
/**
* 把操作序列重放到 `untilSeqExcl`（不含）为止，返回 (状态图, 漂移 notes)。
* state 值 null 不存在——删除不进重放（内容型工具不删文件）。
*/
function replayUntil(ops, untilSeqExcl, notes) {
	const state = /* @__PURE__ */ new Map();
	for (const op of ops) {
		if (op.seq >= untilSeqExcl) break;
		if (op.kind === "write") {
			state.set(op.path, op.content ?? "");
			continue;
		}
		const current = state.get(op.path);
		if (current === void 0) {
			notes.push(`seq ${String(op.seq)}：${op.tool} 目标 ${op.path} 不在重放状态中（会话内未先写入；漂移跳过）`);
			continue;
		}
		if (op.kind === "str-replace") {
			const oldString = op.oldString ?? "";
			if (!current.includes(oldString)) {
				notes.push(`seq ${String(op.seq)}：${op.tool} 的 old_string 在 ${op.path} 中未找到（重放漂移，跳过）`);
				continue;
			}
			state.set(op.path, op.replaceAll === true ? current.split(oldString).join(op.newString ?? "") : current.replace(oldString, op.newString ?? ""));
			continue;
		}
		const lines = normalizeLf(current).split("\n");
		const at = Math.max(0, Math.min(op.insertLine ?? 0, lines.length));
		const inserted = normalizeLf(op.newString ?? "").replace(/\n$/, "").split("\n");
		lines.splice(at, 0, ...inserted);
		state.set(op.path, lines.join("\n"));
	}
	return state;
}
/**
* 任意两个轨迹节点 (fromSeq, toSeq] 的内容区间 diff（同一 LCS 引擎语义：
* chronologically from → to，del = 会被带走的行，add = 会出现的行）。
*/
function traceRangeDiff(events, fromSeq, toSeq) {
	const { ops } = contentOps(events);
	const beforeState = replayUntil(ops, fromSeq, []);
	const drift = [];
	const afterState = replayUntil(ops, toSeq, drift);
	const paths = [.../* @__PURE__ */ new Set([...beforeState.keys(), ...afterState.keys()])].sort();
	const changes = [];
	let truncated = false;
	for (const path of paths) {
		if (changes.length >= MAX_CHANGES) {
			truncated = true;
			break;
		}
		const before = beforeState.get(path) ?? null;
		const after = afterState.get(path) ?? null;
		if (before === after) continue;
		const kind = before === null ? "added" : after === null ? "deleted" : "modified";
		const counts = before === null ? {
			added: countLines(after ?? ""),
			removed: 0
		} : after === null ? {
			added: 0,
			removed: countLines(before)
		} : lineCounts(before, after);
		changes.push({
			path,
			kind,
			...before !== null && Buffer.byteLength(before, "utf8") <= MAX_TEXT_BYTES ? { before } : { before: null },
			...after !== null && Buffer.byteLength(after, "utf8") <= MAX_TEXT_BYTES ? { after } : { after: null },
			added: counts.added,
			removed: counts.removed
		});
	}
	const allNotes = [...drift];
	if (truncated) allNotes.push(`变更文件数超过 ${String(MAX_CHANGES)}，仅返回前 ${String(MAX_CHANGES)} 个`);
	allNotes.push("轨迹重放只覆盖会话内的内容型工具（write/edit/str_replace_editor）；终端命令与外部进程的写盘不可见——请用快照检查点对比。");
	return {
		changes,
		notes: allNotes
	};
}
//#endregion
export { MUTATING_CONTENT_TOOLS, collectTurnIntent, contentOps, parseToolArguments, toolResultError, toolTargetPath, traceNodes, traceRangeDiff, traceSpans, turnBoundaries };
