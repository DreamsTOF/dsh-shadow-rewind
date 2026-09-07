import { diffsFromBeforeAfter } from "./client-recorded-diffs.js";
//#region src/client/fs-diff-utils.ts
/** 与宿主 hunk 数学同一基准的换行归一（file-review-service 的 normalizeNewlines 语义）。 */
function normalizeLf(text) {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
/** 归因字段投影（占位/补齐/提交各构造点共用）：全缺省时返回空对象。 */
function fsAttributionOf(source) {
	return {
		...source.owner !== void 0 ? { owner: source.owner } : {},
		...source.autoSelect !== void 0 ? { autoSelect: source.autoSelect } : {}
	};
}
/**
* 经 HTTP 按检查点读取文件内容。找不到或判定为二进制（NUL 字节守卫）时返回
* null——调用方一律把 null 当作「全文不可得」，而不是空文件。
*/
async function fetchCheckpointFileContent(checkpointId, path, cwd) {
	try {
		const params = new URLSearchParams({
			checkpointId,
			path,
			cwd
		});
		const response = await fetch(`/shadow-rewind/file?${params}`, {
			headers: { accept: "application/json" },
			cache: "no-store"
		});
		if (!response.ok) return null;
		const data = await response.json();
		if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
		const record = data;
		if (typeof record.content !== "string" || record.encoding !== "base64") return null;
		const binary = atob(record.content);
		const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
		const text = new TextDecoder("utf-8").decode(bytes);
		return text.includes("\0") ? null : text;
	} catch {
		return null;
	}
}
/**
* 从批量端点拉取所有轮次的文件系统变更。
* 宽松解析：未知 / 缺失字段一律降级（条目丢了就丢了），绝不因一个坏字段
* 让整个审查面白屏。
*/
async function fetchAllFsChanges(sessionId) {
	try {
		const response = await fetch(`/shadow-rewind/fs-changes?sessionId=${encodeURIComponent(sessionId)}`, {
			headers: { accept: "application/json" },
			cache: "no-store"
		});
		if (!response.ok) return { turns: [] };
		const data = await response.json();
		if (typeof data !== "object" || data === null || Array.isArray(data)) return { turns: [] };
		const record = data;
		if (!Array.isArray(record.turns)) return { turns: [] };
		const turns = [];
		for (const entry of record.turns) {
			if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
			const item = entry;
			if (typeof item.turn !== "number" || typeof item.turnStartSeq !== "number") continue;
			if (typeof item.checkpointId !== "string" || typeof item.nextCheckpointId !== "string") continue;
			if (!Array.isArray(item.changes)) continue;
			const changes = item.changes.map((change) => {
				if (typeof change !== "object" || change === null || Array.isArray(change)) return null;
				const c = change;
				if (typeof c.path !== "string" || c.path === "") return null;
				const kind = c.kind === "added" || c.kind === "modified" || c.kind === "deleted" ? c.kind : null;
				if (kind === null) return null;
				return {
					path: c.path,
					kind,
					...typeof c.added === "number" ? { added: c.added } : {},
					...typeof c.removed === "number" ? { removed: c.removed } : {},
					...typeof c.oldMode === "number" ? { oldMode: c.oldMode } : {},
					...typeof c.newMode === "number" ? { newMode: c.newMode } : {},
					...c.dir === true ? { dir: true } : {},
					...typeof c.owner === "string" && c.owner !== "" ? { owner: c.owner } : {},
					...typeof c.autoSelect === "boolean" ? { autoSelect: c.autoSelect } : {}
				};
			}).filter((change) => change !== null);
			if (changes.length > 0) turns.push({
				turn: item.turn,
				turnStartSeq: item.turnStartSeq,
				checkpointId: item.checkpointId,
				nextCheckpointId: item.nextCheckpointId,
				...item.live === true ? { live: true } : {},
				changes
			});
		}
		return {
			turns,
			...typeof record.rev === "number" ? { rev: record.rev } : {}
		};
	} catch {
		return { turns: [] };
	}
}
const WARM_THROTTLE_MS = 2e3;
const fsCache = /* @__PURE__ */ new Map();
const warmLastAt = /* @__PURE__ */ new Map();
const warmInFlight = /* @__PURE__ */ new Set();
/** 每会话最近一次 fs-changes 的数据版本；rev 未变则整轮 warm 跳过。 */
const warmLastRev = /* @__PURE__ */ new Map();
const cacheListeners = /* @__PURE__ */ new Set();
/** 订阅缓存刷新（卡片据此重新推导自己的 fs 条目）。 */
function subscribeFsCache(listener) {
	cacheListeners.add(listener);
	return () => {
		cacheListeners.delete(listener);
	};
}
/** 广播缓存变化。 */
function notifyFsCache() {
	for (const listener of cacheListeners) listener();
}
/** 供轮尾 select() 同步读取的入口：这一轮有 fs 变更吗？ */
function cachedFsTurnFor(turnStartSeq) {
	return fsCache.get(turnStartSeq);
}
/**
* 把某个会话的 fs-changes 预热进缓存（节流 + 发后不理）。
* 热路径调用是安全的：徽标渲染、快照订阅都可以随手调一次。
* rev 未变时（同构建宿主必带）直接跳过解析、缓存写入与通知——warm 的正确性
* 不再依赖 JSON 深比较；rev 缺省（旧宿主）回退到逐条 JSON 比较。
*/
function warmFsChanges(sessionId) {
	const now = Date.now();
	if (now - (warmLastAt.get(sessionId) ?? 0) < WARM_THROTTLE_MS || warmInFlight.has(sessionId)) return;
	warmLastAt.set(sessionId, now);
	warmInFlight.add(sessionId);
	fetchAllFsChanges(sessionId).then((payload) => {
		warmInFlight.delete(sessionId);
		if (payload.rev !== void 0) {
			const previous = warmLastRev.get(sessionId);
			if (previous !== void 0 && previous === payload.rev) return;
			warmLastRev.set(sessionId, payload.rev);
		}
		let changed = false;
		for (const turn of payload.turns) {
			const stamped = {
				...turn,
				sessionId
			};
			const existing = fsCache.get(turn.turnStartSeq);
			if (existing === void 0 || JSON.stringify(existing) !== JSON.stringify(stamped)) {
				fsCache.set(turn.turnStartSeq, stamped);
				invalidateLazyTurn(turn.turnStartSeq);
				changed = true;
			}
		}
		if (changed) notifyFsCache();
	}).catch(() => {
		warmInFlight.delete(sessionId);
	});
}
/** 按「会话 + 轮」同步读取（live 条的查找键；缓存条目都带 sessionId）。 */
function cachedFsTurnForSessionTurn(sessionId, turn) {
	for (const entry of fsCache.values()) if (entry.sessionId === sessionId && entry.turn === turn) return entry;
}
/** 某会话缓存的全部 fs 轮条目（按轮升序；live 条的会话累计视图用）。 */
function cachedFsTurnsForSession(sessionId) {
	const list = [];
	for (const entry of fsCache.values()) if (entry.sessionId === sessionId) list.push(entry);
	return list.sort((a, b) => a.turn - b.turn);
}
/** (turnStartSeq, path) → 全文条目的进行中/已完成请求。 */
const lazyDiffs = /* @__PURE__ */ new Map();
/** 懒加载记忆容量上限；超出淘汰最旧（会话数 × 轮数 × 文件数的防泄漏阀）。 */
const LAZY_MEMO_CAP = 512;
function lazyKey(turnStartSeq, path) {
	return `${String(turnStartSeq)}\u0000${path}`;
}
function invalidateLazyTurn(turnStartSeq) {
	const prefix = `${String(turnStartSeq)}\u0000`;
	for (const key of lazyDiffs.keys()) if (key.startsWith(prefix)) lazyDiffs.delete(key);
}
/**
* 拉取前后检查点内容，为一个文件系统级变更生成 ProducedFileDiff。
*
* 形状契约与宿主对齐：新增文件的 `oldText = null`（宿主的 fs 撤销 = 删文件），
* 删除文件的 `newText = ''`（宿主的 fs 撤销 = 写回旧内容）——两者都保持承载
* 宿主文件存在性语义的单条整文件形状。**修改**文件则切出真正的行级 hunks
* （与宿主 hunk 数学同一 LF 归一基准），多 hunk 的子集撤销因此与工具写入
* 同路。`nextCheckpointId` 可能是 'live'（= 当前磁盘）。
*/
async function generateFsDiff(fsChange, checkpointId, nextCheckpointId, cwd) {
	const { path, kind } = fsChange;
	const modes = {
		...fsChange.oldMode !== void 0 ? { oldMode: fsChange.oldMode } : {},
		...fsChange.newMode !== void 0 ? { newMode: fsChange.newMode } : {}
	};
	if (kind === "added") {
		const content = await fetchCheckpointFileContent(nextCheckpointId, path, cwd);
		if (content === null) return null;
		return [{
			path,
			oldText: null,
			newText: content,
			...modes
		}];
	}
	if (kind === "deleted") {
		const content = await fetchCheckpointFileContent(checkpointId, path, cwd);
		if (content === null) return null;
		return [{
			path,
			oldText: content,
			newText: "",
			...modes
		}];
	}
	const [oldContent, newContent] = await Promise.all([fetchCheckpointFileContent(checkpointId, path, cwd), fetchCheckpointFileContent(nextCheckpointId, path, cwd)]);
	if (oldContent === null || newContent === null) return null;
	const oldLf = normalizeLf(oldContent);
	const newLf = normalizeLf(newContent);
	if (oldLf === newLf) return [{
		path,
		oldText: oldContent,
		newText: newContent,
		...modes
	}];
	const hunks = diffsFromBeforeAfter(path, oldLf, newLf);
	if (hunks.length === 0) return [{
		path,
		oldText: oldContent,
		newText: newContent,
		...modes
	}];
	return hunks.map((hunk) => ({
		...hunk,
		...modes
	}));
}
/**
* 一个 fs 条目是否属于「本会话自己的轮变更」：检查点窗口归属里，明确属于
* **其它会话**（owner = 对方 sessionId）的条目不进轮尾卡片与 live 条——
* 多会话并行写同一工作区时，B 的轮卡不该显示（更不该撤销）A 在同窗口的
* 写盘。'target'（本会话）/ 'multi'（双方都改过，含本会话的写入）/
* 'unknown'（轮间手动 / 外部写盘）/ 缺失（旧宿主、归因失败保守保留）照常
* 显示。侧边栏 tab 不经过这里：它是带归属标签的勾选清单，可见性交给用户。
*/
function isOwnSessionChange(change) {
	const { owner } = change;
	return owner === void 0 || owner === "target" || owner === "multi" || owner === "unknown";
}
/**
* 一个 fs 条目的占位形态：零全文、带服务端行数。卡片/侧边栏/live 条先用它
* 渲染行与 +/−，内容在悬停、展开或撤销时经 ensureFsFileDiff 按需补齐。
*/
function fsTurnReviews(fsTurn, keep) {
	return fsTurn.changes.filter(isOwnSessionChange).filter((change) => keep?.(change) ?? true).map((change) => ({
		path: change.path,
		diffs: [],
		origin: "fs",
		...change.dir === true ? { dir: true } : {},
		...change.added !== void 0 || change.removed !== void 0 ? { counts: {
			added: change.added ?? 0,
			removed: change.removed ?? 0
		} } : {},
		...change.kind === "deleted" ? { deleted: true } : {}
	}));
}
/**
* 取一个 fs 条目的完整全文条目（撤销/展示 diff 用）。同一 (turn, path) 的
* 并发与后续调用复用同一个请求；该轮缓存条目被 warm 替换时记忆自动失效
* （live 条的磁盘内容会随回合推进而变化，绝不能跨更新复用）。
*/
function ensureFsFileDiff(fsTurn, path, cwd) {
	const change = fsTurn.changes.find((entry) => entry.path === path);
	if (change === void 0) return Promise.resolve(null);
	const key = lazyKey(fsTurn.turnStartSeq, path);
	const cached = lazyDiffs.get(key);
	if (cached !== void 0) return cached;
	const task = (async () => {
		const attribution = fsAttributionOf(change);
		if (change.dir === true) return {
			path,
			diffs: [{
				path,
				oldText: null,
				newText: ""
			}],
			origin: "fs",
			dir: true,
			...change.kind === "deleted" ? { deleted: true } : {},
			...attribution
		};
		const diffs = await generateFsDiff(change, fsTurn.checkpointId, fsTurn.nextCheckpointId, cwd);
		if (diffs === null) return null;
		return {
			path,
			diffs,
			origin: "fs",
			...change.kind === "deleted" ? { deleted: true } : {},
			...attribution
		};
	})();
	if (lazyDiffs.size >= LAZY_MEMO_CAP) {
		const oldest = lazyDiffs.keys().next().value;
		if (oldest !== void 0) lazyDiffs.delete(oldest);
	}
	lazyDiffs.set(key, task);
	return task;
}
/**
* 把一轮的文件系统变更转成带完整 diff 的 TurnFileChanges。
* 保留给「确知需要整轮全文」的调用方（如恢复对话框窗口统计）；常规渲染
* 走 fsTurnReviews + ensureFsFileDiff，避免无谓的全文 HTTP。
*/
async function convertFsTurnToFiles(fsTurn, cwd) {
	const files = [];
	for (const fsChange of fsTurn.changes) {
		const ensured = await ensureFsFileDiff(fsTurn, fsChange.path, cwd);
		if (ensured === null) {
			if (fsChange.kind === "deleted") files.push({
				path: fsChange.path,
				diffs: [],
				deleted: true,
				origin: "fs"
			});
			continue;
		}
		files.push(ensured);
	}
	if (files.length === 0) return null;
	return {
		turn: fsTurn.turn,
		live: false,
		files
	};
}
//#endregion
export { cachedFsTurnFor, cachedFsTurnForSessionTurn, cachedFsTurnsForSession, convertFsTurnToFiles, ensureFsFileDiff, fetchAllFsChanges, fetchCheckpointFileContent, fsAttributionOf, fsTurnReviews, subscribeFsCache, warmFsChanges };
