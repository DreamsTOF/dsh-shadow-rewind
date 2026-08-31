import { ShadowRewindError, errorMessage } from "./errors.js";
import { canonicalDirectory } from "./path-utils.js";
import { createDeadline } from "./deadline.js";
import { isCheckpointSkipCode } from "./engine.js";
import { attributePaths, serializeOwner } from "./attribution.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { diffLines } from "diff";
//#region src/rewind-host.ts
/**
* 宿主适配层：回合检查点协调器 + `/shadow-rewind` 同源 HTTP 端点。
*
* 协调器把「每轮第一步之前自动快照」挂在 agent/pre-step 瀑布最前面；
* 快照失败只记录、绝不阻塞用户回合。HTTP 端点负责消息→检查点解析、
* 分页预览、计划生成与恢复执行；会话分叉交给 DSH 官方 create/fork。
*/
const REWIND_HTTP_PATH = "/shadow-rewind";
/** 写入闸运行时开关的查询/翻转端点（仅回环；不持久化，重启回到配置初值）。 */
const REWIND_GATE_PATH = "/shadow-rewind/gate";
const BODY_LIMIT = 65536;
const INITIAL_CHANGE_PREVIEW_LIMIT = 8;
const MAX_CHANGE_PAGE_SIZE = 200;
/** 每回合第一步之前抢占快照（失败可跳过、可重试，绝不阻塞回合）。 */
var TurnCheckpointCoordinator = class {
	engine;
	/** sessionId\0turn → 捕获 Promise（同回合幂等）。 */
	captures = /* @__PURE__ */ new Map();
	pending = /* @__PURE__ */ new Set();
	failures = /* @__PURE__ */ new Map();
	skips = /* @__PURE__ */ new Map();
	/** sessionId\0turn → 轮末捕获进行中（同回合同相位不重复发起）。 */
	endCaptures = /* @__PURE__ */ new Set();
	/** workspace → 串行化尾队列：同一工作区的快照绝不并发。 */
	workspaceTails = /* @__PURE__ */ new Map();
	constructor(engine) {
		this.engine = engine;
		if (engine.downgradeReason !== void 0) console.warn(`[shadow-rewind] ${engine.downgradeReason}`);
	}
	/** 安装第一步闸门（prepend 保证先于其它监听器）与轮末捕获订阅。 */
	install(ctx) {
		ctx.on("agent/pre-step", async (data, next) => {
			if (data.step === 1) await this.capture(ctx, data.agent, data.turn, data.signal);
			return next();
		}, { prepend: true });
		ctx.on("session/event", (session, event) => {
			if (event.type !== "turn/end") return;
			this.captureEnd(ctx, session, event);
		});
	}
	/** 轮末捕获（见 install 注释）：与轮起捕获共用工作区串行化尾队列。 */
	async captureEnd(ctx, session, event) {
		if (this.engine.turnCheckpointsDisabled) return;
		const turn = event.data?.turn;
		const cwd = session.header.cwd;
		if (typeof turn !== "number" || !Number.isSafeInteger(turn) || turn < 0) return;
		if (cwd === void 0 || cwd.trim() === "") return;
		const key = checkpointKey(session.id, turn);
		if (this.endCaptures.has(key)) return;
		const start = findLast(session.events, (e) => e.type === "turn/start" && e.data.turn === turn);
		if (start === void 0) {
			ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 轮末检查点跳过：找不到 turn/start 事件`);
			return;
		}
		this.endCaptures.add(key);
		const timeoutMs = this.engine.config.turnCheckpointTimeoutMs;
		const deadline = createDeadline(timeoutMs);
		try {
			await this.serializeWorkspace(cwd, deadline.signal, async () => {
				await this.engine.createTurnCheckpoint({
					cwd,
					sessionId: session.id,
					turn,
					turnStartSeq: start.seq,
					phase: "end",
					signal: deadline.signal
				});
				bumpWorkspaceRevision(cwd);
			});
		} catch (error) {
			const bounded = asCheckpointError(error, timeoutMs, deadline.signal.aborted);
			ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 轮末检查点失败（归属退化为下一轮轮起配对）：${errorMessage(bounded)}`);
		} finally {
			deadline.cancel();
			this.endCaptures.delete(key);
		}
	}
	/** 无持久检查点时，向 UI 报告当前回合的捕获状态。 */
	state(sessionId, turn) {
		const key = checkpointKey(sessionId, turn);
		if (this.pending.has(key)) return { status: "pending" };
		const reason = this.skips.get(key);
		if (reason !== void 0) return {
			status: "skipped",
			reason
		};
		const error = this.failures.get(key);
		return error === void 0 ? { status: "missing" } : {
			status: "failed",
			error
		};
	}
	async capture(ctx, agent, turn, signal) {
		if (this.engine.turnCheckpointsDisabled) return;
		const key = checkpointKey(agent.id, turn);
		const existing = this.captures.get(key);
		if (existing !== void 0) {
			await existing.catch(() => void 0);
			return;
		}
		const cwd = agent.session.header.cwd;
		if (cwd === void 0) return;
		const start = findLast(agent.session.events, (event) => event.type === "turn/start" && event.data.turn === turn);
		if (start === void 0) {
			this.failures.set(key, "第一步之前找不到 turn/start 事件");
			return;
		}
		const timeoutMs = this.engine.config.turnCheckpointTimeoutMs;
		const outcomeDeadline = createDeadline(timeoutMs);
		const outcomeSignal = AbortSignal.any([signal, outcomeDeadline.signal]);
		const captureDeadline = createDeadline(Math.max(1, timeoutMs - Math.min(250, Math.max(10, Math.ceil(timeoutMs / 5)))));
		const captureSignal = AbortSignal.any([signal, captureDeadline.signal]);
		this.pending.add(key);
		this.failures.delete(key);
		this.skips.delete(key);
		const capture = this.serializeWorkspace(cwd, captureSignal, async () => {
			try {
				await this.engine.createTurnCheckpoint({
					cwd,
					sessionId: agent.id,
					turn,
					turnStartSeq: start.seq,
					signal: captureSignal
				});
				bumpWorkspaceRevision(cwd);
			} catch (error) {
				await this.recordFailure(ctx, agent.id, turn, asCheckpointError(error, timeoutMs, captureDeadline.signal.aborted), {
					cwd,
					turnStartSeq: start.seq
				});
			}
		}).finally(() => {
			this.pending.delete(key);
		});
		this.captures.set(key, capture);
		try {
			await raceWithSignal(capture, outcomeSignal);
		} catch (error) {
			const bounded = asCheckpointError(error, timeoutMs, outcomeDeadline.signal.aborted);
			const message = errorMessage(bounded);
			this.pending.delete(key);
			if (bounded instanceof ShadowRewindError && isCheckpointSkipCode(bounded.code)) this.skips.set(key, message);
			else this.failures.set(key, message);
		} finally {
			captureDeadline.cancel();
			outcomeDeadline.cancel();
			this.captures.delete(key);
		}
	}
	/** 同一工作区的捕获排队执行，避免交错快照半新半旧的树。 */
	async serializeWorkspace(workspace, signal, task) {
		const previous = this.workspaceTails.get(workspace) ?? Promise.resolve();
		const current = (async () => {
			await raceWithSignal(previous.catch(() => void 0), signal).catch(() => void 0);
			signal.throwIfAborted();
			await task();
		})();
		this.workspaceTails.set(workspace, current);
		try {
			await current;
		} finally {
			if (this.workspaceTails.get(workspace) === current) this.workspaceTails.delete(workspace);
		}
	}
	async recordFailure(ctx, sessionId, turn, error, context) {
		const message = errorMessage(error);
		const key = checkpointKey(sessionId, turn);
		if (error instanceof ShadowRewindError && isCheckpointSkipCode(error.code)) {
			boundedSet(this.skips, key, message);
			if (context !== void 0) try {
				await this.engine.recordTurnCheckpointSkip({
					cwd: context.cwd,
					sessionId,
					turn,
					turnStartSeq: context.turnStartSeq,
					reason: message
				});
			} catch (persistError) {
				ctx.logger.warn(`[shadow-rewind] 无法持久化检查点跳过记录（${sessionId} turn ${String(turn)}）：${errorMessage(persistError)}`);
			}
			ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 检查点已跳过：${message}`);
			return;
		}
		boundedSet(this.failures, key, message);
		ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 检查点失败：${message}`);
	}
};
/**
* 有界写入：超过 maxEntries 时淘汰最早写入的条目。
* 跳过/失败记录按「会话×回合」增长，长驻进程必须设上限防止缓慢泄漏。
*/
function boundedSet(map, key, value, maxEntries = 256) {
	if (!map.has(key) && map.size >= maxEntries) {
		const oldest = map.keys().next().value;
		if (oldest !== void 0) map.delete(oldest);
	}
	map.set(key, value);
}
function checkpointKey(sessionId, turn) {
	return `${sessionId}\0${String(turn)}`;
}
async function raceWithSignal(promise, signal) {
	signal.throwIfAborted();
	let rejectAbort;
	const aborted = new Promise((_resolve, reject) => {
		rejectAbort = reject;
	});
	const onAbort = () => rejectAbort?.(signal.reason);
	signal.addEventListener("abort", onAbort, { once: true });
	try {
		return await Promise.race([promise, aborted]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}
function asCheckpointError(error, timeoutMs, deadlineAborted) {
	if (deadlineAborted && !(error instanceof ShadowRewindError && error.code === "TURN_CHECKPOINT_TIMEOUT")) return new ShadowRewindError("TURN_CHECKPOINT_TIMEOUT", `自动检查点超出 ${String(timeoutMs)} ms`, { cause: error });
	return error;
}
function findLast(items, predicate) {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (item !== void 0 && predicate(item)) return item;
	}
}
/** 注册同源端点；非回环请求一律 403（与旧插件同一安全边界）。 */
function installShadowRewindHttp(ctx, engine, coordinator, writeGate) {
	ctx.webServer?.register({
		kind: "exact",
		path: REWIND_HTTP_PATH,
		handler: (request, response) => handleRewindHttp(ctx, engine, coordinator, writeGate, request, response)
	});
	ctx.webServer?.register({
		kind: "exact",
		path: REWIND_GATE_PATH,
		handler: (request, response) => handleGateHttp(ctx, writeGate, request, response)
	});
	ctx.webServer?.register({
		kind: "exact",
		path: `${REWIND_HTTP_PATH}/file`,
		handler: (request, response) => handleFileContentHttp(ctx, engine, request, response)
	});
	ctx.webServer?.register({
		kind: "exact",
		path: `${REWIND_HTTP_PATH}/fs-changes`,
		handler: (request, response) => handleFsChangesHttp(ctx, engine, request, response)
	});
}
async function handleGateHttp(deps, writeGate, request, response) {
	try {
		if (!isLoopback(request.socket.remoteAddress)) {
			json(response, 403, {
				error: "forbidden",
				code: "FORBIDDEN"
			});
			return;
		}
		if (request.method === "GET") {
			json(response, 200, { enabled: writeGate.isEnabled });
			return;
		}
		if (request.method === "POST") {
			const body = await readJsonBody(request);
			if (typeof body.enabled !== "boolean") throw new ShadowRewindError("INVALID_ARGUMENTS", "enabled 必须是布尔值");
			writeGate.setGate(body.enabled);
			deps.logger.warn(`[shadow-rewind] 写入闸已${body.enabled ? "开启" : "关闭"}（运行时切换，重启后回到配置初值）`);
			json(response, 200, { enabled: writeGate.isEnabled });
			return;
		}
		json(response, 405, {
			error: "method not allowed",
			code: "METHOD_NOT_ALLOWED"
		});
	} catch (error) {
		json(response, 409, {
			error: errorMessage(error),
			code: error instanceof ShadowRewindError ? error.code : "GATE_FAILED"
		});
	}
}
async function handleRewindHttp(deps, engine, coordinator, writeGate, request, response) {
	try {
		if (!isLoopback(request.socket.remoteAddress)) {
			response.writeHead(403, { "content-type": "application/json; charset=utf-8" });
			response.end(`${JSON.stringify({
				error: "forbidden",
				code: "FORBIDDEN"
			})}\n`);
			return;
		}
		if (request.method === "GET") {
			const url = new URL(request.url ?? "/shadow-rewind", "http://dsh.local");
			const sessionId = requiredText(url.searchParams.get("sessionId"), "sessionId");
			const turnParam = url.searchParams.get("turn");
			const messageSeqParam = url.searchParams.get("messageSeq");
			if (turnParam === null === (messageSeqParam === null)) throw new ShadowRewindError("INVALID_ARGUMENTS", "messageSeq 与 turn 必须提供其一（且只能其一）");
			const detailsOnly = url.searchParams.get("details") === "1";
			const pathsParam = url.searchParams.get("paths");
			let requestedPaths;
			if (pathsParam !== null) {
				let parsed;
				try {
					parsed = JSON.parse(pathsParam);
				} catch {
					throw new ShadowRewindError("INVALID_ARGUMENTS", "paths 必须是 JSON 字符串数组");
				}
				if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((item) => typeof item === "string")) throw new ShadowRewindError("INVALID_ARGUMENTS", "paths 必须是非空的 JSON 字符串数组");
				requestedPaths = parsed;
			}
			const offset = nonNegativeInteger(url.searchParams.get("offset") ?? "0", "offset");
			const limit = pageSize(url.searchParams.get("limit"), detailsOnly ? MAX_CHANGE_PAGE_SIZE : INITIAL_CHANGE_PREVIEW_LIMIT);
			const resolved = turnParam !== null ? await resolveTurnRewindTarget(deps, engine, sessionId, nonNegativeInteger(turnParam, "turn"), coordinator) : await resolveMessageRewindTarget(deps, engine, sessionId, nonNegativeInteger(messageSeqParam, "messageSeq"), coordinator);
			if (resolved.status === "unavailable") {
				json(response, 200, resolved.response);
				return;
			}
			const { checkpoint, messageSeq } = resolved;
			const inspection = await engine.inspect({
				cwd: checkpoint.cwd,
				restorePointId: checkpoint.id
			});
			const running = await sharedWorkspaceSessions(deps, checkpoint.cwd);
			const ownerId = await writeGate.ownerOf(checkpoint.cwd);
			const { blocking, gated } = partitionRunningSessions(running, sessionId, ownerId, writeGate.isEnabled);
			const symmetric = !writeGate.isEnabled;
			let ownership;
			if (symmetric && requestedPaths === void 0 && inspection.changes.length > 0) {
				const attributed = await engine.listSnapshotsAfter({
					cwd: checkpoint.cwd,
					restorePointId: checkpoint.id,
					paths: inspection.changes.map((change) => change.path)
				});
				ownership = attributePaths({
					targetSessionId: attributed.targetSessionId,
					changes: inspection.changes,
					snapshots: attributed.snapshots
				});
			}
			const changes = inspection.changes.slice(offset, offset + limit);
			const restoreBlocked = blocking.length > 0;
			let nextCheckpointId;
			let fileSystemChanges;
			if (checkpoint.turn !== void 0) {
				const sessionIdForLookup = (await engine.list({
					cwd: checkpoint.cwd,
					includeTurnCheckpoints: true
				})).find((m) => m.id === checkpoint.id)?.sessionId;
				if (sessionIdForLookup) {
					const allCheckpoints = await engine.listTurnCheckpoints({
						cwd: checkpoint.cwd,
						sessionId: sessionIdForLookup
					});
					const startCheckpoints = allCheckpoints.filter((cp) => cp.phase !== "end");
					const endCheckpoint = checkpoint.turn === void 0 ? void 0 : allCheckpoints.find((cp) => cp.phase === "end" && cp.turn === checkpoint.turn);
					const currentIndex = startCheckpoints.findIndex((cp) => cp.id === checkpoint.id);
					const nextCheckpoint = currentIndex >= 0 ? startCheckpoints[currentIndex + 1] : void 0;
					const pairEnd = endCheckpoint ?? nextCheckpoint;
					if (pairEnd !== void 0) {
						nextCheckpointId = pairEnd.id;
						try {
							fileSystemChanges = (await engine.diffCheckpoints({
								cwd: checkpoint.cwd,
								prevCheckpointId: checkpoint.id,
								currCheckpointId: pairEnd.id
							})).changes.filter((change) => change.kind === "added" || change.kind === "modified" || change.kind === "deleted" || change.kind === "mode-changed").map((change) => ({
								path: change.path,
								kind: change.kind === "mode-changed" ? "modified" : change.kind
							}));
						} catch (error) {
							deps.logger.warn(`[shadow-rewind] 文件系统差异计算失败：${errorMessage(error)}`);
						}
					}
				}
			}
			const common = {
				status: "ready",
				sessionId,
				...messageSeq !== void 0 ? { messageSeq } : {},
				turn: checkpoint.turn,
				checkpointId: checkpoint.id,
				turnStartSeq: checkpoint.turnStartSeq,
				...nextCheckpointId === void 0 ? {} : { nextCheckpointId },
				...fileSystemChanges === void 0 ? {} : { fileSystemChanges },
				totalChanges: inspection.changes.length,
				changes: changes.map((change) => {
					const attributed = ownership?.get(change.path);
					return {
						path: change.path,
						kind: change.kind,
						...attributed === void 0 ? {} : {
							owner: serializeOwner(attributed.owner),
							autoSelect: attributed.autoSelect
						}
					};
				}),
				offset,
				truncated: offset + changes.length < inspection.changes.length,
				activeSessionIds: running,
				restoreBlocked,
				mode: symmetric ? "symmetric" : "current-wins",
				blockingSessionIds: blocking,
				gatedSessionIds: gated,
				ownerId,
				skippedPaths: inspection.skippedPaths.map((skip) => ({
					path: skip.path,
					reason: skip.reason
				}))
			};
			if (inspection.changes.length === 0 || detailsOnly || restoreBlocked) {
				json(response, 200, common);
				return;
			}
			const plan = await engine.planRestore({
				cwd: checkpoint.cwd,
				restorePointId: checkpoint.id,
				sessionId,
				expectedCurrentTreeHash: inspection.currentTreeHash,
				...requestedPaths === void 0 ? {} : { paths: requestedPaths }
			});
			json(response, 200, {
				...common,
				planId: plan.id,
				confirmation: plan.confirmation
			});
			return;
		}
		if (request.method === "POST") {
			const body = await readJsonBody(request);
			const mode = body.mode;
			if (mode !== "code" && mode !== "both") throw new ShadowRewindError("INVALID_ARGUMENTS", "mode 必须是 \"code\" 或 \"both\"");
			const record = body;
			const sessionId = requiredText(record.sessionId, "sessionId");
			const checkpointId = requiredText(record.checkpointId, "checkpointId");
			const planId = optionalText(record.planId, "planId");
			const confirmation = optionalText(record.confirmation, "confirmation");
			if (record.turn !== void 0) {
				if (mode !== "code") throw new ShadowRewindError("INVALID_ARGUMENTS", "按回合快照恢复只支持 mode: \"code\"");
				json(response, 200, {
					status: "completed",
					mode,
					...await applyGuarded(deps, engine, sessionId, (await turnCheckpointForRequest(deps, engine, sessionId, nonNegativeInteger(record.turn, "turn"), checkpointId)).cwd, writeGate, planId, confirmation)
				});
				return;
			}
			const checkpoint = await checkpointForRequest(deps, engine, sessionId, nonNegativeInteger(record.messageSeq, "messageSeq"), checkpointId);
			const restoreResult = await applyGuarded(deps, engine, sessionId, checkpoint.cwd, writeGate, planId, confirmation);
			if (mode === "code") {
				json(response, 200, {
					status: "completed",
					mode,
					...restoreResult
				});
				return;
			}
			try {
				json(response, 200, {
					status: "completed",
					mode,
					sessionId: (await createConversationRestart(deps, sessionId, checkpoint)).sessionId,
					...restoreResult
				});
			} catch (forkError) {
				try {
					const inspection = await engine.inspect({
						cwd: checkpoint.cwd,
						restorePointId: restoreResult.rescuePointId
					});
					const plan = await engine.planRestore({
						cwd: checkpoint.cwd,
						restorePointId: restoreResult.rescuePointId,
						sessionId,
						expectedCurrentTreeHash: inspection.currentTreeHash
					});
					await engine.applyRestore({
						planId: plan.id,
						confirmation: plan.confirmation,
						sessionId
					});
				} catch (rollbackError) {
					throw new ShadowRewindError("RECOVERY_REQUIRED", `新会话创建失败且回滚也失败，可从备份点 ${restoreResult.rescuePointId} 手工恢复。${errorMessage(rollbackError)}`);
				}
				throw new ShadowRewindError("CONVERSATION_REWIND_FAILED", `文件已自动还原；新会话创建失败：${errorMessage(forkError)}`, { cause: forkError });
			}
			return;
		}
		json(response, 405, {
			error: "method not allowed",
			code: "METHOD_NOT_ALLOWED"
		});
	} catch (error) {
		json(response, error instanceof ShadowRewindError && error.code === "RESTORE_POINT_NOT_FOUND" ? 404 : 409, {
			error: errorMessage(error),
			code: error instanceof ShadowRewindError ? error.code : "REWIND_FAILED"
		});
	}
}
async function readSession(deps, sessionId) {
	const live = deps.sessions.get(sessionId);
	if (live !== void 0) return {
		id: live.id,
		header: live.session.header,
		events: live.session.events
	};
	const stored = await deps.sessionQuery.readSession(sessionId);
	return {
		id: stored.session.id,
		header: {
			cwd: stored.session.cwd,
			parentSession: stored.session.parentSession,
			seedLength: stored.session.seedLength
		},
		events: stored.events
	};
}
async function resolveMessageCheckpoint(deps, engine, sessionId, messageSeq) {
	let current = await readSession(deps, sessionId);
	const target = messageTarget(current, messageSeq);
	const direct = await engine.findTurnCheckpoint({
		cwd: target.cwd,
		sessionId,
		turn: target.turn
	});
	if (direct !== void 0) {
		if (direct.turnStartSeq !== target.turnStartSeq) throw new ShadowRewindError("PLAN_STALE", "该消息的检查点与回合起点不再匹配");
		return {
			target,
			checkpoint: {
				...target,
				id: direct.id
			}
		};
	}
	const seen = /* @__PURE__ */ new Set([sessionId]);
	for (;;) {
		const parentId = current.header.parentSession;
		const seedLength = current.header.seedLength;
		if (parentId === void 0 !== (seedLength === void 0)) throw new ShadowRewindError("PLAN_STALE", "会话分叉谱系的父元数据不完整");
		if (parentId === void 0 || seedLength === void 0 || target.messageSeq >= seedLength || target.turnStartSeq >= seedLength) return { target };
		if (seen.has(parentId)) throw new ShadowRewindError("PLAN_STALE", "会话分叉谱系出现环");
		seen.add(parentId);
		try {
			current = await readSession(deps, parentId);
		} catch (error) {
			throw new ShadowRewindError("PLAN_STALE", `父会话 ${parentId} 不可读`, { cause: error });
		}
		const parentTarget = messageTarget(current, messageSeq);
		if (parentTarget.turn !== target.turn || parentTarget.turnStartSeq !== target.turnStartSeq || parentTarget.previousTurnEndSeq !== target.previousTurnEndSeq) throw new ShadowRewindError("PLAN_STALE", "分叉谱系与继承的消息边界不再匹配");
		const inherited = await engine.findTurnCheckpoint({
			cwd: target.cwd,
			sessionId: parentId,
			turn: target.turn
		});
		if (inherited === void 0) continue;
		if (inherited.turnStartSeq !== target.turnStartSeq) throw new ShadowRewindError("PLAN_STALE", "继承的检查点与分叉边界不匹配");
		return {
			target,
			checkpoint: {
				...target,
				id: inherited.id
			}
		};
	}
}
async function checkpointForRequest(deps, engine, sessionId, messageSeq, requestedId) {
	const { target, checkpoint } = await resolveMessageCheckpoint(deps, engine, sessionId, messageSeq);
	if (checkpoint === void 0) throw new ShadowRewindError("RESTORE_POINT_NOT_FOUND", `消息 ${String(messageSeq)} 没有可用的回退检查点`);
	if (requestedId !== checkpoint.id) throw new ShadowRewindError("PLAN_STALE", "该消息的检查点已变化；请重新打开回退对话框");
	return checkpoint;
}
async function resolveMessageRewindTarget(deps, engine, sessionId, messageSeq, coordinator) {
	const { target, checkpoint } = await resolveMessageCheckpoint(deps, engine, sessionId, messageSeq);
	if (checkpoint === void 0) return {
		status: "unavailable",
		response: await engine.findTurnCheckpointSkip({
			cwd: target.cwd,
			sessionId,
			turn: target.turn,
			turnStartSeq: target.turnStartSeq
		}).catch(() => void 0) ?? coordinator.state(sessionId, target.turn)
	};
	return {
		status: "ready",
		messageSeq,
		checkpoint: {
			id: checkpoint.id,
			cwd: checkpoint.cwd,
			turn: checkpoint.turn,
			turnStartSeq: checkpoint.turnStartSeq,
			...checkpoint.previousTurnEndSeq === void 0 ? {} : { previousTurnEndSeq: checkpoint.previousTurnEndSeq }
		}
	};
}
async function resolveTurnRewindTarget(deps, engine, sessionId, turn, coordinator) {
	const resolved = await resolveTurnCheckpoint(deps, engine, sessionId, turn);
	if (resolved.checkpoint === void 0) return {
		status: "unavailable",
		response: await engine.findTurnCheckpointSkip({
			cwd: resolved.cwd,
			sessionId,
			turn,
			turnStartSeq: resolved.turnStartSeq
		}).catch(() => void 0) ?? coordinator.state(sessionId, turn)
	};
	return {
		status: "ready",
		checkpoint: {
			id: resolved.checkpoint.id,
			cwd: resolved.cwd,
			turn,
			turnStartSeq: resolved.turnStartSeq
		}
	};
}
/**
* 回合 → 检查点解析：优先本会话自身的检查点；fork 产物在本会话没有该回合
* 检查点时沿父链继承——只有回合起点落在 seed 范围内（fork 之前发生的回合）
* 才允许继承，且继承检查点的 turnStartSeq 必须与本会话的回合起点一致。
*/
async function resolveTurnCheckpoint(deps, engine, sessionId, turn) {
	let current = await readSession(deps, sessionId);
	const target = turnTarget(current, turn);
	const direct = await engine.findTurnCheckpoint({
		cwd: target.cwd,
		sessionId,
		turn
	});
	if (direct !== void 0) {
		if (direct.turnStartSeq !== target.turnStartSeq) throw new ShadowRewindError("PLAN_STALE", "该回合的检查点与回合起点不再匹配");
		return {
			cwd: target.cwd,
			turnStartSeq: target.turnStartSeq,
			checkpoint: { id: direct.id }
		};
	}
	const seen = /* @__PURE__ */ new Set([sessionId]);
	for (;;) {
		const parentId = current.header.parentSession;
		const seedLength = current.header.seedLength;
		if (parentId === void 0 || seedLength === void 0 || target.turnStartSeq >= seedLength) return {
			cwd: target.cwd,
			turnStartSeq: target.turnStartSeq
		};
		if (seen.has(parentId)) throw new ShadowRewindError("PLAN_STALE", "会话分叉谱系出现环");
		seen.add(parentId);
		try {
			current = await readSession(deps, parentId);
		} catch (error) {
			throw new ShadowRewindError("PLAN_STALE", `父会话 ${parentId} 不可读`, { cause: error });
		}
		const inherited = await engine.findTurnCheckpoint({
			cwd: target.cwd,
			sessionId: parentId,
			turn
		});
		if (inherited === void 0) continue;
		if (inherited.turnStartSeq !== target.turnStartSeq) throw new ShadowRewindError("PLAN_STALE", "继承的检查点与该回合起点不匹配");
		return {
			cwd: target.cwd,
			turnStartSeq: target.turnStartSeq,
			checkpoint: { id: inherited.id }
		};
	}
}
function turnTarget(session, turn) {
	const cwd = session.header.cwd;
	if (cwd === void 0) throw new ShadowRewindError("WORKSPACE_REQUIRED", `会话 ${session.id} 没有工作目录`);
	const start = session.events.find((event) => event.type === "turn/start" && event.data.turn === turn);
	if (start === void 0) throw new ShadowRewindError("RESTORE_POINT_NOT_FOUND", `会话 ${session.id} 没有回合 ${String(turn)} 的起点`);
	return {
		cwd,
		turnStartSeq: start.seq
	};
}
async function turnCheckpointForRequest(deps, engine, sessionId, turn, requestedId) {
	const resolved = await resolveTurnCheckpoint(deps, engine, sessionId, turn);
	if (resolved.checkpoint === void 0) throw new ShadowRewindError("RESTORE_POINT_NOT_FOUND", `回合 ${String(turn)} 没有可用的快照检查点`);
	if (requestedId !== resolved.checkpoint.id) throw new ShadowRewindError("PLAN_STALE", "该回合的检查点已变化；请重新检查");
	return {
		id: resolved.checkpoint.id,
		cwd: resolved.cwd
	};
}
/**
* 运行中的共享工作区会话分诊：哪些真正阻塞恢复，哪些只是被闸住的旁观者。
*  - 闸开启：只有「请求者自身」（恢复期间它可能写文件）与「当前所有者」
*    （唯一未被闸拒绝的写入者）阻塞；其余运行中的会话写入已被拒绝，只提示。
*  - 闸关闭：保持旧行为——任何运行中的会话都阻塞。
*/
function partitionRunningSessions(runningSessionIds, requesterSessionId, ownerSessionId, gateEnabled) {
	if (!gateEnabled) return {
		blocking: [...runningSessionIds],
		gated: []
	};
	const blocking = [];
	const gated = [];
	for (const id of runningSessionIds) if (id === requesterSessionId || ownerSessionId !== void 0 && id === ownerSessionId) blocking.push(id);
	else gated.push(id);
	return {
		blocking,
		gated
	};
}
/** 执行前的公共闸门：工作区占用检查 + 计划与确认串必须齐备。 */
async function applyGuarded(deps, engine, sessionId, cwd, writeGate, planId, confirmation) {
	const { blocking } = partitionRunningSessions(await sharedWorkspaceSessions(deps, cwd), sessionId, await writeGate.ownerOf(cwd), writeGate.isEnabled);
	if (blocking.length > 0) throw new ShadowRewindError("WORKSPACE_IN_USE", `项目目录正被这些会话占用（恢复会与它们的写入冲突）：${blocking.slice(0, 5).join(", ")}`);
	if (planId === void 0 || confirmation === void 0) throw new ShadowRewindError("NO_CHANGES", "该回合没有可恢复的项目文件变更");
	const result = await engine.applyRestore({
		planId,
		confirmation,
		sessionId
	});
	await bumpWorkspaceRevision(cwd);
	return result;
}
async function createConversationRestart(deps, sourceId, checkpoint) {
	const current = messageTarget(await readSession(deps, sourceId), checkpoint.messageSeq);
	if (current.turn !== checkpoint.turn || current.turnStartSeq !== checkpoint.turnStartSeq || current.previousTurnEndSeq !== checkpoint.previousTurnEndSeq) throw new ShadowRewindError("PLAN_STALE", "会话中已找不到所选消息的回合边界");
	const response = checkpoint.previousTurnEndSeq === void 0 ? await deps.apiProxy.sessions.create({
		rpcId: randomUUID(),
		payload: { cwd: checkpoint.cwd }
	}) : await deps.apiProxy.sessions.fork({
		rpcId: randomUUID(),
		payload: {
			sessionId: sourceId,
			atSeq: checkpoint.previousTurnEndSeq
		}
	});
	if (!response.result.ok) throw new ShadowRewindError("CONVERSATION_REWIND_FAILED", response.result.error?.message ?? "未知错误");
	return { sessionId: requiredText(response.result.value?.sessionId, "fork sessionId") };
}
function messageTarget(session, messageSeq) {
	const cwd = session.header.cwd;
	if (cwd === void 0) throw new ShadowRewindError("WORKSPACE_REQUIRED", `会话 ${session.id} 没有工作目录`);
	if (session.events.find((event) => event.type === "user/message" && event.seq === messageSeq && isDirectUserMessage(event)) === void 0) throw new ShadowRewindError("RESTORE_POINT_NOT_FOUND", `会话 ${session.id} 在 ${String(messageSeq)} 处没有用户消息`);
	const start = findLast(session.events, (event) => event.type === "turn/start" && event.seq < messageSeq);
	const turn = start?.data.turn;
	if (start === void 0 || !Number.isSafeInteger(turn) || (turn ?? 0) < 0) throw new ShadowRewindError("PLAN_STALE", "所选消息没有有效的回合起点");
	if (session.events.find((event) => event.type === "user/message" && event.seq > start.seq && event.seq <= messageSeq && isDirectUserMessage(event))?.seq !== messageSeq) throw new ShadowRewindError("RESTORE_POINT_NOT_FOUND", "只支持回退回合的第一条用户消息");
	if (session.events.find((event) => event.type === "turn/end" && event.seq > start.seq && event.seq < messageSeq) !== void 0) throw new ShadowRewindError("PLAN_STALE", "所选消息已不在其记录的回合内");
	const previousEnd = findLast(session.events, (event) => event.type === "turn/end" && event.seq < start.seq);
	return {
		cwd,
		messageSeq,
		turn,
		turnStartSeq: start.seq,
		...previousEnd === void 0 ? {} : { previousTurnEndSeq: previousEnd.seq }
	};
}
function isDirectUserMessage(event) {
	const source = event.data.source;
	return source !== null && typeof source === "object" && !Array.isArray(source) && source.kind === "user";
}
/** 列出与目标目录共享同一工作区的活跃会话（canonical realpath 比对）。 */
async function sharedWorkspaceSessions(deps, cwd) {
	const listed = deps.agents.list();
	if (listed.length === 0) return [];
	const root = await canonicalDirectory(cwd).catch(() => void 0);
	if (root === void 0) return [];
	const shared = [];
	for (const agent of listed) {
		if (agent.status !== "running") continue;
		const agentCwd = agent.session.header.cwd;
		if (agentCwd === void 0) continue;
		if (await canonicalDirectory(agentCwd).catch(() => void 0) === root) shared.push(agent.session.id);
	}
	return shared.sort();
}
function isLoopback(address) {
	return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
function json(response, status, value) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	response.end(`${JSON.stringify(value)}\n`);
}
async function readJsonBody(request) {
	const chunks = [];
	let size = 0;
	await new Promise((resolve, reject) => {
		request.on("data", (chunk) => {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += bytes.length;
			if (size > BODY_LIMIT) {
				reject(new ShadowRewindError("INVALID_ARGUMENTS", "请求体过大"));
				return;
			}
			chunks.push(bytes);
		});
		request.on("end", () => resolve());
		request.on("error", reject);
	});
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch (error) {
		throw new ShadowRewindError("INVALID_ARGUMENTS", "请求体必须是合法 JSON", { cause: error });
	}
}
function requiredText(value, name) {
	if (typeof value !== "string" || value === "") throw new ShadowRewindError("INVALID_ARGUMENTS", `${name} 必须是非空字符串`);
	return value;
}
function optionalText(value, name) {
	return value === void 0 ? void 0 : requiredText(value, name);
}
function nonNegativeInteger(value, name) {
	const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ShadowRewindError("INVALID_ARGUMENTS", `${name} 必须是非负整数`);
	return parsed;
}
function pageSize(value, fallback) {
	if (value === null) return fallback;
	const parsed = nonNegativeInteger(value, "limit");
	if (parsed < 1 || parsed > MAX_CHANGE_PAGE_SIZE) throw new ShadowRewindError("INVALID_ARGUMENTS", `limit 必须在 1 到 ${String(MAX_CHANGE_PAGE_SIZE)} 之间`);
	return parsed;
}
/** GET /shadow-rewind/file：从指定检查点读取文件内容（base64 编码）。 */
async function handleFileContentHttp(deps, engine, request, response) {
	try {
		if (!isLoopback(request.socket.remoteAddress)) {
			json(response, 403, {
				error: "forbidden",
				code: "FORBIDDEN"
			});
			return;
		}
		if (request.method !== "GET") {
			json(response, 405, {
				error: "method not allowed",
				code: "METHOD_NOT_ALLOWED"
			});
			return;
		}
		const url = new URL(request.url ?? "/shadow-rewind", "http://dsh.local");
		const checkpointId = requiredText(url.searchParams.get("checkpointId"), "checkpointId");
		const path = requiredText(url.searchParams.get("path"), "path");
		const cwdParam = url.searchParams.get("cwd");
		if (!cwdParam) throw new ShadowRewindError("INVALID_ARGUMENTS", "cwd 必须是非空字符串");
		const cwd = await canonicalDirectory(cwdParam);
		if (checkpointId === "live") {
			const candidate = resolve(cwd, path);
			const rel = relative(cwd, candidate);
			if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new ShadowRewindError("INVALID_ARGUMENTS", "path 必须在工作区之内");
			let liveContent;
			try {
				liveContent = await readFile(candidate);
			} catch {
				json(response, 404, {
					error: "file not found on disk",
					code: "FILE_NOT_FOUND"
				});
				return;
			}
			json(response, 200, {
				checkpointId,
				path,
				content: liveContent.toString("base64"),
				encoding: "base64"
			});
			return;
		}
		const content = await engine.getFileContentFromCheckpoint({
			cwd,
			checkpointId,
			path
		});
		if (content === null) {
			json(response, 404, {
				error: "file not found in checkpoint",
				code: "FILE_NOT_FOUND"
			});
			return;
		}
		json(response, 200, {
			checkpointId,
			path,
			content: content.toString("base64"),
			encoding: "base64"
		});
	} catch (error) {
		json(response, 409, {
			error: errorMessage(error),
			code: error instanceof ShadowRewindError ? error.code : "FILE_CONTENT_FAILED"
		});
	}
}
const workspaceRevisions = /* @__PURE__ */ new Map();
async function bumpWorkspaceRevision(cwd) {
	const key = await canonicalDirectory(cwd).catch(() => void 0);
	if (key === void 0) return;
	workspaceRevisions.set(key, (workspaceRevisions.get(key) ?? 0) + 1);
}
async function workspaceRevision(cwd) {
	const key = await canonicalDirectory(cwd).catch(() => void 0);
	return key === void 0 ? 0 : workspaceRevisions.get(key) ?? 0;
}
/** 行数统计的单侧字节上限：超出视为统计不可得（数量级保护，非语义边界）。 */
const DIFF_COUNT_MAX_BYTES = 2097152;
/** 单次 fs-changes 请求的行数统计预算（按变更条数计）：超出后剩余变更不带行数。 */
const DIFF_COUNT_BUDGET = 600;
function decodeUtf8(bytes) {
	const text = bytes.toString("utf8");
	return Buffer.from(text, "utf8").equals(bytes) ? text : null;
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
	for (const part of diffLines(before.replace(/\r\n/g, "\n").replace(/\r/g, "\n"), after.replace(/\r\n/g, "\n").replace(/\r/g, "\n"))) if (part.added === true) added += part.count ?? 0;
	else if (part.removed === true) removed += part.count ?? 0;
	return {
		added,
		removed
	};
}
/** 读变更单侧内容：checkpointId 或 'live'（当前磁盘，围栏同 /file 端点）。 */
async function readChangeSide(engine, cwd, sourceId, path) {
	if (sourceId === "live") {
		const candidate = resolve(cwd, path);
		const rel = relative(cwd, candidate);
		if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
		try {
			return await readFile(candidate);
		} catch {
			return null;
		}
	}
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
* GET /shadow-rewind/fs-changes：批量返回会话所有轮次的文件系统变更。
*
* 归属语义：第 N 轮的变更 = diff(第 N 轮轮起检查点, 第 N+1 轮轮起检查点)——
* 第 N+1 轮第一步之前的捕获天然等于第 N 轮的轮末树状态。最后一轮没有下一轮
* 检查点，不在此返回（侧边栏对该轮的展示由「轮起检查点 vs 当前磁盘」的
* 现有预览覆盖）。单轮对比失败只跳过该轮，不中断整体响应。
*
* 本构建起每个 change 附带服务端预算的 added/removed 行数——客户端渲染
* 行与 +/− 统计不再需要逐文件拉全文（全文仅在悬停/展开/撤销时按需取）。
*/
async function handleFsChangesHttp(deps, engine, request, response) {
	try {
		if (!isLoopback(request.socket.remoteAddress)) {
			json(response, 403, {
				error: "forbidden",
				code: "FORBIDDEN"
			});
			return;
		}
		if (request.method !== "GET") {
			json(response, 405, {
				error: "method not allowed",
				code: "METHOD_NOT_ALLOWED"
			});
			return;
		}
		const sessionId = requiredText(new URL(request.url ?? "/shadow-rewind", "http://dsh.local").searchParams.get("sessionId"), "sessionId");
		const cwd = (await readSession(deps, sessionId)).header.cwd;
		if (cwd === void 0 || cwd.trim() === "") {
			json(response, 200, {
				sessionId,
				turns: []
			});
			return;
		}
		const checkpoints = await engine.listTurnCheckpoints({
			cwd,
			sessionId
		});
		const starts = checkpoints.filter((point) => point.phase !== "end");
		const endByTurn = /* @__PURE__ */ new Map();
		for (const point of checkpoints) if (point.phase === "end" && point.turn !== void 0) endByTurn.set(point.turn, point);
		const turns = [];
		const countBudget = { remaining: DIFF_COUNT_BUDGET };
		for (let index = 0; index < starts.length; index += 1) {
			const current = starts[index];
			if (current === void 0) continue;
			const next = starts[index + 1];
			const pairEnd = (current.turn !== void 0 ? endByTurn.get(current.turn) : void 0) ?? next;
			if (pairEnd === void 0) continue;
			try {
				const raw = (await engine.diffCheckpoints({
					cwd,
					prevCheckpointId: current.id,
					currCheckpointId: pairEnd.id
				})).changes.filter((change) => (change.kind === "added" || change.kind === "modified" || change.kind === "deleted" || change.kind === "mode-changed") && !(change.kind === "mode-changed" && change.before?.kind === "dir"));
				let kept = raw;
				if (raw.length > 0) try {
					const attributed = await engine.listSnapshotsAfter({
						cwd,
						restorePointId: current.id,
						paths: raw.map((change) => change.path)
					});
					const within = attributed.snapshots.filter((snapshot) => snapshot.createdAt < pairEnd.createdAt);
					const ownership = attributePaths({
						targetSessionId: attributed.targetSessionId,
						changes: raw,
						snapshots: within
					});
					kept = raw.filter((change) => {
						const owner = ownership.get(change.path)?.owner;
						return owner === void 0 || owner.kind === "target";
					});
				} catch (error) {
					deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn ?? "?")} 归因失败，保留全部路径：${errorMessage(error)}`);
				}
				if (kept.length > 0 && current.turn !== void 0 && current.turnStartSeq !== void 0) {
					const changes = await Promise.all(kept.map((change) => withLineCounts(engine, cwd, change, current.id, pairEnd.id, countBudget)));
					turns.push({
						turn: current.turn,
						turnStartSeq: current.turnStartSeq,
						checkpointId: current.id,
						nextCheckpointId: pairEnd.id,
						changes
					});
				}
			} catch (error) {
				deps.logger.warn(`[shadow-rewind] 轮 ${String(current.turn ?? "?")} 文件系统差异计算失败：${errorMessage(error)}`);
			}
		}
		const last = starts[starts.length - 1];
		if (last !== void 0 && last.turn !== void 0 && last.turnStartSeq !== void 0 && !endByTurn.has(last.turn)) try {
			const raw = (await engine.inspect({
				cwd,
				restorePointId: last.id
			})).changes.filter((change) => (change.kind === "added" || change.kind === "modified" || change.kind === "deleted" || change.kind === "mode-changed") && !(change.kind === "mode-changed" && change.before?.kind === "dir"));
			let kept = raw;
			if (raw.length > 0) try {
				const attributed = await engine.listSnapshotsAfter({
					cwd,
					restorePointId: last.id,
					paths: raw.map((change) => change.path)
				});
				const ownership = attributePaths({
					targetSessionId: attributed.targetSessionId,
					changes: raw,
					snapshots: attributed.snapshots
				});
				kept = raw.filter((change) => {
					const owner = ownership.get(change.path)?.owner;
					return owner === void 0 || owner.kind === "target";
				});
			} catch (error) {
				deps.logger.warn(`[shadow-rewind] live-tail 归因失败，保留全部路径：${errorMessage(error)}`);
			}
			if (kept.length > 0) {
				const changes = await Promise.all(kept.map((change) => withLineCounts(engine, cwd, change, last.id, "live", countBudget)));
				turns.push({
					turn: last.turn,
					turnStartSeq: last.turnStartSeq,
					checkpointId: last.id,
					nextCheckpointId: "live",
					live: true,
					changes
				});
			}
		} catch (error) {
			deps.logger.warn(`[shadow-rewind] 轮 ${String(last.turn)} live 文件系统差异计算失败：${errorMessage(error)}`);
		}
		json(response, 200, {
			sessionId,
			rev: await workspaceRevision(cwd),
			turns
		});
	} catch (error) {
		json(response, 409, {
			error: errorMessage(error),
			code: error instanceof ShadowRewindError ? error.code : "FS_CHANGES_FAILED"
		});
	}
}
//#endregion
export { REWIND_GATE_PATH, REWIND_HTTP_PATH, TurnCheckpointCoordinator, installShadowRewindHttp, partitionRunningSessions };
