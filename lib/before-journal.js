import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
//#region src/before-journal.ts
/**
* BEFORE 捕获日志（主路捕获的存储半边，Claude Code 式语义）。
*
* 每个「写盘前抓到的文件状态」是一条 JSON 记录，锚定到发起该回合的
* user message seq：
*
*   <workspaceDir>/before-journal/<safeSessionId>/<anchorSeq>/<callId>.json
*
* 记录字段：{ callId, anchorSeq, path(工作区相对), existed, content, size, mode, time }。
* `existed = false` 表示该次工具调用**创建**了文件（BEFORE 不存在）——
* 回滚语义是「删除」。内容内联存储（不经 sqlite/jj 后端），直到消息检查点
* 物化时才入库——避免「已捕获未引用」的 blob 被内容 GC 回收。
*
* 与影子整树快照的关系（EXPECTED-DESIGN 混合架构）：
*  - 回合检查点在位时，恢复到「回合开始之前」直接用检查点（全树，语义是
*    它的超集）；
*  - 检查点缺席（关闭/失败/被修剪）时，由本日志物化出部分树消息检查点
*    （kind 'message'，partial: true）兜底——「消除没料可回」。
*
* TODO: 天花板——内容内联不走 dsh-rewind 的同内容 link 去重，存储开销
* 随编辑次数线性；升级路径 = 引入 ref link + link 感知 prune（抄
* dsh-rewind SnapshotStore 的 dedup/物化两段）。
*/
/** 单会话保留的最新 anchor 组数（对齐 dsh-rewind 的 MAX_ANCHOR_GROUPS）。 */
const MAX_ANCHOR_GROUPS = 100;
/** prune 节流：至多每 60s 跑一次实际目录清理。 */
const PRUNE_INTERVAL_MS = 6e4;
/** 会话 id / callId 的文件名白名单（防路径穿越，同 dsh-rewind 语义）。 */
function safeSegment(value) {
	const replaced = value.replace(/[^a-zA-Z0-9._-]/g, "_");
	return replaced === "" || replaced === "." || replaced === ".." ? "session" : replaced;
}
var BeforeJournal = class {
	store;
	config;
	/** `${workspace}\0${sessionId}\0${path}` → 最近一次已知内容（recheck 增量判定的单一事实源）。 */
	lastKnown = /* @__PURE__ */ new Map();
	/** `${workspace}\0${sessionId}` → 跟踪路径集（进程内缓存；首条消息时从磁盘重建）。 */
	trackedCache = /* @__PURE__ */ new Map();
	/** 每会话单调时钟：同毫秒提交保持捕获顺序。 */
	lastEntryTime = /* @__PURE__ */ new Map();
	lastPruneAt = /* @__PURE__ */ new Map();
	constructor(store, config) {
		this.store = store;
		this.config = config;
	}
	sessionDir(workspace, sessionId) {
		return this.store.workspaceDir(workspace).then((dir) => join(dir, "before-journal", safeSegment(sessionId)));
	}
	knownKey(workspace, sessionId, path) {
		return `${workspace}\0${sessionId}\0${path}`;
	}
	/** 写入一条捕获记录（原子临时 + rename；内容内联）。 */
	async record(workspace, sessionId, entry) {
		const key = `${workspace}\0${sessionId}`;
		const previous = this.lastEntryTime.get(key) ?? 0;
		const time = Math.max(Date.now(), previous + 1);
		this.lastEntryTime.set(key, time);
		const dir = join(await this.sessionDir(workspace, sessionId), String(entry.anchorSeq));
		await mkdir(dir, { recursive: true });
		const record = {
			...entry,
			time
		};
		const file = join(dir, `${safeSegment(entry.callId)}.json`);
		const temp = `${file}.tmp`;
		await writeFile(temp, JSON.stringify(record), "utf8");
		await rename(temp, file);
		this.lastKnown.set(this.knownKey(workspace, sessionId, entry.path), entry.content);
		const tracked = this.trackedCache.get(`${workspace}\0${sessionId}`);
		if (tracked !== void 0) tracked.add(entry.path);
	}
	/**
	* 读取 anchorSeq >= afterSeq（**含边界**：回滚目标消息自己回合的变更也要回滚）
	* 的全部记录，并对每个路径保留**最早**一条（anchorSeq 最小，其次 time 最小）。
	*/
	async earliestAfter(workspace, sessionId, afterSeq) {
		const sessionDir = await this.sessionDir(workspace, sessionId);
		let anchorNames;
		try {
			anchorNames = await readdir(sessionDir);
		} catch {
			return /* @__PURE__ */ new Map();
		}
		const anchors = anchorNames.map((name) => Number.parseInt(name, 10)).filter((value) => Number.isSafeInteger(value) && value >= afterSeq).sort((left, right) => left - right);
		const earliest = /* @__PURE__ */ new Map();
		for (const anchor of anchors) {
			let files;
			try {
				files = await readdir(join(sessionDir, String(anchor)));
			} catch {
				continue;
			}
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				let entry;
				try {
					entry = JSON.parse(await readFile(join(sessionDir, String(anchor), file), "utf8"));
				} catch {
					continue;
				}
				if (typeof entry?.path !== "string" || typeof entry?.anchorSeq !== "number") continue;
				if (entry.anchorSeq < afterSeq) continue;
				const existing = earliest.get(entry.path);
				if (existing === void 0 || entry.anchorSeq < existing.anchorSeq || entry.anchorSeq === existing.anchorSeq && entry.time < existing.time) earliest.set(entry.path, entry);
			}
		}
		return earliest;
	}
	/**
	* 某会话被跟踪的路径集（user/message 边界重查用）。进程内缓存优先；
	* 缓存未命中时扫描全部 anchor 目录的记录重建（每会话每进程至多一次全扫）。
	*/
	async trackedPaths(workspace, sessionId) {
		const cacheKey = `${workspace}\0${sessionId}`;
		const cached = this.trackedCache.get(cacheKey);
		if (cached !== void 0) return cached;
		const paths = /* @__PURE__ */ new Set();
		const sessionDir = await this.sessionDir(workspace, sessionId);
		let anchorNames;
		try {
			anchorNames = await readdir(sessionDir);
		} catch {
			this.trackedCache.set(cacheKey, paths);
			return paths;
		}
		for (const anchor of anchorNames) {
			let files;
			try {
				files = await readdir(join(sessionDir, anchor));
			} catch {
				continue;
			}
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const entry = JSON.parse(await readFile(join(sessionDir, anchor, file), "utf8"));
					if (typeof entry?.path === "string") paths.add(entry.path);
				} catch {
					continue;
				}
			}
		}
		this.trackedCache.set(cacheKey, paths);
		return paths;
	}
	/** 最近一次已知内容（边界重查的增量判定基准；未记录过返回 undefined）。 */
	lastKnownContent(workspace, sessionId, path) {
		return this.lastKnown.get(this.knownKey(workspace, sessionId, path));
	}
	/**
	* 保留每会话最新 MAX_ANCHOR_GROUPS 个 anchor 组，删除最旧的组目录。
	* 返回被清理的 anchorSeq 清单（调用方据此删除对应的 kind 'message' 恢复点，
	* 让内容 GC 回收独占 blob）。无 link（未做内容去重），整目录删除即安全。
	*/
	async prune(workspace, sessionId) {
		const now = Date.now();
		const pruneKey = `${workspace}\0${sessionId}`;
		if (now - (this.lastPruneAt.get(pruneKey) ?? 0) < PRUNE_INTERVAL_MS) return [];
		this.lastPruneAt.set(pruneKey, now);
		const sessionDir = await this.sessionDir(workspace, sessionId);
		let anchorNames;
		try {
			anchorNames = await readdir(sessionDir);
		} catch {
			return [];
		}
		const stale = anchorNames.map((name) => Number.parseInt(name, 10)).filter((value) => Number.isSafeInteger(value)).sort((left, right) => right - left).slice(MAX_ANCHOR_GROUPS);
		const pruned = [];
		for (const anchor of stale) {
			await rm(join(sessionDir, String(anchor)), {
				recursive: true,
				force: true
			});
			pruned.push(anchor);
		}
		return pruned;
	}
};
//#endregion
export { BeforeJournal };
