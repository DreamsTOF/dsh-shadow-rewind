import { ShadowRewindError } from "../errors.js";
import { bumpWorkspaceRevision } from "./revision.js";
import { sessionEvents } from "./types.js";
import { findLast } from "./coordinator.js";
//#region src/host/session-resolve.ts
/**
* 宿主适配层·恢复目标解析：消息 → 检查点、回合 → 检查点。
*
* 与旧插件同语义，纯会话事件驱动（无 VCS）：
*  - 消息定位：user/message 事件 seq → 所属回合 → 轮起检查点；
*  - 回合定位：turn/start 事件 → 轮起检查点；
*  - fork 产物在本会话没有检查点时沿父链继承，只有目标落在 seed 范围内
*    （fork 之前发生的回合/消息）才允许，且继承检查点的 turnStartSeq 必须
*    与本会话的回合边界一致——任何谱系不一致都抛 PLAN_STALE（fail-closed）。
*
* 预览定位（resolveMessageRewindTarget / resolveTurnRewindTarget）把两种寻址
* 统一成同一个预览尾部：无持久检查点时先查持久跳过记录，再回落协调器的
* 内存状态（pending/skipped/failed/missing）。
*/
/**
* 归一化宿主会话读取：把 live（ctx.sessions.get）与冷读（sessionQuery
* readSession）两种来源统一成 `{ id, header{...,seedLength}, events }`，
* 并把 0.1.2 的 `inheritedEventCount` 映射回插件内部使用的 `seedLength`
* 语义（fork 继承边界 = 继承事件前缀长度），下游逻辑零改动。
*/
async function readSession(deps, sessionId) {
	const live = deps.sessions.get(sessionId);
	if (live !== void 0) {
		const core = live.session ?? live;
		const header = core?.header;
		const inherited = core?.inheritedEventCount ?? header?.seedLength;
		return {
			id: core?.id ?? live.id ?? sessionId,
			header: {
				...header?.cwd === void 0 ? {} : { cwd: header.cwd },
				...header?.parentSession === void 0 ? {} : { parentSession: header.parentSession },
				...inherited === void 0 ? {} : { seedLength: inherited }
			},
			events: sessionEvents(core ?? live)
		};
	}
	const stored = await deps.sessionQuery.readSession(sessionId);
	const header = stored.session;
	const inherited = stored.inheritedEventCount ?? header.seedLength;
	return {
		id: header.id ?? sessionId,
		header: {
			...header.cwd === void 0 ? {} : { cwd: header.cwd },
			...header.parentSession === void 0 ? {} : { parentSession: header.parentSession },
			...inherited === void 0 ? {} : { seedLength: inherited }
		},
		events: stored.events ?? []
	};
}
/** 消息 → 检查点解析：直查（含 fork 继承的）回合检查点；缺席即如实报告
* 「没有快照」——绝不用部分树兜底制造「同一动作恢复集合不同」的第二语义。 */
async function resolveMessageCheckpoint(deps, engine, sessionId, messageSeq) {
	return resolveMessageCheckpointViaCheckpoints(deps, engine, sessionId, messageSeq);
}
/** 消息 → 回合检查点：直查本会话，未命中则沿 fork 父链在 seed 范围内继承。 */
async function resolveMessageCheckpointViaCheckpoints(deps, engine, sessionId, messageSeq) {
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
/** 消息恢复的执行入口：解析 + 与请求带来的 checkpointId 核对（防错配）。 */
async function checkpointForRequest(deps, engine, sessionId, messageSeq, requestedId) {
	const { checkpoint } = await resolveMessageCheckpoint(deps, engine, sessionId, messageSeq);
	if (checkpoint === void 0) throw new ShadowRewindError("RESTORE_POINT_NOT_FOUND", `消息 ${String(messageSeq)} 没有可用的回退检查点`);
	if (requestedId !== checkpoint.id) throw new ShadowRewindError("PLAN_STALE", "该消息的检查点已变化；请重新打开回退对话框");
	return checkpoint;
}
/** 消息旁回退按钮的预览定位（messageSeq 寻址）。 */
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
/** 侧边栏「从快照恢复此轮」的预览定位（turn 寻址）。 */
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
* 检查点缺席即如实报告，绝不用部分树兜底。
*/
async function resolveTurnCheckpoint(deps, engine, sessionId, turn) {
	return resolveTurnCheckpointViaCheckpoints(deps, engine, sessionId, turn);
}
async function resolveTurnCheckpointViaCheckpoints(deps, engine, sessionId, turn) {
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
/** 回合 → 会话事实：cwd + turn/start 事件的 seq（检查点配对的锚）。 */
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
/** 回合快照恢复的执行入口：解析 + 与请求带来的 checkpointId 核对。 */
async function turnCheckpointForRequest(deps, engine, sessionId, turn, requestedId) {
	const resolved = await resolveTurnCheckpoint(deps, engine, sessionId, turn);
	if (resolved.checkpoint === void 0) throw new ShadowRewindError("RESTORE_POINT_NOT_FOUND", `回合 ${String(turn)} 没有可用的快照检查点`);
	if (requestedId !== resolved.checkpoint.id) throw new ShadowRewindError("PLAN_STALE", "该回合的检查点已变化；请重新检查");
	return {
		id: resolved.checkpoint.id,
		cwd: resolved.cwd
	};
}
/** 执行前的公共闸门：计划与检查点同源核对（1.4 #6，检测保留）+
* planId 必须齐备。确认串已废除（1.4 #2）——「确认」由 GUI 弹窗承担。 */
async function applyGuarded(deps, engine, sessionId, checkpoint, planId) {
	if (planId === void 0) throw new ShadowRewindError("NO_CHANGES", "该回合没有可恢复的项目文件变更");
	const plan = await engine.getRestorePlan(planId);
	if (plan === void 0 || plan.restorePointId !== checkpoint.id || plan.workspace !== checkpoint.cwd) throw new ShadowRewindError("PLAN_STALE", "恢复计划与所选检查点不匹配；请重新打开预览后重试");
	const result = await engine.applyRestore({
		planId,
		sessionId
	});
	await bumpWorkspaceRevision(checkpoint.cwd);
	return result;
}
/** 消息 → 会话事实（含一系列 fail-closed 校验，见各 throw）。 */
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
/** 直发用户消息判定：source.kind === 'user'（插件注入等来源不满足）。 */
function isDirectUserMessage(event) {
	const source = event.data.source;
	return source !== null && typeof source === "object" && !Array.isArray(source) && source.kind === "user";
}
//#endregion
export { applyGuarded, checkpointForRequest, readSession, resolveMessageRewindTarget, resolveTurnRewindTarget, turnCheckpointForRequest };
