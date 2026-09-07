import { errorMessage } from "../errors.js";
import { traceRangeDiff } from "../trace-replay.js";
import { bumpWorkspaceRevision } from "./revision.js";
import { sessionEvents } from "./types.js";
import { countLines, decodeUtf8, lineCounts, readChangeSide } from "./fs-changes.js";
//#region src/host/commands.ts
/**
* 宿主适配层·headless 命令面（A4，借鉴 dsh-checkpoint-diff 的 /diff、/rollback）。
*
* dsh 0.1.2 的命令系统是 cordis 服务 `commands`（CommandRuntime.register），
* 命令不产生模型消息，结果由 UI 直接渲染——脚本与 CLI 也能消费。
*
* 提供两个命令：
*  - /shadow-diff：两个时间节点（轮号 / 检查点 id / trace 序号）之间的变更摘要；
*  - /shadow-undo：撤销该工作区最近一次文件恢复。
*
* 命令服务缺失的宿主上注册静默跳过（`ctx.commands?`），不 pending。
*/
const COMMAND_DIFF_USAGE = "用法：/shadow-diff [起] [终]\n起/终可以是：轮号（如 3）、检查点 id（rp_…）、轨迹节点（trace:序号）。\n省略「终」时对比「该轮轮起 → 该轮轮末（或下一轮轮起）」。";
/** 命令输出的行数上限（聊天输出不是导出工具，防刷屏）。 */
const COMMAND_MAX_ROWS = 40;
/** 注册 headless 命令：/shadow-diff（区间 diff 摘要）与 /shadow-undo（撤销最近一次恢复）。 */
function installShadowRewindCommands(ctx, engine) {
	ctx.commands?.register({
		name: "shadow-diff",
		description: "shadow-rewind：两个时间节点之间的文件变更摘要（轮号 / 检查点 id / trace 序号）",
		input: { hint: "[起] [终]" },
		handler: (invocation) => runShadowDiffCommand(engine, invocation)
	});
	ctx.commands?.register({
		name: "shadow-undo",
		description: "shadow-rewind：撤销这个工作区最近一次文件恢复",
		handler: (invocation) => runShadowUndoCommand(engine, invocation)
	});
}
/** 按 token 形状解析寻址：rp_ 检查点 id / trace:序号 / ≤9 位轮号。 */
function parseDiffTarget(token) {
	if (/^rp_[0-9a-z]+_[0-9a-f]{12}$/.test(token)) return {
		kind: "checkpoint",
		id: token
	};
	if (/^trace:[0-9]+$/.test(token)) return {
		kind: "trace",
		seq: Number(token.slice(6))
	};
	if (/^[0-9]+$/.test(token) && token.length <= 9) return {
		kind: "turn",
		turn: Number(token)
	};
	return null;
}
async function runShadowDiffCommand(engine, invocation) {
	const cwd = invocation.agent.session.header.cwd;
	if (cwd === void 0 || cwd.trim() === "") return {
		kind: "error",
		text: "当前会话没有工作区，无法对比。"
	};
	const tokens = invocation.rawInput.trim().split(/\s+/).filter((token) => token !== "");
	if (tokens.length === 0 || tokens.length > 2) return {
		kind: "error",
		text: COMMAND_DIFF_USAGE
	};
	const targets = [];
	for (const token of tokens) {
		const target = parseDiffTarget(token);
		if (target === null) return {
			kind: "error",
			text: `无法识别「${token}」。\n${COMMAND_DIFF_USAGE}`
		};
		targets.push(target);
	}
	try {
		if (targets.every((target) => target.kind === "trace")) {
			const [from, to] = targets;
			if (from.seq >= to.seq) return {
				kind: "error",
				text: "trace 区间语义是 (from, to]，from 必须小于 to。"
			};
			const result = traceRangeDiff(sessionEvents(invocation.agent.session), from.seq, to.seq);
			return {
				kind: "success",
				text: formatCommandDiff(`轨迹区间 #${String(from.seq)} → #${String(to.seq)}：${String(result.changes.length)} 个文件变更`, result.changes, result.notes)
			};
		}
		if (targets.some((target) => target.kind === "trace")) return {
			kind: "error",
			text: `快照检查点与轨迹节点不可混用。\n${COMMAND_DIFF_USAGE}`
		};
		const sessionId = invocation.agent.session.id;
		const checkpoints = await engine.listTurnCheckpoints({
			cwd,
			sessionId
		});
		const startByTurn = /* @__PURE__ */ new Map();
		for (const point of checkpoints) if (point.phase !== "end" && point.turn !== void 0) startByTurn.set(point.turn, point.id);
		const resolveCheckpoint = async (target) => {
			if (target.kind === "checkpoint") return target.id;
			if (target.kind === "turn") return startByTurn.get(target.turn) ?? null;
			return null;
		};
		let fromId;
		let toId;
		if (targets.length === 1 && targets[0].kind === "turn") {
			const turn = targets[0].turn;
			fromId = startByTurn.get(turn) ?? null;
			if (fromId === null) return {
				kind: "error",
				text: `没有找到轮 ${String(turn)} 的轮起检查点（可能未开启自动检查点，或已超出保留上限）。`
			};
			toId = checkpoints.find((point) => point.phase === "end" && point.turn === turn)?.id ?? startByTurn.get(turn + 1) ?? null;
			if (toId === null) return {
				kind: "error",
				text: `轮 ${String(turn)} 没有轮末检查点，也没有下一轮轮起可配对；可稍后重试或显式指定两个节点。`
			};
		} else if (targets.length === 2) {
			fromId = await resolveCheckpoint(targets[0]);
			toId = await resolveCheckpoint(targets[1]);
		} else return {
			kind: "error",
			text: COMMAND_DIFF_USAGE
		};
		if (fromId === null || toId === null) return {
			kind: "error",
			text: "没有找到对应的检查点（可能已超出保留上限或被清理）。"
		};
		const diff = await engine.diffCheckpoints({
			cwd,
			prevCheckpointId: fromId,
			currCheckpointId: toId
		});
		const countBudget = { remaining: COMMAND_MAX_ROWS };
		const rows = await Promise.all(diff.changes.map(async (change) => {
			const [before, after] = await Promise.all([change.before === void 0 ? Promise.resolve(null) : readChangeSide(engine, cwd, fromId, change.path), change.after === void 0 ? Promise.resolve(null) : readChangeSide(engine, cwd, toId, change.path)]);
			const beforeText = before === null ? null : decodeUtf8(before);
			const afterText = after === null ? null : decodeUtf8(after);
			let counts;
			if (countBudget.remaining > 0 && (beforeText !== null || afterText !== null)) {
				countBudget.remaining -= 1;
				counts = beforeText === null ? {
					added: countLines(afterText ?? ""),
					removed: 0
				} : afterText === null ? {
					added: 0,
					removed: countLines(beforeText)
				} : lineCounts(beforeText, afterText);
			}
			return {
				path: change.path,
				kind: change.kind === "mode-changed" ? "modified" : change.kind,
				counts
			};
		}));
		return {
			kind: "success",
			text: formatCommandDiff(`检查点 ${fromId} → ${toId}：${String(rows.length)} 个文件变更`, rows, void 0)
		};
	} catch (error) {
		return {
			kind: "error",
			text: `对比失败：${errorMessage(error)}`
		};
	}
}
/** 命令输出的固定宽度摘要：A/M/D 前缀 + 行数（预算内才带）。 */
function formatCommandDiff(header, rows, notes) {
	const glyph = {
		added: "A",
		deleted: "D",
		modified: "M"
	};
	const shown = rows.slice(0, COMMAND_MAX_ROWS);
	const lines = shown.map((row) => {
		const added = row.counts?.added ?? row.added;
		const removed = row.counts?.removed ?? row.removed;
		const counts = added === void 0 && removed === void 0 ? "" : `  +${String(added ?? 0)} −${String(removed ?? 0)}`;
		return `${glyph[row.kind] ?? "M"} ${row.path}${counts}`;
	});
	if (rows.length > shown.length) lines.push(`…还有 ${String(rows.length - shown.length)} 个文件（完整清单见时间线面板）`);
	if (notes !== void 0 && notes.length > 0) lines.push("", ...notes.map((note) => `注：${note}`));
	return [
		header,
		"",
		...lines
	].join("\n");
}
async function runShadowUndoCommand(engine, invocation) {
	const cwd = invocation.agent.session.header.cwd;
	if (cwd === void 0 || cwd.trim() === "") return {
		kind: "error",
		text: "当前会话没有工作区，无从撤销。"
	};
	try {
		const result = await engine.undoLastRestore({
			cwd,
			signal: invocation.signal
		});
		await bumpWorkspaceRevision(cwd);
		const lines = [`已撤销最近一次恢复：${String(result.undonePaths.length)} 个路径回到恢复前状态（备份点 ${result.rescuePointId} 保留）。`];
		for (const path of result.undonePaths) lines.push(`已还原 ${path}`);
		for (const skip of result.skippedPaths) lines.push(`跳过 ${skip.path}：${skip.reason}`);
		return {
			kind: "success",
			text: lines.join("\n")
		};
	} catch (error) {
		return {
			kind: "error",
			text: errorMessage(error)
		};
	}
}
//#endregion
export { installShadowRewindCommands };
