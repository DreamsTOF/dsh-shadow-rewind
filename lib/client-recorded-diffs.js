import { diffContentLines } from "./client/diff-text.js";
import { diffArrays } from "diff";
//#region src/client/recorded-diffs.ts
/**
* 从一条录制的 Code Mode 变更的**完整 before / after 内容**反推行级审查 hunk。
*
* 为什么必须反推：携带可复用 hunk 的线上视图只挂在模型直发的 tool/call 帧
* 上；`run_code` 的嵌套派发记录下来的只有原始值。本模块因此把同样的 hunk
* 形状（带行锚点的 `ProducedFileDiff`）重建出来——tab 的其余部分负责渲染它，
* 宿主撤销服务负责应用它，两边都不需要知道它来自录制。
*/
/** 每个改动run 前后保留的未变更行数（对齐 unified diff 的观感）。 */
const CONTEXT_LINES = 3;
/** 与宿主 hunk 数学同一基准的换行归一（file-review-service 的 normalizeNewlines
* 语义）：录制的 before/after 是原始文件字节，CRLF 文件不归一会让每一行行尾
* 带 \r 进入 hunk，宿主在 LF 文本上做锚点匹配永远失配（表现为假「内容冲突」）。 */
function normalizeLf(text) {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
/** 数出 hunk 末尾有多少行是两侧相同的上下文。 */
function trailingContext(hunk) {
	let count = 0;
	const max = Math.min(hunk.old.length, hunk.new.length);
	for (let offset = 1; offset <= max; offset += 1) {
		if (hunk.old[hunk.old.length - offset] !== hunk.new[hunk.new.length - offset]) break;
		count += 1;
	}
	return count;
}
/**
* 一次文件变更的行级 hunk；文件是新建的（`before === null`）时返回单条整文件
* 条目（与 write 工具的 null 内容卡片同形）。变更没有实际改动文件时返回 []。
*/
function diffsFromBeforeAfter(rawPath, rawBefore, rawAfter) {
	const path = rawPath;
	const before = rawBefore === null ? null : normalizeLf(rawBefore);
	const after = normalizeLf(rawAfter);
	if (before === null) return [{
		path,
		oldText: null,
		newText: after
	}];
	const oldLines = diffContentLines(before);
	const newLines = diffContentLines(after);
	if (oldLines.length === 0 && newLines.length === 0) return [];
	if (oldLines.join("\n") === newLines.join("\n")) return [];
	const hunks = [];
	const changes = diffArrays(oldLines, newLines);
	let contextBuffer = [];
	let oldCursor = 1;
	let newCursor = 1;
	let hunk = null;
	for (const change of changes) {
		if (!change.removed && !change.added) {
			const run = change.value;
			if (hunk !== null) {
				const beforeLen = hunk.old.length;
				hunk.old.push(...run);
				hunk.new.push(...run);
				oldCursor += run.length;
				newCursor += run.length;
				if (run.length > 6) {
					const target = beforeLen + CONTEXT_LINES;
					hunk.old.length = target;
					hunk.new.length = target;
					contextBuffer = run.slice(-3);
					hunk = null;
				}
			} else {
				contextBuffer.push(...run);
				oldCursor += run.length;
				newCursor += run.length;
				if (contextBuffer.length > CONTEXT_LINES) contextBuffer = contextBuffer.slice(-3);
			}
			continue;
		}
		const removed = change.removed ? change.value : [];
		const added = change.added ? change.value : [];
		if (hunk === null) {
			const leading = contextBuffer;
			hunk = {
				oldStart: oldCursor - leading.length,
				newStart: newCursor - leading.length,
				old: [...leading],
				new: [...leading]
			};
			hunks.push(hunk);
		}
		hunk.old.push(...removed);
		hunk.new.push(...added);
		oldCursor += removed.length;
		newCursor += added.length;
	}
	for (const current of hunks) {
		const extra = Math.max(0, trailingContext(current) - CONTEXT_LINES);
		if (extra > 0) {
			current.old.length -= extra;
			current.new.length -= extra;
		}
	}
	return hunks.filter((hunkEntry) => hunkEntry.old.length > 0 || hunkEntry.new.length > 0).map((hunkEntry) => ({
		path,
		oldText: hunkEntry.old.join("\n"),
		newText: hunkEntry.new.join("\n"),
		oldStart: hunkEntry.oldStart,
		newStart: hunkEntry.newStart
	}));
}
/** 第 `line` 行（1-based）在文本中的起始偏移；越界返回 null。 */
function offsetAtLine(text, line) {
	if (!Number.isInteger(line) || line < 1) return null;
	if (line === 1) return 0;
	let offset = 0;
	for (let current = 1; current < line; current += 1) {
		const next = text.indexOf("\n", offset);
		if (next === -1) return null;
		offset = next + 1;
	}
	return offset;
}
/** 在 `text` 上正向回放一个编辑 hunk（oldText → newText，与宿主 replaceHunk
* 同一锚点语义）；定位失败返回 null，调用方保守回退，绝不猜。 */
function replayHunkOnText(text, diff) {
	const { oldText, newText } = diff;
	if (oldText === null) return null;
	let offset;
	if (diff.oldStart !== void 0) {
		const located = offsetAtLine(text, diff.oldStart);
		if (located === null || text.slice(located, located + oldText.length) !== oldText) return null;
		offset = located;
	} else {
		if (oldText === "") return null;
		const at = text.indexOf(oldText);
		if (at === -1 || text.indexOf(oldText, at + 1) !== -1) return null;
		offset = at;
	}
	return text.slice(0, offset) + newText + text.slice(offset + oldText.length);
}
/**
* 「本轮新建 + 同轮又被修改」的 hunk 收敛：序列里含创建 hunk（oldText=null）
* 时，文件相对轮起的净变化就是「以最终内容新建」——从**最后一个**创建 hunk
* 出发（更早的历史被整体覆盖，无关紧要），把后续编辑 hunk 顺序回放，收敛成
* 单条 added 整文件形状：统计 = 最终行数（而非 hunk 累加的 +6 −3），撤销
* 语义恢复为「删除文件」（混合 hunk 宿主无法回放，原本连撤销按钮都没有）。
* 回放失配（锚点对不上）保守返回原序列——宁可保持现状，绝不猜出一个错误内容。
* TODO: 天花板是「失配条目只能原样保留」；升级路径是把失配标注 degraded，
* 交给检查点 fs 条目兜底（若该轮有捕获）。
*/
function coalesceCreatedFileDiffs(diffs) {
	if (diffs.length <= 1) return diffs;
	let baseIndex = -1;
	for (let index = diffs.length - 1; index >= 0; index -= 1) if (diffs[index]?.oldText === null) {
		baseIndex = index;
		break;
	}
	if (baseIndex === -1) return diffs;
	const base = diffs[baseIndex];
	if (base === void 0) return diffs;
	let text = base.newText;
	for (let index = baseIndex + 1; index < diffs.length; index += 1) {
		const diff = diffs[index];
		if (diff === void 0) return diffs;
		const next = replayHunkOnText(text, diff);
		if (next === null) return diffs;
		text = next;
	}
	return [{
		path: base.path,
		oldText: null,
		newText: text
	}];
}
//#endregion
export { coalesceCreatedFileDiffs, diffsFromBeforeAfter };
