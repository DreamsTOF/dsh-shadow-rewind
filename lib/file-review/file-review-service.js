import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region src/file-review/file-review-service.ts
/** Host-side, workspace-contained undo / redo service for produced text diffs. */
/**
* The mutation tools' recorded hunks (both diff cards and Code Mode
* before/after values) ride the filesystem backend's LF-normalized basis,
* while files on disk may use CRLF. All hunk matching therefore runs on the
* normalized text; the write path restores the file's own line-ending style.
*/
function normalizeNewlines(text) {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function restoreNewlines(text, crlf) {
	return crlf ? text.replace(/\n/g, "\r\n") : text;
}
function inside(root, candidate) {
	const child = relative(root, candidate);
	return child === "" || !child.startsWith("..") && !isAbsolute(child);
}
async function resolveFile(cwd, requestedPath) {
	const root = await realpath(cwd);
	const candidate = resolve(root, requestedPath);
	if (!inside(root, candidate)) throw new Error("path is outside the session workspace");
	const linkStat = await lstat(candidate);
	if (linkStat.isSymbolicLink()) throw new Error("symbolic links are not supported");
	if (!linkStat.isFile()) throw new Error("path is not a regular file");
	const filename = await realpath(candidate);
	if (!inside(root, filename)) throw new Error("resolved path is outside the session workspace");
	const bytes = await readFile(filename);
	const text = bytes.toString("utf8");
	if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("file is not valid UTF-8 text");
	const crlf = text.includes("\r");
	return {
		filename,
		mode: linkStat.mode & 511,
		bytes,
		text,
		crlf,
		lfText: normalizeNewlines(text)
	};
}
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
function replaceHunk(text, source, replacement, line) {
	let offset;
	if (line !== void 0) {
		const located = offsetAtLine(text, line);
		if (located === null || text.slice(located, located + source.length) !== source) return null;
		offset = located;
	} else {
		if (source === "") return null;
		offset = text.indexOf(source);
		if (offset === -1 || text.indexOf(source, offset + 1) !== -1) return null;
	}
	return text.slice(0, offset) + replacement + text.slice(offset + source.length);
}
function hunkSupported(diff, path) {
	if (diff.path !== path || diff.oldText === null || diff.oldText === diff.newText) return false;
	if (diff.oldText === "" && diff.oldStart === void 0) return false;
	if (diff.newText === "" && diff.newStart === void 0) return false;
	return true;
}
/** Apply a complete file's hunk sequence in memory, or report a strict mismatch. */
function transformFile(text, file, action) {
	if (file.diffs.length === 0 || !file.diffs.every((diff) => hunkSupported(diff, file.path))) return null;
	const diffs = action === "undo" ? [...file.diffs].reverse() : file.diffs;
	let next = text;
	for (const diff of diffs) {
		const source = action === "undo" ? diff.newText : diff.oldText;
		const replacement = action === "undo" ? diff.oldText : diff.newText;
		if (source === null || replacement === null) return null;
		const changed = replaceHunk(next, source, replacement, action === "undo" ? diff.newStart : diff.oldStart);
		if (changed === null) return null;
		next = changed;
	}
	return next;
}
function hunkSidePresent(text, file, side) {
	for (const diff of file.diffs) {
		const source = side === "old" ? diff.oldText : diff.newText;
		if (source === null) continue;
		const line = side === "old" ? diff.oldStart : diff.newStart;
		if (line !== void 0) {
			const located = offsetAtLine(text, line);
			if (located === null || text.slice(located, located + source.length) !== source) return false;
		} else if (text.indexOf(source) === -1) return false;
	}
	return true;
}
function inspectText(text, file) {
	if (file.diffs.length === 0 || !file.diffs.every((diff) => hunkSupported(diff, file.path))) return {
		state: "unsupported",
		reason: "change has no complete reversible diff"
	};
	const undone = transformFile(text, file, "undo");
	const redone = transformFile(text, file, "redo");
	if (undone !== null && redone !== null) return hunkSidePresent(text, file, "new") ? {
		state: "applied",
		text,
		nextText: undone
	} : {
		state: "undone",
		text,
		nextText: redone
	};
	if (undone !== null) return {
		state: "applied",
		text,
		nextText: undone
	};
	if (redone !== null) return {
		state: "undone",
		text,
		nextText: redone
	};
	return {
		state: "conflict",
		reason: "current content does not match the recorded change"
	};
}
async function inspectOne(cwd, file) {
	if (file.diffs.length === 0 || !file.diffs.every((diff) => hunkSupported(diff, file.path))) return {
		path: file.path,
		state: "unsupported",
		changed: false,
		reason: "change has no complete reversible diff"
	};
	try {
		const inspected = inspectText((await resolveFile(cwd, file.path)).lfText, file);
		return {
			path: file.path,
			state: inspected.state,
			changed: false,
			reason: inspected.reason
		};
	} catch (error) {
		return {
			path: file.path,
			state: "error",
			changed: false,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
async function applyOne(cwd, file, action) {
	if (file.diffs.length === 0 || !file.diffs.every((diff) => hunkSupported(diff, file.path))) return {
		path: file.path,
		state: "unsupported",
		changed: false,
		reason: "change has no complete reversible diff"
	};
	try {
		const resolved = await resolveFile(cwd, file.path);
		const inspected = inspectText(resolved.lfText, file);
		const sourceState = action === "undo" ? "applied" : "undone";
		const targetState = action === "undo" ? "undone" : "applied";
		if (inspected.state === targetState) return {
			path: file.path,
			state: targetState,
			changed: false
		};
		if (inspected.state !== sourceState || inspected.nextText === void 0) return {
			path: file.path,
			state: inspected.state,
			changed: false,
			reason: inspected.reason
		};
		const current = await readFile(resolved.filename);
		if (!Buffer.from(resolved.bytes).equals(current)) return {
			path: file.path,
			state: "conflict",
			changed: false,
			reason: "file changed while the operation was being prepared"
		};
		await writeFileAtomic(resolved.filename, restoreNewlines(inspected.nextText, resolved.crlf), { mode: resolved.mode });
		return {
			path: file.path,
			state: targetState,
			changed: true
		};
	} catch (error) {
		return {
			path: file.path,
			state: "error",
			changed: false,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
function sessionCwd(agent) {
	const cwd = agent.session.header.cwd;
	if (cwd === void 0 || cwd.trim() === "") throw new Error("session has no workspace directory");
	return cwd;
}
/** Per-agent cap on recorded Code Mode mutations (oldest evicted first). */
const RECORDED_PER_AGENT_CAP = 4e3;
/** 持久化记录文件的 JSON 字节上限；超出时丢弃最旧条目（保底保留最后一条）。 */
const RECORDED_BYTES_CAP = 67108864;
/** 录制记录落盘的防抖窗口（毫秒）；run_code 修改通常成簇到达。 */
const RECORDS_FLUSH_MS = 400;
/** 持久化记录格式版本；读取方拒绝其它版本（视为损坏，从空开始）。 */
const RECORDS_VERSION = 1;
function isRecordedMutation(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value;
	return typeof candidate.rootCallId === "string" && typeof candidate.name === "string" && typeof candidate.path === "string" && (candidate.before === null || typeof candidate.before === "string") && typeof candidate.after === "string";
}
function capRecords(list) {
	return list.length > RECORDED_PER_AGENT_CAP ? list.slice(list.length - RECORDED_PER_AGENT_CAP) : list;
}
/** 记录文件名：可读前缀 + agentKey 的 16 位哈希，避免非法路径字符与碰撞。 */
function recordsFilename(agentKey) {
	const hash = createHash("sha256").update(agentKey).digest("hex").slice(0, 16);
	const stem = agentKey.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
	return `${stem === "" ? "agent" : stem}-${hash}.json`;
}
function agentKey(agent) {
	return String(agent.id);
}
/** Host service published as the `fileReview` Remote namespace. */
var FileReviewService = class extends TypertRemoteService {
	/** Per-agent record of Code Mode (`run_code`) file mutations, dispatch order. */
	recordLog = /* @__PURE__ */ new Map();
	/** 已完成懒加载的 agent（此后变更直写 recordLog 并调度落盘）。 */
	loadedAgents = /* @__PURE__ */ new Set();
	/** 进行中的懒加载任务（recordMutation 与 recorded 共用，保证合并顺序）。 */
	loadingAgents = /* @__PURE__ */ new Map();
	/** 懒加载完成前到达的变更缓冲；加载完成后按「磁盘在前、缓冲在后」合并。 */
	preLoad = /* @__PURE__ */ new Map();
	/** 每 agent 的落盘防抖定时器。 */
	flushTimers = /* @__PURE__ */ new Map();
	/** 每 agent 的串行化落盘链（防抖触发可能晚于前一次写入）。 */
	flushChains = /* @__PURE__ */ new Map();
	recordsDir;
	constructor(ctx, options = {}) {
		super(ctx, "fileReview");
		this.recordsDir = options.storageDir !== void 0 && options.storageDir.trim() !== "" ? join(options.storageDir, "file-review", "recorded") : void 0;
	}
	/** Append one nested (Code Mode) file mutation for the receiving agent. */
	recordMutation(agent, mutation) {
		const key = agentKey(agent);
		if (!this.loadedAgents.has(key)) {
			const buffered = this.preLoad.get(key) ?? [];
			buffered.push(mutation);
			this.preLoad.set(key, buffered);
			this.ensureLoaded(key);
			return;
		}
		const list = this.recordLog.get(key);
		if (list === void 0) this.recordLog.set(key, [mutation]);
		else {
			list.push(mutation);
			if (list.length > RECORDED_PER_AGENT_CAP) list.splice(0, list.length - RECORDED_PER_AGENT_CAP);
		}
		this.scheduleFlush(key);
	}
	/** Return the recorded mutations for the requested `run_code` roots. */
	async recorded(agent, request) {
		const key = agentKey(agent);
		await this.ensureLoaded(key);
		const list = this.recordLog.get(key);
		if (list === void 0 || request.rootCallIds.length === 0) return { mutations: [] };
		const wanted = new Set(request.rootCallIds);
		return { mutations: list.filter((mutation) => wanted.has(mutation.rootCallId)) };
	}
	ensureLoaded(key) {
		if (this.loadedAgents.has(key)) return Promise.resolve();
		const existing = this.loadingAgents.get(key);
		if (existing !== void 0) return existing;
		const task = this.loadFromDisk(key).finally(() => {
			this.loadingAgents.delete(key);
		});
		this.loadingAgents.set(key, task);
		return task;
	}
	async loadFromDisk(key) {
		try {
			if (this.recordsDir === void 0) return;
			let raw;
			try {
				raw = await readFile(join(this.recordsDir, recordsFilename(key)), "utf8");
			} catch {
				return;
			}
			const parsed = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
			const record = parsed;
			if (record.version !== RECORDS_VERSION || !Array.isArray(record.mutations)) return;
			const disk = [];
			for (const entry of record.mutations) if (isRecordedMutation(entry)) disk.push(entry);
			const buffered = this.preLoad.get(key) ?? [];
			this.preLoad.delete(key);
			const merged = capRecords([...disk, ...buffered]);
			if (merged.length > 0) this.recordLog.set(key, merged);
			if (buffered.length > 0) this.scheduleFlush(key);
		} catch {} finally {
			this.loadedAgents.add(key);
			const remaining = this.preLoad.get(key);
			if (remaining !== void 0) {
				this.preLoad.delete(key);
				const list = this.recordLog.get(key) ?? [];
				list.push(...remaining);
				this.recordLog.set(key, capRecords(list));
				this.scheduleFlush(key);
			}
		}
	}
	scheduleFlush(key) {
		if (this.recordsDir === void 0) return;
		if (this.flushTimers.has(key)) return;
		const timer = setTimeout(() => {
			this.flushTimers.delete(key);
			this.flushNow(key);
		}, RECORDS_FLUSH_MS);
		timer.unref?.();
		this.flushTimers.set(key, timer);
	}
	flushNow(key) {
		const next = (this.flushChains.get(key) ?? Promise.resolve()).then(() => this.writeRecords(key));
		this.flushChains.set(key, next);
		return next;
	}
	async writeRecords(key) {
		const list = this.recordLog.get(key);
		if (list === void 0 || this.recordsDir === void 0) return;
		let payload = {
			version: RECORDS_VERSION,
			mutations: [...list]
		};
		let text;
		try {
			text = JSON.stringify(payload);
		} catch {
			return;
		}
		if (Buffer.byteLength(text, "utf8") > RECORDED_BYTES_CAP && list.length > 1) {
			const trimmed = [...list];
			do {
				trimmed.shift();
				payload = {
					version: RECORDS_VERSION,
					mutations: [...trimmed]
				};
				try {
					text = JSON.stringify(payload);
				} catch {
					continue;
				}
			} while (trimmed.length > 1 && Buffer.byteLength(text, "utf8") > RECORDED_BYTES_CAP);
			this.recordLog.set(key, [...trimmed]);
		}
		try {
			await mkdir(this.recordsDir, { recursive: true });
			await writeFileAtomic(join(this.recordsDir, recordsFilename(key)), text, { mode: 384 });
		} catch {}
	}
	/** Inspect current disk state without changing files. */
	async status(agent, request) {
		const cwd = sessionCwd(agent);
		return { files: await Promise.all(request.files.map((file) => inspectOne(cwd, file))) };
	}
	/** Toggle every independently safe file while the receiving Agent is idle. */
	async apply(agent, request) {
		const cwd = sessionCwd(agent);
		return agent.runMaintenance(async () => {
			const files = [];
			for (const file of request.files) files.push(await applyOne(cwd, file, request.action));
			return { files };
		});
	}
};
//#endregion
export { FileReviewService, transformFile };
