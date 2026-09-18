import { errorMessage } from "../errors.js";
import { sessionEvents } from "./types.js";
import { isLoopback, json, nonNegativeInteger, readJsonBody, requiredText } from "./http-utils.js";
import { InPlacePlanError, planInPlace } from "../inplace/plan.js";
import { buildInPlaceMarker } from "../inplace/marker.js";
//#region src/host/inplace-http.ts
/**
* 就地遮蔽回退·宿主 HTTP 端点（原 M2 命令面的 HTTP 化：命令入口已按需求整体
* 移除，回退只保留 live 条 / 消息旁回退按钮 / 审计面板三处，聊天流不再出现
* 命令行）。
*
* POST /shadow-rewind/inplace  body: { sessionId, messageSeq }
*
* 执行语义（与 dsh-rewind 的 executeRewind 一致）：运行中的回合先 cancel
* （keepInbox，保住 queue 里的下一轮消息）→ 等 idle → 丢弃 next-step 插话 →
* append 一条「空 user/message」标记，其 surfaceOp 用 replace 把「目标消息及
* 之后全部 surface 节点」替换为它自己，sourceEventSeqs 引用全部被遮蔽 seq；
* 日志 append-only 不动。文件恢复不在此层（由 ↶ 弹窗经引擎 HTTP 恢复，编排
* 在客户端弹窗内）。
*
* 结构类型面（不 import cordis / dsh-agent），只声明实际消费的成员；真实宿主
* 在 0.1.2 的 agent 服务里恰好是这些形状。
*/
/** 单会话并发闸（双击 / 双 tab 都规划同一 surface，第二次 append 会命中
* 「start seq not in surface」被宿主拒绝；这里先拒）。 */
const inflight = /* @__PURE__ */ new Set();
/** 把会话事件日志桥成规划层入参（只消费 type/seq/data.content/data.source.kind）。 */
function eventsOf(session) {
	return sessionEvents(session).map((event) => ({
		seq: event.seq,
		type: event.type,
		data: event.data ?? {}
	}));
}
function surfaceOf(session) {
	return session.surface?.nodes ?? [];
}
/** 解析目标 seq 并校验遮蔽区间。 */
function resolvePlan(session, targetSeq) {
	const surface = surfaceOf(session);
	if (surface.length === 0) throw new Error("会话没有可用的模型表面（surface），无法规划就地遮蔽。");
	return planInPlace({
		events: eventsOf(session),
		surface,
		targetSeq
	});
}
/** 计划失败的中文文案（NOT_A_USER_MESSAGE / NOT_ON_SURFACE 单源）。 */
function planFailureText(error) {
	if (error instanceof InPlacePlanError) {
		if (error.code === "NOT_A_USER_MESSAGE") return "该 seq 不是可回退的直发用户消息（注入 context / compact 检查点不可作回退边界）。";
		if (error.code === "NOT_ON_SURFACE") return "该消息已被 compact 遮蔽 / 不在模型上下文里，无法就地回退。";
		return error.message;
	}
	return errorMessage(error);
}
/**
* 打断运行中的回合并等它安静；等不到（超时/中止）返回 false。用 whenIdle()
* 而非常轮询 status：maintenance 阶段 status 也读 idle，但活动仍在进行，
* 并发写会与本次 append 竞争，故一律 race whenIdle()。
*/
async function waitForAgentIdle(agent, signal, timeoutMs = 15e3) {
	if (signal?.aborted) return false;
	const whenIdle = agent.whenIdle;
	if (whenIdle === void 0) return false;
	let timer;
	let onAbort;
	try {
		await Promise.race([Promise.resolve(whenIdle.call(agent)), new Promise((_resolve, reject) => {
			timer = setTimeout(() => reject(/* @__PURE__ */ new Error("等待回合结束超时")), timeoutMs);
			onAbort = () => reject(/* @__PURE__ */ new Error("命令已中止"));
			signal?.addEventListener("abort", onAbort, { once: true });
		})]);
		return true;
	} catch {
		return false;
	} finally {
		if (timer !== void 0) clearTimeout(timer);
		if (onAbort !== void 0) signal?.removeEventListener("abort", onAbort);
	}
}
/** 丢弃被剪掉的 next-step 插话（属于被遮蔽的未来，保留会在下次发送先投递）；
* queue 里的下一轮消息刻意不动（宿主 QueueDock 已提供逐条编辑/移除）。 */
function dropPendingSteering(agent) {
	const nextStep = agent.inbox?.nextStep;
	if (nextStep === void 0) return;
	for (const message of [...nextStep]) agent.inbox?.remove?.(message.id);
}
/** 追加遮蔽标记；失败由宿主 append 抛错（如 start 已被其它标记遮蔽）。 */
function appendMarker(agent, plan) {
	const session = agent.session;
	if (session.append === void 0) throw new Error("宿主会话不支持日志 append，无法就地遮蔽。");
	return session.append("user/message", buildInPlaceMarker(), {
		surfaceOp: {
			op: "replace",
			start: plan.surfaceStart,
			end: plan.surfaceEnd
		},
		sourceEventSeqs: [...plan.shadowedSeqs]
	});
}
/** 执行就地遮蔽（append 标记）。文件恢复不在本层。 */
async function executeInPlaceMask(agent, targetSeq, signal) {
	const sessionId = agent.session.id;
	if (inflight.has(sessionId)) return {
		kind: "error",
		text: "本会话已有就地回退在执行，请稍候。"
	};
	inflight.add(sessionId);
	try {
		if (agent.status !== void 0 && agent.status !== "idle") {
			if (agent.cancel === void 0 || agent.whenIdle === void 0) return {
				kind: "error",
				text: "宿主不支持在运行中打断（缺 cancel/whenIdle），请等回合结束再试。"
			};
			agent.cancel({ kind: "user" }, { keepInbox: true });
			if (!await waitForAgentIdle(agent, signal)) return {
				kind: "error",
				text: "打断运行中的回合失败或超时，未执行就地回退。"
			};
		}
		dropPendingSteering(agent);
		if (signal?.aborted) return {
			kind: "error",
			text: "操作已取消。"
		};
		let plan;
		try {
			plan = resolvePlan(agent.session, targetSeq);
		} catch (error) {
			return {
				kind: "error",
				text: planFailureText(error)
			};
		}
		let event;
		try {
			event = appendMarker(agent, plan);
		} catch (error) {
			return {
				kind: "error",
				text: `追加遮蔽标记失败：${errorMessage(error)}`
			};
		}
		const count = plan.shadowedSeqs.length - 1;
		return {
			kind: "ok",
			markerSeq: event.seq,
			text: `已就地回退到 #${String(plan.targetSeq)}：目标及之后共 ${String(plan.shadowedSeqs.length)} 个 surface 节点被遮蔽（其中 ${String(count)} 条后续消息已撤出模型上下文）。目标消息文本已放回输入框供重发。`
		};
	} finally {
		inflight.delete(sessionId);
	}
}
/** POST /shadow-rewind/inplace：在 live agent 的会话上执行就地遮蔽。 */
async function handleInPlaceHttp(deps, request, response) {
	try {
		if (!isLoopback(request.socket.remoteAddress)) {
			json(response, 403, {
				error: "forbidden",
				code: "FORBIDDEN"
			});
			return;
		}
		if (request.method !== "POST") {
			json(response, 405, {
				error: "method not allowed",
				code: "METHOD_NOT_ALLOWED"
			});
			return;
		}
		const body = await readJsonBody(request);
		const sessionId = requiredText(body.sessionId, "sessionId");
		const messageSeq = nonNegativeInteger(body.messageSeq, "messageSeq");
		const agent = deps.agents.list().find((candidate) => candidate?.session?.id === sessionId && typeof candidate.session.append === "function");
		if (agent === void 0) {
			json(response, 200, {
				status: "error",
				text: "当前宿主没有该会话的 live agent（会话可能未打开或不支持就地遮蔽）。"
			});
			return;
		}
		const outcome = await executeInPlaceMask(agent, messageSeq);
		json(response, 200, outcome.kind === "ok" ? {
			status: "ok",
			markerSeq: outcome.markerSeq,
			text: outcome.text
		} : {
			status: "error",
			text: outcome.text
		});
	} catch (error) {
		json(response, 409, {
			error: errorMessage(error),
			code: "INPLACE_FAILED"
		});
	}
}
//#endregion
export { executeInPlaceMask, handleInPlaceHttp };
