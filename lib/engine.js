import { ShadowRewindError, errorMessage } from "./errors.js";
import { assertSafeParents, canonicalDirectory, ensureSafeParents, isNodeError, pathExists, pruneEmptyParents, removeRestoreTarget, replaceRegularFile, replaceSymbolicLink, resolveWorkspacePath } from "./path-utils.js";
import { clearCaptureCache, readCaptureCache, writeCaptureCache } from "./capture-cache.js";
import { captureSnapshot } from "./capture.js";
import { COMMAND_WINDOW_DEFAULTS } from "./command-windows.js";
import { createDeadline } from "./deadline.js";
import { ShadowJj, jjAvailable } from "./jj-backend.js";
import "./types.js";
import { diffTrees, entriesEqual, makeId, sha256Hex } from "./manifest.js";
import { compileExcludes, scanWorkspace } from "./scan.js";
import { WorkspaceStore } from "./store.js";
import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { chmod, lstat, mkdir, open, readlink, rm } from "node:fs/promises";
import { join } from "node:path";
//#region src/engine.ts
/**
* 核心引擎：捕获 / 对比 / 计划 / 恢复 / 删除 / 崩溃恢复。
*
* 两条铁律贯穿全部路径：
*  1. 绝不调用工作区自身的任何 VCS——文件枚举只走目录扫描，快照字节只落在
*     影子 jj 仓库或 SQLite 内容库；
*  2. 恢复必须「计划限时 + 确认串逐字回显 + 恢复前自动 rescue 备份 +
*     操作日志 + 事后哈希验证」，任何一步不符立即 fail-closed。
*/
/** 默认排除清单：VCS 目录、依赖、构建产物与常见缓存（自用取向：宁多勿漏）。 */
const DEFAULT_EXCLUDES = [
	".git",
	".jj",
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	"__pycache__",
	".venv",
	"venv",
	".cache",
	"coverage",
	".next",
	".nuxt",
	".turbo",
	".parcel-cache",
	"tmp",
	"temp"
];
const DEFAULTS = {
	maxRestorePoints: 50,
	maxTurnCheckpointsPerSession: 30,
	maxFiles: 2e4,
	maxFileBytes: 16777216,
	maxSnapshotBytes: 536870912,
	planTtlMs: 9e5,
	staleLockMs: 3e4,
	turnCheckpointMode: "jj",
	turnCheckpointTimeoutMs: 5e3,
	turnCheckpointMaxNewBytes: 33554432,
	turnCheckpointTrust: "fast"
};
/** 解析配置：全部字段落定；非法值直接抛错（宁可拒绝启动也不带病运行）。 */
function resolveConfig(config) {
	const storageDir = typeof config.storageDir === "string" && config.storageDir.trim() !== "" ? config.storageDir : join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "shadow-rewind", "v1");
	const mode = config.turnCheckpointMode ?? DEFAULTS.turnCheckpointMode;
	if (mode !== "off" && mode !== "sqlite" && mode !== "jj") throw new ShadowRewindError("INVALID_CONFIG", "turnCheckpointMode 必须是 off、sqlite 或 jj");
	const trust = config.turnCheckpointTrust ?? DEFAULTS.turnCheckpointTrust;
	if (trust !== "fast" && trust !== "strict") throw new ShadowRewindError("INVALID_CONFIG", "turnCheckpointTrust 必须是 fast 或 strict");
	return {
		storageDir,
		maxRestorePoints: positiveInteger(config.maxRestorePoints ?? DEFAULTS.maxRestorePoints, "maxRestorePoints"),
		maxTurnCheckpointsPerSession: positiveInteger(config.maxTurnCheckpointsPerSession ?? DEFAULTS.maxTurnCheckpointsPerSession, "maxTurnCheckpointsPerSession"),
		maxFiles: positiveInteger(config.maxFiles ?? DEFAULTS.maxFiles, "maxFiles"),
		maxFileBytes: positiveInteger(config.maxFileBytes ?? DEFAULTS.maxFileBytes, "maxFileBytes"),
		maxSnapshotBytes: positiveInteger(config.maxSnapshotBytes ?? DEFAULTS.maxSnapshotBytes, "maxSnapshotBytes"),
		planTtlMs: positiveInteger(config.planTtlMs ?? DEFAULTS.planTtlMs, "planTtlMs"),
		staleLockMs: positiveInteger(config.staleLockMs ?? DEFAULTS.staleLockMs, "staleLockMs"),
		turnCheckpointMode: mode,
		turnCheckpointTimeoutMs: positiveInteger(config.turnCheckpointTimeoutMs ?? DEFAULTS.turnCheckpointTimeoutMs, "turnCheckpointTimeoutMs"),
		turnCheckpointMaxNewBytes: positiveInteger(config.turnCheckpointMaxNewBytes ?? DEFAULTS.turnCheckpointMaxNewBytes, "turnCheckpointMaxNewBytes"),
		turnCheckpointTrust: trust,
		excludePatterns: config.excludePatterns ?? DEFAULT_EXCLUDES,
		commandWindowFlushMs: positiveInteger(config.commandWindowFlushMs ?? COMMAND_WINDOW_DEFAULTS.flushMs, "commandWindowFlushMs"),
		commandWindowRetentionMs: positiveInteger(config.commandWindowRetentionMs ?? COMMAND_WINDOW_DEFAULTS.retentionMs, "commandWindowRetentionMs"),
		commandWindowMaxPerWorkspace: positiveInteger(config.commandWindowMaxPerWorkspace ?? COMMAND_WINDOW_DEFAULTS.maxPerWorkspace, "commandWindowMaxPerWorkspace"),
		commandWindowDetailBytes: nonNegativeInteger(config.commandWindowDetailBytes ?? COMMAND_WINDOW_DEFAULTS.detailBytes, "commandWindowDetailBytes")
	};
}
function positiveInteger(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new ShadowRewindError("INVALID_CONFIG", `${name} 必须是正整数`);
	return value;
}
function nonNegativeInteger(value, name) {
	if (!Number.isSafeInteger(value) || value < 0) throw new ShadowRewindError("INVALID_CONFIG", `${name} 必须是非负整数`);
	return value;
}
/** 引擎实例：一个插件进程共享一个（配置驱动，无隐藏全局状态）。 */
var ShadowRewindEngine = class {
	config;
	store;
	/** 启动恢复完成后的信号（恢复条数）。 */
	ready;
	/**
	* 实际生效的内容后端：配置为 jj 但宿主机缺 CLI 时自动降级为内置
	* SQLite 内容库（自动检查点不断档）；显式配置 sqlite/off 不受影响。
	*/
	effectiveBackend;
	/** 降级原因（未降级时为 undefined）。 */
	downgradeReason;
	excludes;
	plans = /* @__PURE__ */ new Map();
	applying = /* @__PURE__ */ new Set();
	shadowRepos = /* @__PURE__ */ new Map();
	/** 恢复后单次撤销（B1）：workspace → 最近一次恢复的逐路径 before/after。
	* 进程内记录，重启即失效；每次 applyRestore 替换上一次（无 redo）。 */
	undoRecords = /* @__PURE__ */ new Map();
	constructor(config = {}) {
		this.config = resolveConfig(config);
		if (this.config.turnCheckpointMode === "jj" && !jjAvailable()) {
			this.effectiveBackend = "sqlite";
			this.downgradeReason = "宿主机没有可用的 jj CLI，自动检查点已降级为内置 SQLite 存储";
		} else this.effectiveBackend = this.config.turnCheckpointMode === "jj" ? "jj" : "sqlite";
		this.excludes = compileExcludes(this.config.excludePatterns);
		this.store = new WorkspaceStore(this.config);
		this.ready = this.store.initialize();
	}
	/** 自动检查点是否被配置关闭（与降级区分）。 */
	get turnCheckpointsDisabled() {
		return this.config.turnCheckpointMode === "off";
	}
	async assertReady(signal) {
		if (signal !== void 0) {
			let abort = () => {};
			const aborted = new Promise((_resolve, reject) => {
				abort = () => reject(signal.reason);
			});
			signal.addEventListener("abort", abort, { once: true });
			try {
				await Promise.race([this.ready, aborted]);
			} finally {
				signal.removeEventListener("abort", abort);
			}
			return;
		}
		await this.ready;
	}
	shadowRepo(workspace) {
		let repo = this.shadowRepos.get(workspace);
		if (repo === void 0) {
			const key = sha256Hex(Buffer.from(workspace, "utf8")).slice(0, 16);
			repo = new ShadowJj(join(this.config.storageDir, "shadow-repos", key));
			this.shadowRepos.set(workspace, repo);
		}
		return repo;
	}
	/**
	* 扫描 + 捕获当前树（共用 stat 缓存增量，sqlite 与 jj 后端同路径）。
	*  - mode = 'inspect'：只构建 entries（供对比/计划）；缓存只读不写回，
	*    避免把对比时刻的 stat 事实污染成下一次持久捕获的增量依据；
	*  - mode = 'persist'：新读内容写入内容后端（sqlite 批量入库 / jj 镜像提交），
	*    并写回缓存，返回 commitId。
	*/
	async captureTree(workspace, options) {
		const scan = await scanWorkspace(workspace, {
			maxFileBytes: this.config.maxFileBytes,
			excludes: this.excludes,
			signal: options.signal
		});
		const workspaceDir = await this.store.workspaceDir(workspace);
		const cachePath = join(workspaceDir, "stat-cache.json");
		const cache = await readCaptureCache(cachePath);
		const verifyContent = async (path, blob) => {
			if (this.effectiveBackend === "jj") return pathExists(join(this.shadowRepo(workspace).repoDir, "checkpoint", ...path.split("/")));
			return this.store.sqliteBlobExists(workspace, blob);
		};
		const captured = await captureSnapshot({
			root: scan.root,
			paths: scan.paths,
			skippedAtScan: scan.skipped,
			emptyDirs: scan.emptyDirs,
			maxFiles: this.config.maxFiles,
			maxSnapshotBytes: this.config.maxSnapshotBytes,
			strict: this.config.turnCheckpointTrust === "strict",
			cache,
			...options.mode === "persist" ? { verifyContent } : {},
			signal: options.signal
		});
		let commitId;
		if (options.mode === "persist") {
			if (this.effectiveBackend === "jj") commitId = await this.persistJj(workspace, scan.paths, captured, options.message ?? "checkpoint", options.signal);
			else {
				const items = [];
				for (const [path, content] of captured.newContent) {
					const entry = captured.entries[path];
					if (entry === void 0 || entry.kind !== "file") continue;
					items.push({
						hash: entry.blob,
						content
					});
				}
				await this.store.putSqliteBlobs(workspace, items);
			}
			await writeCaptureCache(cachePath, captured.nextCache);
		}
		return {
			root: scan.root,
			entries: captured.entries,
			skipped: captured.skipped,
			treeHash: captured.treeHash,
			fileCount: captured.fileCount,
			totalBytes: captured.totalBytes,
			...commitId === void 0 ? {} : { commitId }
		};
	}
	/**
	* jj 持久化：仓库丢失（JJ_REPO_LOST）时删残骸 + 清缓存 + 重试一次。
	* 关键不变量：仓库丢失时 verifyContent 必然拒绝所有命中项（镜像文件已
	* 随仓库消失），因此首轮捕获已是全量重读——newContent 完整，重试无需
	* 重新扫描读取，直接用首轮内容重建仓库即可。
	*/
	async persistJj(workspace, scanPaths, captured, message, signal) {
		const captureOnce = () => this.shadowRepo(workspace).capture(scanPaths, captured.newContent, captured.newLinks, message, {
			maxNewBytes: this.config.turnCheckpointMaxNewBytes,
			signal
		});
		try {
			return (await captureOnce()).commitId;
		} catch (error) {
			if (!(error instanceof ShadowRewindError && (error.code === "JJ_REPO_LOST" || error.code === "JJ_COMMAND_FAILED" && error.message.includes("no jj repo")))) throw error;
		}
		await rm(join(this.config.storageDir, "shadow-repos", sha256Hex(Buffer.from(workspace, "utf8")).slice(0, 16)), {
			recursive: true,
			force: true
		});
		await clearCaptureCache(join(await this.store.workspaceDir(workspace), "stat-cache.json"));
		this.shadowRepos.delete(workspace);
		return (await captureOnce()).commitId;
	}
	/** 创建一个持久化恢复点（user / rescue）。 */
	async create(options) {
		await this.assertReady(options.signal);
		const workspace = await canonicalDirectory(options.cwd);
		await this.store.assertStorageSeparated(workspace);
		const release = await this.store.acquire(workspace, options.signal);
		try {
			if (options.kind !== "rescue") {
				if ((await this.store.listManifests(workspace)).filter((manifest) => manifest.kind === "user").length >= this.config.maxRestorePoints) throw new ShadowRewindError("RESTORE_POINT_LIMIT", `手动恢复点数量已达上限 ${String(this.config.maxRestorePoints)}`);
			}
			return summarize(await this.createLocked(workspace, {
				kind: options.kind === "rescue" ? "rescue" : "user",
				sessionId: options.sessionId,
				label: options.label,
				parentRestorePoint: options.parentRestorePoint,
				signal: options.signal
			}));
		} finally {
			await release();
		}
	}
	/** 捕获回合检查点（turn）；重复请求同一回合同一相位时幂等返回已有检查点。
	* phase 'start'（缺省）= 轮第一步之前；'end' = turn/end 事件时的轮末快照。 */
	async createTurnCheckpoint(options) {
		const phase = options.phase ?? "start";
		const deadline = createDeadline(this.config.turnCheckpointTimeoutMs);
		const signal = options.signal === void 0 ? deadline.signal : AbortSignal.any([options.signal, deadline.signal]);
		try {
			await this.assertReady(signal);
			if (this.turnCheckpointsDisabled) throw new ShadowRewindError("TURN_CHECKPOINT_DISABLED", "自动回合检查点已关闭");
			if (!Number.isSafeInteger(options.turn) || options.turn < 0 || !Number.isSafeInteger(options.turnStartSeq) || options.turnStartSeq < 0) throw new ShadowRewindError("INVALID_ARGUMENTS", "turn 与 turnStartSeq 必须是非负整数");
			const workspace = await canonicalDirectory(options.cwd);
			await this.store.assertStorageSeparated(workspace);
			const release = await this.store.acquire(workspace, signal);
			try {
				const existing = await this.store.listManifests(workspace);
				const duplicate = existing.find((manifest) => manifest.kind === "turn" && manifest.sessionId === options.sessionId && manifest.turn === options.turn && manifest.turnStartSeq === options.turnStartSeq && (manifest.phase ?? "start") === phase);
				if (duplicate !== void 0) {
					await this.store.deleteTurnSkip(workspace, options.sessionId, options.turn, options.turnStartSeq).catch(() => void 0);
					return summarize(duplicate);
				}
				const manifest = await this.createLocked(workspace, {
					kind: "turn",
					sessionId: options.sessionId,
					turn: options.turn,
					turnStartSeq: options.turnStartSeq,
					phase,
					...phase === "end" && options.intent !== void 0 ? { intent: options.intent } : {},
					label: `turn ${String(options.turn)} ${phase === "end" ? "轮末" : "轮起"}检查点`,
					signal
				});
				await this.store.deleteTurnSkip(workspace, options.sessionId, options.turn, options.turnStartSeq).catch(() => void 0);
				const sameSession = [...existing, manifest].filter((point) => point.kind === "turn" && point.sessionId === options.sessionId && (point.phase ?? "start") === phase).sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
				for (const stale of sameSession.slice(this.config.maxTurnCheckpointsPerSession)) {
					if (signal.aborted) break;
					if (await this.isReferencedByRecovery(workspace, stale.id)) continue;
					await this.store.deleteManifest(workspace, stale.id).catch(() => void 0);
				}
				return summarize(manifest);
			} finally {
				await release();
			}
		} catch (error) {
			throw wrapCheckpointDeadline(error, this.config.turnCheckpointTimeoutMs, deadline.signal.aborted);
		} finally {
			deadline.cancel();
		}
	}
	/** 查找一个回合的轮起检查点（可选校验 turnStartSeq；轮末相位不参与恢复点查找）。 */
	async findTurnCheckpoint(options) {
		await this.assertReady();
		const workspace = await canonicalDirectory(options.cwd);
		const found = (await this.store.listManifests(workspace)).find((manifest) => manifest.kind === "turn" && manifest.phase !== "end" && manifest.sessionId === options.sessionId && manifest.turn === options.turn && (options.turnStartSeq === void 0 || manifest.turnStartSeq === options.turnStartSeq));
		return found === void 0 ? void 0 : summarize(found);
	}
	/** 持久化一次检查点跳过（UI 重启后仍可见）。 */
	async recordTurnCheckpointSkip(options) {
		await this.assertReady();
		const workspace = await canonicalDirectory(options.cwd);
		await this.store.writeTurnSkip(workspace, {
			sessionId: options.sessionId,
			turn: options.turn,
			turnStartSeq: options.turnStartSeq,
			reason: options.reason.slice(0, 2e3)
		});
	}
	/** 读取持久化的检查点跳过记录。 */
	async findTurnCheckpointSkip(options) {
		await this.assertReady();
		const workspace = await canonicalDirectory(options.cwd);
		return this.store.readTurnSkip(workspace, options.sessionId, options.turn, options.turnStartSeq);
	}
	/** 列出某会话的所有 turn 检查点（轮起+轮末，按 turn 升序；摘要带 phase）。 */
	async listTurnCheckpoints(options) {
		await this.assertReady();
		const workspace = await canonicalDirectory(options.cwd);
		return (await this.store.listManifests(workspace)).filter((manifest) => manifest.kind === "turn" && manifest.sessionId === options.sessionId).sort((left, right) => (left.turn ?? 0) - (right.turn ?? 0) || left.id.localeCompare(right.id)).map(summarize);
	}
	/**
	* 对比两个检查点的 entries，生成文件系统级别的变更列表。
	* 用于捕获 PowerShell 等终端命令创建/修改/删除的文件（这些没有工具结果节点）。
	* 返回的 changes 结构与 diffTrees 一致，但来源是快照间对比而非当前树。
	*/
	async diffCheckpoints(options) {
		await this.assertReady();
		const workspace = await canonicalDirectory(options.cwd);
		const prevManifest = await this.store.readManifest(workspace, options.prevCheckpointId);
		const currManifest = await this.store.readManifest(workspace, options.currCheckpointId);
		const changes = diffTrees(prevManifest.entries, currManifest.entries);
		const skippedMap = /* @__PURE__ */ new Map();
		for (const skip of prevManifest.skippedPaths) skippedMap.set(skip.path, skip);
		for (const skip of currManifest.skippedPaths) skippedMap.set(skip.path, skip);
		return {
			changes,
			skippedPaths: [...skippedMap.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
		};
	}
	/**
	* 从指定检查点读取文件内容。用于为文件系统变更生成完整 diff。
	* 返回 null 表示文件在该检查点不存在（新增或删除）。
	*/
	async getFileContentFromCheckpoint(options) {
		await this.assertReady();
		const workspace = await canonicalDirectory(options.cwd);
		const manifest = await this.store.readManifest(workspace, options.checkpointId);
		const entry = manifest.entries[options.path];
		if (!entry || entry.kind !== "file") return null;
		return this.readSnapshotContent(manifest, options.path);
	}
	/**
	* 降级标注（degraded）：检查点的快照内容是否仍可读。抽样「最小的文件条目」
	* 走真实读取路径探测两个后端（jj 影子仓库 / sqlite blob）；清单不存在或
	* 抽样读取失败 = 不可读。只读探测，绝不写任何数据。
	* 借鉴 dsh-checkpoint-diff 的 degraded 标注思路：丢失节点诚实标注，
	* 而不是等到恢复/读取时才响亮报错。
	*/
	async checkpointContentReadable(options) {
		await this.assertReady();
		const workspace = await canonicalDirectory(options.cwd);
		const manifest = await this.store.readManifest(workspace, options.restorePointId);
		let smallest;
		for (const [path, entry] of Object.entries(manifest.entries)) {
			if (entry.kind !== "file") continue;
			if (smallest === void 0 || entry.size < smallest.size) smallest = {
				path,
				size: entry.size
			};
		}
		if (smallest === void 0) return true;
		try {
			await this.readSnapshotContent(manifest, smallest.path);
			return true;
		} catch {
			return false;
		}
	}
	/** 实际创建 manifest 的内部路径：调用方必须已持有工作区锁。 */
	async createLocked(workspace, options) {
		const tree = await this.captureTree(workspace, {
			mode: "persist",
			message: options.kind === "turn" ? `turn ${String(options.turn)} ${options.phase === "end" ? "end" : "start"} checkpoint (session ${options.sessionId ?? "?"})` : options.kind === "rescue" ? `rescue before restoring ${options.parentRestorePoint ?? "?"}` : options.label ?? "user restore point",
			signal: options.signal
		});
		const manifest = {
			version: 1,
			id: makeId("rp"),
			kind: options.kind,
			workspace,
			storage: this.effectiveBackend,
			...tree.commitId === void 0 ? {} : { commitId: tree.commitId },
			...options.sessionId === void 0 ? {} : { sessionId: options.sessionId },
			...options.label === void 0 ? {} : { label: options.label },
			...options.parentRestorePoint === void 0 ? {} : { parentRestorePoint: options.parentRestorePoint },
			...options.turn === void 0 ? {} : { turn: options.turn },
			...options.turnStartSeq === void 0 ? {} : { turnStartSeq: options.turnStartSeq },
			...options.phase === void 0 ? {} : { phase: options.phase },
			...options.intent === void 0 ? {} : { intent: options.intent },
			createdAt: Date.now(),
			treeHash: tree.treeHash,
			fileCount: tree.fileCount,
			totalBytes: tree.totalBytes,
			entries: tree.entries,
			skippedPaths: tree.skipped,
			restoreCount: 0
		};
		await this.store.writeManifest(workspace, manifest);
		if (options.kind !== "turn") {
			if ((await this.store.collectGarbage(workspace)).deletedBlobs > 0) await clearCaptureCache(join(await this.store.workspaceDir(workspace), "stat-cache.json"));
		}
		if (options.kind === "rescue") {
			const rescues = (await this.store.listManifests(workspace)).filter((point) => point.kind === "rescue").sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
			for (const stale of rescues.slice(Math.max(1, this.config.maxRestorePoints))) {
				if (await this.isReferencedByRecovery(workspace, stale.id)) continue;
				await this.store.deleteManifest(workspace, stale.id).catch(() => void 0);
			}
		}
		return manifest;
	}
	/** 列出恢复点（默认不含 turn 与 rescue；调用方按需打开）。 */
	async list(options) {
		await this.assertReady();
		const workspace = await canonicalDirectory(options.cwd);
		return (await this.store.listManifests(workspace)).filter((manifest) => manifest.kind === "user" || manifest.kind === "rescue" && options.includeRescue === true || manifest.kind === "turn" && options.includeTurnCheckpoints === true).map(summarize);
	}
	/** 对比一个恢复点与当前工作区（跳过项以明细透出，不混入 changes）。 */
	async inspect(options) {
		await this.assertReady(options.signal);
		const workspace = await canonicalDirectory(options.cwd);
		const release = await this.store.acquire(workspace, options.signal);
		try {
			const manifest = await this.store.readManifest(workspace, options.restorePointId);
			const current = await this.captureTree(workspace, {
				mode: "inspect",
				signal: options.signal
			});
			const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path));
			return {
				restorePoint: summarize(manifest),
				currentTreeHash: current.treeHash,
				changes: diffTrees(manifest.entries, current.entries).filter((change) => !skippedSet.has(change.path)),
				skippedPaths: manifest.skippedPaths
			};
		} finally {
			await release();
		}
	}
	/** 生成限时恢复计划（确认串必须逐字回显）。 */
	/**
	* 对称模式路径归因的数据源：晚于目标恢复点的全部快照（其它会话的 turn
	* 检查点、rescue 点等），按时间升序，entries 投影到给定路径集。检查点在
	* 回合开始时捕获，因此窗口 [S_j, S_{j+1}) 的写者就是 S_j 的会话。
	* 上限 64 个：归因只是预览里的建议标签（勾选权在用户），更早的时间线
	* 不再细分。
	*/
	async listSnapshotsAfter(options) {
		await this.assertReady(options.signal);
		const workspace = await canonicalDirectory(options.cwd);
		const target = await this.store.readManifest(workspace, options.restorePointId);
		const later = (await this.store.listManifests(workspace)).filter((manifest) => manifest.id !== target.id && manifest.createdAt >= target.createdAt).sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id)).slice(0, 64);
		return {
			targetSessionId: target.sessionId,
			snapshots: later.map((manifest) => {
				const entries = Object.create(null);
				for (const path of options.paths) {
					const entry = manifest.entries[path];
					entries[path] = entry === void 0 ? null : entry;
				}
				return {
					id: manifest.id,
					...manifest.sessionId === void 0 ? {} : { sessionId: manifest.sessionId },
					createdAt: manifest.createdAt,
					entries
				};
			})
		};
	}
	async planRestore(options) {
		await this.assertReady(options.signal);
		this.expirePlans();
		const workspace = await canonicalDirectory(options.cwd);
		const release = await this.store.acquire(workspace, options.signal);
		try {
			const manifest = await this.store.readManifest(workspace, options.restorePointId);
			const current = await this.captureTree(workspace, {
				mode: "inspect",
				signal: options.signal
			});
			if (options.expectedCurrentTreeHash !== void 0 && options.expectedCurrentTreeHash !== current.treeHash) throw new ShadowRewindError("PLAN_STALE", "检查之后工作区又发生了变化；请重新检查");
			const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path));
			let changes = diffTrees(manifest.entries, current.entries).filter((change) => !skippedSet.has(change.path));
			if (options.paths !== void 0) {
				const changePaths = new Set(changes.map((change) => change.path));
				const unknown = options.paths.filter((path) => !changePaths.has(path));
				if (unknown.length > 0) throw new ShadowRewindError("INVALID_ARGUMENTS", `以下路径不在恢复点 ${manifest.id} 的变更清单里：${unknown.slice(0, 5).join(", ")}`);
				const wanted = new Set(options.paths);
				changes = changes.filter((change) => wanted.has(change.path));
				if (changes.length === 0) throw new ShadowRewindError("NO_CHANGES", "勾选的路径没有可恢复的变更");
			}
			if (changes.length === 0) throw new ShadowRewindError("NO_CHANGES", `工作区已经与恢复点 ${manifest.id} 一致`);
			const expected = Object.create(null);
			for (const change of changes) expected[change.path] = current.entries[change.path] ?? null;
			const now = Date.now();
			const plan = {
				id: makeId("plan"),
				restorePointId: manifest.id,
				workspace,
				...options.sessionId === void 0 ? {} : { sessionId: options.sessionId },
				createdAt: now,
				expiresAt: now + this.config.planTtlMs,
				confirmation: `RESTORE-${randomBytes(4).toString("hex").toUpperCase()}`,
				changes,
				skippedPaths: manifest.skippedPaths,
				expected
			};
			this.plans.set(plan.id, plan);
			return structuredClonePlan(plan);
		} finally {
			await release();
		}
	}
	/** 执行一个已批准的恢复计划：rescue → 日志 → 恢复 → 验证（失败自动回滚）。 */
	async applyRestore(options) {
		await this.assertReady(options.signal);
		this.expirePlans();
		const plan = this.plans.get(options.planId);
		if (plan === void 0 || plan.expired === true) throw new ShadowRewindError("PLAN_NOT_FOUND", `恢复计划 ${options.planId} 不存在或已过期`);
		if (plan.confirmation !== options.confirmation) throw new ShadowRewindError("CONFIRMATION_MISMATCH", "确认串与恢复计划不一致");
		if (plan.sessionId !== void 0 && plan.sessionId !== options.sessionId) throw new ShadowRewindError("SESSION_MISMATCH", "恢复计划属于另一个会话");
		if (this.applying.has(plan.id)) throw new ShadowRewindError("PLAN_IN_PROGRESS", "该恢复计划正在执行");
		this.applying.add(plan.id);
		try {
			const release = await this.store.acquire(plan.workspace, options.signal);
			try {
				const manifest = await this.store.readManifest(plan.workspace, plan.restorePointId);
				const current = await this.captureTree(plan.workspace, {
					mode: "inspect",
					signal: options.signal
				});
				assertPlanFresh(plan, current.entries);
				const rescue = await this.createLocked(plan.workspace, {
					kind: "rescue",
					label: `恢复 ${manifest.id} 之前`,
					parentRestorePoint: manifest.id,
					sessionId: options.sessionId,
					signal: options.signal
				});
				const operation = {
					version: 1,
					id: makeId("op"),
					workspace: plan.workspace,
					restorePointId: manifest.id,
					rescuePointId: rescue.id,
					...options.sessionId === void 0 ? {} : { sessionId: options.sessionId },
					paths: plan.changes.map((change) => change.path),
					startedAt: Date.now(),
					state: "running"
				};
				await this.store.writeOperation(operation);
				try {
					await this.restorePaths(plan.workspace, manifest, plan.changes.map((change) => change.path), options.signal);
					await this.verifyRestored(plan.workspace, manifest, operation.paths, options.signal);
					await this.store.writeOperation({
						...operation,
						state: "completed",
						finishedAt: Date.now()
					});
					await this.store.writeManifest(plan.workspace, {
						...manifest,
						restoreCount: manifest.restoreCount + 1,
						lastRestoredAt: Date.now()
					});
					this.plans.delete(plan.id);
					this.undoRecords.set(plan.workspace, {
						operationId: operation.id,
						restorePointId: manifest.id,
						rescuePointId: rescue.id,
						time: Date.now(),
						files: plan.changes.map((change) => ({
							rel: change.path,
							before: current.entries[change.path] ?? null,
							after: manifest.entries[change.path] ?? null
						}))
					});
					return {
						operationId: operation.id,
						restorePointId: manifest.id,
						rescuePointId: rescue.id,
						restoredPaths: operation.paths
					};
				} catch (error) {
					await this.store.writeOperation({
						...operation,
						state: "rollback-running"
					}).catch(() => void 0);
					try {
						const affected = [.../* @__PURE__ */ new Set([...operation.paths, ...diffTrees(rescue.entries, current.entries).map((change) => change.path)])];
						await this.restorePaths(plan.workspace, rescue, affected, options.signal);
						await this.verifyRestored(plan.workspace, rescue, affected, options.signal);
						await this.store.writeOperation({
							...operation,
							state: "rolled-back",
							finishedAt: Date.now(),
							error: errorMessage(error)
						});
						throw new ShadowRewindError("RESTORE_FAILED_ROLLED_BACK", `恢复失败，已自动从备份 ${rescue.id} 还原：${errorMessage(error)}`, { cause: error });
					} catch (rollbackError) {
						if (rollbackError instanceof ShadowRewindError && rollbackError.code === "RESTORE_FAILED_ROLLED_BACK") throw rollbackError;
						await this.store.writeOperation({
							...operation,
							state: "recovery-required",
							finishedAt: Date.now(),
							error: errorMessage(error),
							rollbackError: errorMessage(rollbackError)
						}).catch(() => void 0);
						throw new ShadowRewindError("RECOVERY_REQUIRED", `恢复失败且回滚也失败；可从备份点 ${rescue.id} 手工恢复。主错误：${errorMessage(error)}；回滚错误：${errorMessage(rollbackError)}`);
					}
				}
			} finally {
				await release();
			}
		} finally {
			this.applying.delete(plan.id);
		}
	}
	/**
	* 撤销最近一次恢复（B1，借鉴 dsh-checkpoint-diff 的 rollback-undo）。
	*
	* 语义：
	*  - 进程内单次 undo，无 redo——记录随 applyRestore 替换、撤销成功即删除、
	*    重启失效（真正的兜底是 rescue 备份点本身，它有独立配额与持久化）；
	*  - 逐路径 CAS：当前磁盘条目必须仍等于「恢复后」的状态（内容寻址等价），
	*    被后续改动过的路径跳过并如实报告，绝不猜着回退；全部跳过 → 409；
	*  - 撤销动作复用 rescue 清单的 restorePaths（全套安全路径：围栏断言、
	*    原子写、空目录回收、非空拒删）；before=null 的路径（恢复新建的）撤销
	*    即删除——「绝不删除」的唯一例外，删的是恢复操作自己刚创建的文件。
	*/
	async undoLastRestore(options) {
		await this.assertReady(options.signal);
		const workspace = await canonicalDirectory(options.cwd);
		const record = this.undoRecords.get(workspace);
		if (record === void 0) throw new ShadowRewindError("UNDO_NOT_FOUND", "没有可撤销的恢复（进程内只保留最近一次，重启后失效；可从恢复时自动创建的备份点手工恢复）");
		const release = await this.store.acquire(workspace, options.signal);
		try {
			const rescue = await this.store.readManifest(workspace, record.rescuePointId);
			const current = await this.captureTree(workspace, {
				mode: "inspect",
				signal: options.signal
			});
			const undonePaths = [];
			const skippedPaths = [];
			for (const file of record.files) {
				const now = current.entries[file.rel] ?? null;
				if (!(file.after === null ? now === null : now !== null && entriesEqual(now, file.after))) {
					skippedPaths.push({
						path: file.rel,
						reason: "恢复后的内容又被修改过，已跳过"
					});
					continue;
				}
				try {
					await this.restorePaths(workspace, rescue, [file.rel], options.signal);
					await this.verifyRestored(workspace, rescue, [file.rel], options.signal);
					undonePaths.push(file.rel);
				} catch (error) {
					skippedPaths.push({
						path: file.rel,
						reason: `撤销失败：${errorMessage(error)}`
					});
				}
			}
			if (undonePaths.length === 0) throw new ShadowRewindError("UNDO_CONFLICT", `全部路径都已被后续修改，无法撤销；可从备份点 ${record.rescuePointId} 手工恢复`);
			this.undoRecords.delete(workspace);
			return {
				operationId: record.operationId,
				restorePointId: record.restorePointId,
				rescuePointId: record.rescuePointId,
				undonePaths,
				skippedPaths
			};
		} finally {
			await release();
		}
	}
	/** 删除一个恢复点（确认串必须逐字等于 `DELETE <id>`）。 */
	async delete(options) {
		await this.assertReady(options.signal);
		if (options.confirmation !== `DELETE ${options.restorePointId}`) throw new ShadowRewindError("CONFIRMATION_MISMATCH", `确认串必须逐字等于 "DELETE ${options.restorePointId}"`);
		const workspace = await canonicalDirectory(options.cwd);
		const release = await this.store.acquire(workspace, options.signal);
		try {
			if (await this.isReferencedByRecovery(workspace, options.restorePointId)) throw new ShadowRewindError("RECOVERY_REFERENCE", "该恢复点仍被未完成的恢复日志引用，不能删除");
			await this.store.deleteManifest(workspace, options.restorePointId);
			const gc = await this.store.collectGarbage(workspace);
			if (gc.deletedBlobs > 0) await clearCaptureCache(join(await this.store.workspaceDir(workspace), "stat-cache.json"));
			return {
				restorePointId: options.restorePointId,
				deletedBlobs: gc.deletedBlobs
			};
		} finally {
			await release();
		}
	}
	/** 列出中断/需要人工介入的恢复操作。 */
	async listRecovery(options) {
		await this.assertReady();
		const workspace = await canonicalDirectory(options.cwd);
		return (await this.store.listOperations(workspace)).filter((operation) => operation.state === "interrupted" || operation.state === "recovery-required").map((operation) => ({
			operationId: operation.id,
			restorePointId: operation.restorePointId,
			rescuePointId: operation.rescuePointId,
			state: operation.state,
			paths: operation.paths,
			startedAt: operation.startedAt,
			...operation.error === void 0 ? {} : { error: operation.error },
			...operation.rollbackError === void 0 ? {} : { rollbackError: operation.rollbackError }
		}));
	}
	/** 从 manifest 的后端读取一个路径的快照字节。 */
	async readSnapshotContent(manifest, path, signal) {
		if (manifest.storage === "jj") {
			if (manifest.commitId === void 0) throw new ShadowRewindError("STATE_CORRUPT", `jj 恢复点 ${manifest.id} 缺少 commitId`);
			const content = await this.shadowRepo(manifest.workspace).readSnapshot(manifest.commitId, path, signal);
			if (content === null) throw new ShadowRewindError("STATE_CORRUPT", `影子仓库中不存在 ${JSON.stringify(path)}（commit ${manifest.commitId}）`);
			return content;
		}
		const entry = manifest.entries[path];
		if (entry === void 0 || entry.kind !== "file") throw new ShadowRewindError("STATE_CORRUPT", `恢复点 ${manifest.id} 不含文件 ${JSON.stringify(path)}`);
		return this.store.readSqliteBlob(manifest.workspace, entry.blob);
	}
	/** 把一组路径恢复成 manifest 记录的状态（先删后写；目录按需重建/回收）。 */
	async restorePaths(workspace, manifest, paths, signal) {
		const root = await canonicalDirectory(workspace);
		const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path));
		const deletions = paths.filter((path) => manifest.entries[path] === void 0 && !skippedSet.has(path) && !hasDescendantEntry(manifest, path)).sort((left, right) => depthOf(right) - depthOf(left));
		const restorations = paths.filter((path) => manifest.entries[path] !== void 0).sort((left, right) => depthOf(left) - depthOf(right));
		for (const path of deletions) {
			signal?.throwIfAborted();
			const target = resolveWorkspacePath(root, path);
			await assertSafeParents(root, target);
			await removeRestoreTarget(target);
			await pruneEmptyParents(root, target);
		}
		for (const path of restorations) {
			signal?.throwIfAborted();
			const entry = manifest.entries[path];
			if (entry === void 0) continue;
			const target = resolveWorkspacePath(root, path);
			await ensureSafeParents(root, target);
			if (entry.kind === "symlink") {
				await removeRestoreTarget(target);
				await replaceSymbolicLink(target, entry.target);
				continue;
			}
			if (entry.kind === "dir") {
				await removeRestoreTarget(target);
				await mkdir(target);
				if (process.platform !== "win32") await chmod(target, entry.mode);
				continue;
			}
			const content = await this.readSnapshotContent(manifest, path, signal);
			if (sha256Hex(content) !== entry.blob) throw new ShadowRewindError("BLOB_CORRUPT", `路径 ${JSON.stringify(path)} 的快照字节未通过哈希校验`);
			await removeRestoreTarget(target);
			await replaceRegularFile(target, content, entry.mode);
		}
	}
	/** 恢复后验证：每个路径重新落盘读取并与快照条目全等。 */
	async verifyRestored(workspace, manifest, paths, signal) {
		const root = await canonicalDirectory(workspace);
		for (const path of paths) {
			signal?.throwIfAborted();
			const entry = manifest.entries[path];
			const target = resolveWorkspacePath(root, path);
			if (entry === void 0) {
				if (hasDescendantEntry(manifest, path)) {
					let info;
					try {
						info = await lstat(target);
					} catch (error) {
						if (isNodeError(error, "ENOENT")) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后隐式目录缺失：${JSON.stringify(path)}`);
						throw error;
					}
					if (!info.isDirectory()) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后类型不符（应为目录）：${JSON.stringify(path)}`);
					continue;
				}
				let gone = false;
				try {
					await lstat(target);
				} catch (error) {
					gone = isNodeError(error, "ENOENT");
				}
				if (!gone) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后路径仍存在：${JSON.stringify(path)}`);
				continue;
			}
			let info;
			try {
				info = await lstat(target, { bigint: true });
			} catch (error) {
				if (isNodeError(error, "ENOENT")) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后路径缺失：${JSON.stringify(path)}`);
				throw error;
			}
			if (entry.kind === "symlink") {
				if (!info.isSymbolicLink()) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后类型不符（应为符号链接）：${JSON.stringify(path)}`);
				if (await readlink(target) !== entry.target) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后符号链接指向不符：${JSON.stringify(path)}`);
				continue;
			}
			if (entry.kind === "dir") {
				if (!info.isDirectory()) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后类型不符（应为目录）：${JSON.stringify(path)}`);
				if (process.platform !== "win32" && Number(info.mode & 4095n) !== entry.mode) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后目录权限不符：${JSON.stringify(path)}`);
				continue;
			}
			if (!info.isFile()) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后类型不符（应为普通文件）：${JSON.stringify(path)}`);
			if (process.platform !== "win32" && Number(info.mode & 4095n) !== entry.mode) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后权限不符：${JSON.stringify(path)}`);
			const handle = await open(target, constants.O_RDONLY);
			try {
				const content = await readFileBounded(handle, entry.size);
				if (sha256Hex(content) !== entry.blob) throw new ShadowRewindError("RESTORE_VERIFY_FAILED", `恢复后内容不符：${JSON.stringify(path)}`);
			} finally {
				await handle.close();
			}
		}
	}
	async isReferencedByRecovery(workspace, restorePointId) {
		return (await this.store.listOperations(workspace)).some((operation) => (operation.state === "interrupted" || operation.state === "recovery-required") && (operation.restorePointId === restorePointId || operation.rescuePointId === restorePointId));
	}
	expirePlans() {
		const now = Date.now();
		for (const [id, plan] of this.plans) if (plan.expiresAt <= now) this.plans.delete(id);
	}
};
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
function structuredClonePlan(plan) {
	return JSON.parse(JSON.stringify(plan));
}
function assertPlanFresh(plan, currentEntries) {
	for (const change of plan.changes) if (!entriesEquivalent(plan.expected[change.path] ?? null, currentEntries[change.path] ?? null)) throw new ShadowRewindError("PLAN_STALE", `路径在计划生成后又被修改：${JSON.stringify(change.path)}；请重新检查`);
}
function entriesEquivalent(left, right) {
	if (left === null || right === null) return left === right;
	if (left.kind !== right.kind || left.mode !== right.mode) return false;
	if (left.kind === "file" && right.kind === "file") return left.blob === right.blob && left.size === right.size;
	if (left.kind === "dir") return true;
	return left.kind === "symlink" && right.kind === "symlink" && left.target === right.target;
}
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
export { DEFAULT_EXCLUDES, ShadowRewindEngine, isCheckpointSkipCode, resolveConfig };
