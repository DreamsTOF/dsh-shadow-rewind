import { createDeadline } from "./deadline.js";
import { ShadowRewindError, errorMessage } from "./errors.js";
import { canonicalDirectory } from "./path-utils.js";
import "./types.js";
import { diffTrees, entriesEqual, makeId } from "./manifest.js";
import { DEFAULT_EXCLUDES, resolveConfig } from "./engine-config.js";
import { assertPlanFresh, diffAgainstManifest, isCheckpointSkipCode, structuredClonePlan, summarize, wrapCheckpointDeadline } from "./engine-helpers.js";
import { ShadowRewindEngineBase } from "./engine-base.js";
//#region src/engine.ts
/**
* 核心引擎：捕获 / 对比 / 计划 / 恢复 / 删除。
*
* 两条铁律贯穿全部路径：
*  1. 绝不调用工作区自身的任何 VCS——文件枚举只走目录扫描，快照字节只落在
*     影子 jj 仓库或 SQLite 内容库；
*  2. 恢复 = 恢复前自动 rescue 备份 + 事后哈希验证，失败即进程内自动回滚
*     到状态 A——「要么 B 要么回 A」的两态翻转（EXPECTED-DESIGN 1.4）。
*
* 物理布局（拆分后本文件持有引擎主类与生命周期方法，公开 API 不变）：
*  - ./engine-config.ts  配置解析与默认值；
*  - ./engine-base.ts    存储装配 / 当前树捕获 / 检查点内容读取 / 恢复路径执行；
*  - ./engine-helpers.ts 摘要投影 / 计划新鲜度断言等纯函数。
*
* EXPECTED-DESIGN 1.4 落地：lock.json 互斥（#9）、持久操作日志状态机（#11）、
* 计划 TTL 拒绝（#1）、逐字确认串（#2）、会话绑定拒绝（#3）均已废除/降级；
* 选择权通过 probe + force（1.2）交给用户。
*/
/** 每工作区撤销记录小栈深度上限（超过丢最旧；栈顶 = 最近一次恢复）。 */
const MAX_UNDO_STACK = 8;
/** 过期计划的内存保留窗口：TTL 只作软警告，过期计划仍可执行；
* 只有远超窗口的陈旧计划才从内存淘汰（进程重启天然清零）。 */
const PLAN_RETENTION_MS = 864e5;
/** 撤销范围解析：缺省 = 记录里的全部路径；给 paths 时必须是记录成员
* （未知路径立即拒绝——防止拿错版本的清单拼出半个撤销）。 */
function resolveUndoScope(record, paths) {
	if (paths === void 0) return record.files.map((file) => file.rel);
	const known = new Set(record.files.map((file) => file.rel));
	const unknown = paths.filter((path) => !known.has(path));
	if (unknown.length > 0) throw new ShadowRewindError("INVALID_ARGUMENTS", `以下路径不在可撤销清单里：${unknown.slice(0, 5).join(", ")}`);
	return [...new Set(paths)];
}
/** 引擎实例：一个插件进程共享一个（配置驱动，无隐藏全局状态）。 */
var ShadowRewindEngine = class extends ShadowRewindEngineBase {
	plans = /* @__PURE__ */ new Map();
	applying = /* @__PURE__ */ new Set();
	/** 恢复后撤销（B1 升级为小栈多槽）：workspace → 最近若干次恢复的逐路径
	* before/after（栈顶 = 最近一次；默认保留 {@link MAX_UNDO_STACK} 条）。
	* 进程内记录，重启即失效。部分撤销时按成功路径收缩当前栈顶，清空才弹栈。 */
	undoRecords = /* @__PURE__ */ new Map();
	/** undo 记录身份自增。 */
	undoSeq = 0;
	constructor(config = {}) {
		super(config);
	}
	/** 创建一个持久化恢复点（user / rescue）。 */
	async create(options) {
		await this.assertReady(options.signal);
		const workspace = await canonicalDirectory(options.cwd);
		await this.store.assertStorageSeparated(workspace);
		if (options.kind !== "rescue") {
			if ((await this.store.listManifests(workspace)).filter((manifest) => manifest.kind === "user").length >= this.config.maxRestorePoints) throw new ShadowRewindError("RESTORE_POINT_LIMIT", `手动恢复点数量已达上限 ${String(this.config.maxRestorePoints)}`);
		}
		const manifest = await this.createLocked(workspace, {
			kind: options.kind === "rescue" ? "rescue" : "user",
			sessionId: options.sessionId,
			label: options.label,
			parentRestorePoint: options.parentRestorePoint,
			signal: options.signal
		});
		return summarize(manifest);
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
			let prunedTurnCheckpoints = 0;
			for (const stale of sameSession.slice(this.config.maxTurnCheckpointsPerSession)) {
				if (signal.aborted) break;
				if (await this.isReferencedByUndo(workspace, stale.id)) continue;
				await this.store.deleteManifest(workspace, stale.id).catch(() => void 0);
				prunedTurnCheckpoints += 1;
			}
			if (prunedTurnCheckpoints > 0) await this.garbageCollectAfterDeletion(workspace, prunedTurnCheckpoints);
			return summarize(manifest);
		} catch (error) {
			throw wrapCheckpointDeadline(error, this.config.turnCheckpointTimeoutMs, deadline.signal.aborted);
		} finally {
			deadline.cancel();
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
		let prunedRescues = 0;
		if (options.kind === "rescue") {
			const rescues = (await this.store.listManifests(workspace)).filter((point) => point.kind === "rescue").sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
			for (const stale of rescues.slice(Math.max(1, this.config.maxRestorePoints))) {
				if (await this.isReferencedByUndo(workspace, stale.id)) continue;
				await this.store.deleteManifest(workspace, stale.id).catch(() => void 0);
				prunedRescues += 1;
			}
		}
		if (options.kind !== "turn") await this.garbageCollectAfterDeletion(workspace, 1 + prunedRescues);
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
		const manifest = await this.store.readManifest(workspace, options.restorePointId);
		const current = await this.captureTree(workspace, {
			mode: "inspect",
			signal: options.signal
		});
		const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path));
		return {
			restorePoint: summarize(manifest),
			currentTreeHash: current.treeHash,
			changes: diffAgainstManifest(manifest, current.entries).filter((change) => !skippedSet.has(change.path)),
			skippedPaths: manifest.skippedPaths
		};
	}
	async planRestore(options) {
		await this.assertReady(options.signal);
		this.expirePlans();
		const workspace = await canonicalDirectory(options.cwd);
		const manifest = await this.store.readManifest(workspace, options.restorePointId);
		const current = await this.captureTree(workspace, {
			mode: "inspect",
			signal: options.signal
		});
		if (options.expectedCurrentTreeHash !== void 0 && options.expectedCurrentTreeHash !== current.treeHash) throw new ShadowRewindError("PLAN_STALE", "检查之后工作区又发生了变化；请重新检查");
		const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path));
		const changes = diffAgainstManifest(manifest, current.entries).filter((change) => !skippedSet.has(change.path));
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
			changes,
			expected
		};
		this.plans.set(plan.id, plan);
		return structuredClonePlan(plan);
	}
	/** 查询内存中的恢复计划（不存在返回 undefined；TTL 过期不拒绝——
	* 软警告字段 `expired` 随计划透出，EXPECTED-DESIGN 1.4 #1）。
	* 供 HTTP 层核对「计划与所选检查点同源」。 */
	getRestorePlan(planId) {
		this.expirePlans();
		const plan = this.plans.get(planId);
		if (plan === void 0) return void 0;
		return structuredClonePlan(plan);
	}
	/** 执行一个已批准的恢复计划：rescue → 恢复 → 验证（失败自动回滚到状态 A）。
	* EXPECTED-DESIGN 1.4：确认串（#2）与会话绑定拒绝（#3）已废除——后者降级
	* 为结果里的软警告；TTL 过期（#1）不阻断；真正的防漂移闸是 assertPlanFresh。
	* skipUndoRecord：补偿性质的恢复（如 fork 失败的自动回滚）不写 undo 单槽
	* ——它会把「撤销最近一次恢复」的指向覆盖成补偿自己，语义反转。 */
	async applyRestore(options) {
		await this.assertReady(options.signal);
		this.expirePlans();
		const plan = this.plans.get(options.planId);
		if (plan === void 0) throw new ShadowRewindError("PLAN_NOT_FOUND", `恢复计划 ${options.planId} 不存在`);
		if (this.applying.has(plan.id)) throw new ShadowRewindError("PLAN_IN_PROGRESS", "该恢复计划正在执行");
		this.applying.add(plan.id);
		try {
			const manifest = await this.store.readManifest(plan.workspace, plan.restorePointId);
			const current = await this.captureTree(plan.workspace, {
				mode: "inspect",
				signal: options.signal
			});
			assertPlanFresh(plan, current.entries);
			const paths = plan.changes.map((change) => change.path);
			const rescue = await this.createLocked(plan.workspace, {
				kind: "rescue",
				label: `恢复 ${manifest.id} 之前`,
				parentRestorePoint: manifest.id,
				sessionId: options.sessionId,
				signal: options.signal
			});
			try {
				await this.restorePaths(plan.workspace, manifest, paths, options.signal);
				await this.verifyRestored(plan.workspace, manifest, paths, options.signal);
				await this.store.writeManifest(plan.workspace, {
					...manifest,
					restoreCount: manifest.restoreCount + 1,
					lastRestoredAt: Date.now()
				});
				if (options.skipUndoRecord !== true) {
					this.undoSeq += 1;
					const record = {
						id: `u${String(this.undoSeq)}`,
						...options.sessionId === void 0 ? {} : { sessionId: options.sessionId },
						restorePointId: manifest.id,
						rescuePointId: rescue.id,
						time: Date.now(),
						files: plan.changes.map((change) => ({
							rel: change.path,
							before: current.entries[change.path] ?? null,
							after: manifest.entries[change.path] ?? null
						}))
					};
					const stack = this.undoRecords.get(plan.workspace) ?? [];
					stack.push(record);
					if (stack.length > MAX_UNDO_STACK) stack.shift();
					this.undoRecords.set(plan.workspace, stack);
				}
				this.plans.delete(plan.id);
				return {
					restorePointId: manifest.id,
					rescuePointId: rescue.id,
					restoredPaths: paths
				};
			} catch (error) {
				try {
					const affected = [.../* @__PURE__ */ new Set([...paths, ...diffTrees(rescue.entries, current.entries).map((change) => change.path)])];
					await this.restorePaths(plan.workspace, rescue, affected, options.signal);
					await this.verifyRestored(plan.workspace, rescue, affected, options.signal);
					throw new ShadowRewindError("RESTORE_FAILED_ROLLED_BACK", `恢复失败，已自动从备份 ${rescue.id} 还原：${errorMessage(error)}`, { cause: error });
				} catch (rollbackError) {
					if (rollbackError instanceof ShadowRewindError && rollbackError.code === "RESTORE_FAILED_ROLLED_BACK") throw rollbackError;
					throw new ShadowRewindError("RECOVERY_REQUIRED", `恢复失败且回滚也失败；可从备份点 ${rescue.id} 重试恢复。主错误：${errorMessage(error)}；回滚错误：${errorMessage(rollbackError)}`);
				}
			}
		} finally {
			this.applying.delete(plan.id);
		}
	}
	async undoLastRestore(options) {
		await this.assertReady(options.signal);
		const workspace = await canonicalDirectory(options.cwd);
		const stack = this.undoRecords.get(workspace);
		const record = stack?.[stack.length - 1];
		if (record === void 0) throw new ShadowRewindError("UNDO_NOT_FOUND", `没有可撤销的恢复（进程内保留最近 ${String(MAX_UNDO_STACK)} 次，重启后失效；可从恢复时自动创建的备份点手工恢复）`);
		const scope = resolveUndoScope(record, options.paths);
		const rescue = await this.store.readManifest(workspace, record.rescuePointId);
		const current = await this.captureTree(workspace, {
			mode: "inspect",
			signal: options.signal
		});
		const clean = [];
		const conflicted = [];
		for (const rel of scope) {
			const file = record.files.find((entry) => entry.rel === rel);
			if (file === void 0) continue;
			const now = current.entries[file.rel] ?? null;
			if (file.after === null ? now === null : now !== null && entriesEqual(now, file.after)) clean.push(file.rel);
			else conflicted.push({
				path: file.rel,
				reason: "content was modified after the restore"
			});
		}
		if (options.mode === "probe") return {
			id: record.id,
			...record.sessionId === void 0 ? {} : { sessionId: record.sessionId },
			restorePointId: record.restorePointId,
			rescuePointId: record.rescuePointId,
			time: record.time,
			clean,
			conflicted
		};
		const force = options.force === true;
		const undonePaths = [];
		const skippedPaths = [];
		for (const rel of scope) {
			if (record.files.find((entry) => entry.rel === rel) === void 0) continue;
			if (!clean.includes(rel) && !force) {
				const conflict = conflicted.find((entry) => entry.path === rel);
				skippedPaths.push({
					path: rel,
					reason: conflict?.reason ?? "content was modified after the restore; skipped"
				});
				continue;
			}
			try {
				await this.restorePaths(workspace, rescue, [rel], options.signal);
				await this.verifyRestored(workspace, rescue, [rel], options.signal);
				undonePaths.push(rel);
			} catch (error) {
				skippedPaths.push({
					path: rel,
					reason: `undo failed: ${errorMessage(error)}`
				});
			}
		}
		if (undonePaths.length === 0 && skippedPaths.length > 0 && !force) throw new ShadowRewindError("UNDO_CONFLICT", `全部路径都已被后续修改，无法撤销；可在确认后强制回滚，或从备份点 ${record.rescuePointId} 手工恢复`);
		const remaining = record.files.filter((file) => !undonePaths.includes(file.rel));
		if (stack !== void 0) {
			if (remaining.length === 0) {
				stack.pop();
				if (stack.length === 0) this.undoRecords.delete(workspace);
			} else if (remaining.length !== record.files.length) stack[stack.length - 1] = {
				...record,
				files: remaining
			};
		}
		return {
			id: record.id,
			...record.sessionId === void 0 ? {} : { sessionId: record.sessionId },
			restorePointId: record.restorePointId,
			rescuePointId: record.rescuePointId,
			undonePaths,
			skippedPaths
		};
	}
	/** 删除一个恢复点（EXPECTED-DESIGN 1.4 #2：确认串废除；被进程内 undo
	* 记录引用的 rescue 点仍拒绝删除——那是「撤销最近一次恢复」的命脉）。 */
	async delete(options) {
		await this.assertReady(options.signal);
		const workspace = await canonicalDirectory(options.cwd);
		if (await this.isReferencedByUndo(workspace, options.restorePointId)) throw new ShadowRewindError("UNDO_REFERENCE", "该恢复点仍被「撤销最近一次恢复」引用，不能删除");
		await this.store.deleteManifest(workspace, options.restorePointId);
		const gc = await this.garbageCollectAfterDeletion(workspace, 1);
		return {
			restorePointId: options.restorePointId,
			...gc.deletedBlobs > 0 ? { deletedBlobs: gc.deletedBlobs } : {}
		};
	}
	async isReferencedByUndo(workspace, restorePointId) {
		const stack = this.undoRecords.get(workspace);
		return stack !== void 0 && stack.some((entry) => entry.rescuePointId === restorePointId);
	}
	expirePlans() {
		const now = Date.now();
		for (const [id, plan] of this.plans) if (plan.createdAt + PLAN_RETENTION_MS <= now) this.plans.delete(id);
	}
};
//#endregion
export { DEFAULT_EXCLUDES, ShadowRewindEngine, isCheckpointSkipCode, resolveConfig };
