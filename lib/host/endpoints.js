import { ShadowRewindError, errorMessage } from "../errors.js";
import { canonicalDirectory } from "../path-utils.js";
import { attributePaths, serializeOwner } from "../attribution.js";
import { collectTurnIntent, traceBaselinePaths, traceNodes, traceRangeDiff, traceSpans, turnBoundaries } from "../trace-replay.js";
import { bumpWorkspaceRevision, workspaceRevision } from "./revision.js";
import { applyGuarded, checkpointForRequest, readSession, resolveMessageRewindTarget, resolveTurnRewindTarget, turnCheckpointForRequest } from "./session-resolve.js";
import { computeCumulativeFsChanges, computeTurnFsChanges, countChangeLines, countLines, decodeUtf8, lineCounts, probeUnreadableCheckpoints, readChangeSide, readLiveFile } from "./fs-changes.js";
import { isLoopback, json, nonNegativeInteger, optionalText, pageSize, readJsonBody, requiredText } from "./http-utils.js";
import { handleInPlaceHttp } from "./inplace-http.js";
import { CONFIG_HTTP_PATH, MANAGE_HTTP_PATH, handleConfigHttp, handleManageHttp } from "./manage-endpoints.js";
//#region src/host/endpoints.ts
/**
* 宿主适配层·同源 HTTP 端点。
*
* 注册六个 `/shadow-rewind` 端点（全部只服务本机回环，非回环一律 403）：
*  - `/shadow-rewind`          GET 预览（消息/回合两种寻址）+ POST 执行恢复；
*  - `/shadow-rewind/file`     从检查点（或当前磁盘 'live'）读单文件内容；
*  - `/shadow-rewind/fs-changes` 批量返回会话所有轮次的文件系统变更；
*  - `/shadow-rewind/trace`    轨迹时间线 + 区间 diff（轨迹重放 / 快照对比）；
*  - `/shadow-rewind/restore-undo` 撤销该工作区最近一次恢复（B1 单次 undo）；
*  - `/shadow-rewind/status`   最近错误环形缓冲 + 生效后端健康度。
*
* 消息→检查点解析、轮配对与行数统计分别在 session-resolve / fs-changes；
* 本文件只负责请求解析、装配调用与响应形状。
*/
/** 同源端点根路径（客户端侧 fetch 的事实标准）。 */
const REWIND_HTTP_PATH = "/shadow-rewind";
/** 注册同源端点；非回环请求一律 403（与旧插件同一安全边界）。
* bridge 支持传解析函数：settings 桥异步装配到位前为 undefined，handler
* 每次请求时重新解析（桥缺席时 config 端点按只读应答）。
* 宿主 ctx 提供 effect 时，注册 disposer 挂进插件 fiber——插件禁用/HMR
* 时端点随 fiber 注销（verify-host 门禁断言卸载清零）。 */
function installShadowRewindHttp(ctx, engine, coordinator, bridge) {
	const resolveBridge = () => typeof bridge === "function" ? bridge() : bridge;
	const routes = [
		{
			path: REWIND_HTTP_PATH,
			handler: (request, response) => handleRewindHttp(ctx, engine, coordinator, request, response)
		},
		{
			path: `${REWIND_HTTP_PATH}/file`,
			handler: (request, response) => handleFileContentHttp(engine, request, response)
		},
		{
			path: `${REWIND_HTTP_PATH}/fs-changes`,
			handler: (request, response) => handleFsChangesHttp(ctx, engine, request, response)
		},
		{
			path: `${REWIND_HTTP_PATH}/inplace`,
			handler: (request, response) => handleInPlaceHttp(ctx, request, response)
		},
		{
			path: `${REWIND_HTTP_PATH}/trace`,
			handler: (request, response) => handleTraceHttp(ctx, engine, request, response)
		},
		{
			path: `${REWIND_HTTP_PATH}/restore-undo`,
			handler: (request, response) => handleRestoreUndoHttp(ctx, engine, request, response)
		},
		{
			path: `${REWIND_HTTP_PATH}/status`,
			handler: (request, response) => handleStatusHttp(engine, coordinator, request, response)
		},
		{
			path: CONFIG_HTTP_PATH,
			handler: (request, response) => handleConfigHttp(engine, resolveBridge(), request, response)
		},
		{
			path: MANAGE_HTTP_PATH,
			handler: (request, response) => handleManageHttp(engine, request, response)
		}
	];
	for (const route of routes) {
		const dispose = ctx.webServer?.register({
			kind: "exact",
			path: route.path,
			handler: route.handler
		});
		if (dispose !== void 0) ctx.effect?.(() => dispose, `shadow-rewind: http ${route.path}`);
	}
}
/** POST /shadow-rewind/restore-undo：撤销该会话工作区最近一次恢复。
* EXPECTED-DESIGN 1.2 两段式：`mode:'probe'` 只做 CAS 只读比对（弹窗依据）；
* `mode:'apply'`（缺省）执行撤销，`force` 为用户在弹窗授权「全部回滚 /
* 二次回滚」后的强制覆盖，`paths` 为子集撤销。 */
async function handleRestoreUndoHttp(deps, engine, request, response) {
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
		let cwd = typeof body.cwd === "string" && body.cwd.trim() !== "" ? body.cwd : void 0;
		if (cwd === void 0) {
			const sessionId = typeof body.sessionId === "string" && body.sessionId !== "" ? body.sessionId : null;
			if (sessionId === null) throw new ShadowRewindError("INVALID_ARGUMENTS", "sessionId 与 cwd 必须提供其一");
			cwd = (await readSession(deps, sessionId)).header.cwd;
		}
		if (cwd === void 0 || cwd.trim() === "") throw new ShadowRewindError("INVALID_ARGUMENTS", "无法定位工作区（会话没有 cwd）");
		const mode = body.mode === "probe" ? "probe" : "apply";
		const force = body.force === true;
		let paths;
		if (Array.isArray(body.paths)) {
			if (!body.paths.every((item) => typeof item === "string" && item !== "")) throw new ShadowRewindError("INVALID_ARGUMENTS", "paths 必须是非空字符串数组");
			paths = body.paths;
		}
		if (mode === "probe") {
			json(response, 200, await engine.undoLastRestore({
				cwd,
				mode,
				...paths !== void 0 ? { paths } : {}
			}));
			return;
		}
		const result = await engine.undoLastRestore({
			cwd,
			...force ? { force } : {},
			...paths !== void 0 ? { paths } : {}
		});
		await bumpWorkspaceRevision(cwd);
		json(response, 200, result);
	} catch (error) {
		json(response, 409, {
			error: errorMessage(error),
			code: error instanceof ShadowRewindError ? error.code : "RESTORE_UNDO_FAILED"
		});
	}
}
/** GET+POST /shadow-rewind：回退预览与执行（消息 / 回合两种寻址）。 */
async function handleRewindHttp(deps, engine, coordinator, request, response) {
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
			const offset = nonNegativeInteger(url.searchParams.get("offset") ?? "0", "offset");
			const limit = pageSize(url.searchParams.get("limit"), detailsOnly ? 200 : 8);
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
			let ownership;
			if (inspection.changes.length > 0) {
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
			const countBudget = { remaining: 600 };
			const counts = /* @__PURE__ */ new Map();
			for (const change of changes) {
				if (countBudget.remaining <= 0) break;
				countBudget.remaining -= 1;
				const stats = await countChangeLines(engine, checkpoint.cwd, change.path, checkpoint.id, "live");
				if (stats !== void 0) counts.set(change.path, stats);
			}
			const common = {
				status: "ready",
				sessionId,
				...messageSeq !== void 0 ? { messageSeq } : {},
				turn: checkpoint.turn,
				checkpointId: checkpoint.id,
				turnStartSeq: checkpoint.turnStartSeq,
				totalChanges: inspection.changes.length,
				changes: changes.map((change) => {
					const attributed = ownership?.get(change.path);
					const stats = counts.get(change.path);
					return {
						path: change.path,
						kind: change.kind,
						...stats === void 0 ? {} : {
							added: stats.added,
							removed: stats.removed
						},
						...attributed === void 0 ? {} : { owner: serializeOwner(attributed.owner) }
					};
				}),
				offset,
				truncated: offset + changes.length < inspection.changes.length,
				skippedPaths: inspection.skippedPaths.map((skip) => ({
					path: skip.path,
					reason: skip.reason
				})),
				workspace: checkpoint.cwd
			};
			if (inspection.changes.length === 0 || detailsOnly) {
				json(response, 200, common);
				return;
			}
			const plan = await engine.planRestore({
				cwd: checkpoint.cwd,
				restorePointId: checkpoint.id,
				sessionId,
				expectedCurrentTreeHash: inspection.currentTreeHash
			});
			json(response, 200, {
				...common,
				planId: plan.id
			});
			return;
		}
		if (request.method === "POST") {
			const record = await readJsonBody(request);
			const sessionId = requiredText(record.sessionId, "sessionId");
			const checkpointId = requiredText(record.checkpointId, "checkpointId");
			const planId = optionalText(record.planId, "planId");
			if (record.turn !== void 0) {
				const turn = nonNegativeInteger(record.turn, "turn");
				const checkpoint = await turnCheckpointForRequest(deps, engine, sessionId, turn, checkpointId);
				const restoreResult = await applyGuarded(deps, engine, sessionId, checkpoint, planId);
				json(response, 200, {
					status: "completed",
					...restoreResult
				});
				return;
			}
			const messageSeq = nonNegativeInteger(record.messageSeq, "messageSeq");
			const checkpoint = await checkpointForRequest(deps, engine, sessionId, messageSeq, checkpointId);
			const restoreResult = await applyGuarded(deps, engine, sessionId, checkpoint, planId);
			json(response, 200, {
				status: "completed",
				...restoreResult
			});
			return;
		}
		json(response, 405, {
			error: "method not allowed",
			code: "METHOD_NOT_ALLOWED"
		});
	} catch (error) {
		const status = error instanceof ShadowRewindError && error.code === "RESTORE_POINT_NOT_FOUND" ? 404 : 409;
		json(response, status, {
			error: errorMessage(error),
			code: error instanceof ShadowRewindError ? error.code : "REWIND_FAILED"
		});
	}
}
/** GET+POST /shadow-rewind/status：进程级健康快照。
* GET 返回最近错误（新→旧，最多 20 条，相邻重复计数「（×N）」，附环境
* 错误分类 hint）与生效后端健康度；POST {op:'clear'} 清空错误历史。 */
async function handleStatusHttp(engine, coordinator, request, response) {
	try {
		if (!isLoopback(request.socket.remoteAddress)) {
			json(response, 403, {
				error: "forbidden",
				code: "FORBIDDEN"
			});
			return;
		}
		if (request.method === "GET") {
			json(response, 200, {
				backend: {
					effective: engine.effectiveBackend,
					...engine.downgradeReason === void 0 ? {} : { downgradeReason: engine.downgradeReason }
				},
				errors: coordinator.errorLog.list()
			});
			return;
		}
		if (request.method === "POST") {
			if ((await readJsonBody(request)).op !== "clear") throw new ShadowRewindError("INVALID_ARGUMENTS", "op 必须是 \"clear\"");
			coordinator.errorLog.clear();
			json(response, 200, {
				ok: true,
				errors: []
			});
			return;
		}
		json(response, 405, {
			error: "method not allowed",
			code: "METHOD_NOT_ALLOWED"
		});
	} catch (error) {
		json(response, 409, {
			error: errorMessage(error),
			code: error instanceof ShadowRewindError ? error.code : "STATUS_FAILED"
		});
	}
}
/** GET /shadow-rewind/file：从指定检查点读取文件内容（base64 编码）。 */
async function handleFileContentHttp(engine, request, response) {
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
			const liveContent = await readLiveFile(cwd, path);
			if (liveContent === null) {
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
/**
* GET /shadow-rewind/trace：轨迹时间线（A1 轨迹重放 + B2 降级标注的统一入口）。
*
* 不带 from/to：返回时间线数据——tool/call 边界节点（trace:<seq>）与全部
* turn 检查点摘要（含 intent 与 degraded 标注）。
* 带 from/to：两种寻址（不可混用）——
*  - `trace:<seq>` / 裸 seq：轨迹重放区间 diff（只覆盖内容型工具，附盲区 notes）；
*  - `rp_...` 检查点 id：两个快照的逐文件对比 + 行数（内容经 /file 端点懒取）。
*/
async function handleTraceHttp(deps, engine, request, response) {
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
		const sessionId = requiredText(url.searchParams.get("sessionId"), "sessionId");
		const session = await readSession(deps, sessionId);
		const cwd = session.header.cwd;
		const nodes = traceNodes(session.events);
		const from = url.searchParams.get("from");
		const to = url.searchParams.get("to");
		if (from === null && to === null) {
			let checkpoints = [];
			if (cwd !== void 0 && cwd.trim() !== "") {
				checkpoints = await engine.listTurnCheckpoints({
					cwd,
					sessionId
				});
				const unreadable = await probeUnreadableCheckpoints(engine, cwd, new Set(checkpoints.map((point) => point.id)));
				checkpoints = checkpoints.map((point) => unreadable.has(point.id) ? {
					...point,
					degraded: true
				} : point);
			}
			json(response, 200, {
				sessionId,
				...cwd === void 0 ? {} : { cwd },
				nodes,
				checkpoints,
				spans: traceSpans(session.events),
				turnBoundaries: turnBoundaries(session.events)
			});
			return;
		}
		if (from === null || to === null) throw new ShadowRewindError("INVALID_ARGUMENTS", "from 与 to 必须成对提供");
		if (cwd === void 0 || cwd.trim() === "") throw new ShadowRewindError("INVALID_ARGUMENTS", "会话没有工作区，无法对比");
		if (from.startsWith("rp_") !== to.startsWith("rp_")) throw new ShadowRewindError("INVALID_ARGUMENTS", "快照检查点与轨迹节点不可混用（两种寻址二选一）");
		if (from.startsWith("rp_")) {
			const fromId = requiredText(from, "from");
			const toId = requiredText(to, "to");
			const fsDiff = await engine.diffCheckpoints({
				cwd,
				prevCheckpointId: fromId,
				currCheckpointId: toId
			});
			const countBudget = { remaining: 600 };
			const changes = await Promise.all(fsDiff.changes.filter((change) => change.kind !== "type-changed").map(async (change) => {
				const [beforeBuf, afterBuf] = await Promise.all([change.before === void 0 ? Promise.resolve(null) : readChangeSide(engine, cwd, fromId, change.path), change.after === void 0 ? Promise.resolve(null) : readChangeSide(engine, cwd, toId, change.path)]);
				const beforeText = beforeBuf === null ? null : decodeUtf8(beforeBuf);
				const afterText = afterBuf === null ? null : decodeUtf8(afterBuf);
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
					...change.before?.kind === "file" ? { oldMode: change.before.mode } : {},
					...change.after?.kind === "file" ? { newMode: change.after.mode } : {},
					...counts === void 0 ? {} : {
						added: counts.added,
						removed: counts.removed
					}
				};
			}));
			json(response, 200, {
				sessionId,
				cwd,
				mode: "checkpoint",
				from: fromId,
				to: toId,
				changes
			});
			return;
		}
		const fromSeq = nonNegativeInteger(from.replace(/^trace:/, ""), "from");
		const toSeq = nonNegativeInteger(to.replace(/^trace:/, ""), "to");
		if (fromSeq >= toSeq) throw new ShadowRewindError("INVALID_ARGUMENTS", "from 必须小于 to（区间语义 (from, to]）");
		const baseline = /* @__PURE__ */ new Map();
		try {
			const touched = new Set(traceBaselinePaths(session.events));
			const baseId = (await engine.listTurnCheckpoints({
				cwd,
				sessionId
			})).filter((point) => point.phase !== "end" && point.turnStartSeq !== void 0 && point.turnStartSeq <= fromSeq).sort((left, right) => (right.turnStartSeq ?? 0) - (left.turnStartSeq ?? 0))[0]?.id;
			if (baseId !== void 0 && touched.size > 0) {
				const entries = await engine.getCheckpointEntries({
					cwd,
					restorePointId: baseId
				});
				for (const path of touched) {
					const entry = entries[path];
					if (entry === void 0 || entry.kind !== "file") continue;
					const content = await engine.getFileContentFromCheckpoint({
						cwd,
						checkpointId: baseId,
						path
					});
					if (content === null) continue;
					const text = decodeUtf8(content);
					if (text !== null) baseline.set(path, text);
				}
			}
		} catch (error) {
			deps.logger.warn(`[shadow-rewind] 轨迹重放基线补齐失败，退化为原语义：${errorMessage(error)}`);
			baseline.clear();
		}
		const result = traceRangeDiff(session.events, fromSeq, toSeq, { baseline });
		json(response, 200, {
			sessionId,
			cwd,
			mode: "trace",
			from: fromSeq,
			to: toSeq,
			changes: result.changes,
			notes: result.notes
		});
	} catch (error) {
		json(response, 409, {
			error: errorMessage(error),
			code: error instanceof ShadowRewindError ? error.code : "TRACE_FAILED"
		});
	}
}
/**
* GET /shadow-rewind/fs-changes：批量返回会话所有轮次的文件系统变更。
*
* 归属语义：第 N 轮的变更 = diff(第 N 轮轮起检查点, 本轮轮末检查点)；
* 无轮末快照的轮（旧数据/捕获失败）回退「下一轮轮起」配对。最后一轮没有
* 配对终点，不在此返回（live-tail 条目以「轮起检查点 vs 当前磁盘」覆盖）。
* 单轮对比失败只跳过该轮，不中断整体响应。
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
		const url = new URL(request.url ?? "/shadow-rewind", "http://dsh.local");
		const sessionId = requiredText(url.searchParams.get("sessionId"), "sessionId");
		const session = await readSession(deps, sessionId);
		const cwd = session.header.cwd;
		if (cwd === void 0 || cwd.trim() === "") {
			json(response, 200, {
				sessionId,
				turns: []
			});
			return;
		}
		const rev = await workspaceRevision(cwd);
		const checkpoints = await engine.listTurnCheckpoints({
			cwd,
			sessionId
		});
		const starts = checkpoints.filter((point) => point.phase !== "end");
		const endByTurn = /* @__PURE__ */ new Map();
		for (const point of checkpoints) if (point.phase === "end" && point.turn !== void 0) endByTurn.set(point.turn, point);
		const turns = [];
		const countBudget = { remaining: 600 };
		for (let index = 0; index < starts.length; index += 1) {
			const current = starts[index];
			if (current === void 0 || current.turn === void 0 || current.turnStartSeq === void 0) continue;
			const next = starts[index + 1];
			const pairEnd = endByTurn.get(current.turn) ?? next;
			const computed = await computeTurnFsChanges(engine, deps, {
				cwd,
				current: {
					id: current.id,
					sessionId: current.sessionId,
					createdAt: current.createdAt,
					turn: current.turn,
					turnStartSeq: current.turnStartSeq
				},
				pairEnd,
				...pairEnd?.intent !== void 0 ? { intent: pairEnd.intent } : {},
				countBudget
			});
			if (computed !== void 0 && computed.changes.length > 0) turns.push(computed);
		}
		const last = starts[starts.length - 1];
		if (last !== void 0 && last.turn !== void 0 && last.turnStartSeq !== void 0 && !endByTurn.has(last.turn)) {
			const computed = await computeTurnFsChanges(engine, deps, {
				cwd,
				current: {
					id: last.id,
					sessionId: last.sessionId,
					createdAt: last.createdAt,
					turn: last.turn,
					turnStartSeq: last.turnStartSeq
				},
				live: true,
				...last.turnStartSeq !== void 0 ? { intent: collectTurnIntent(session.events, last.turnStartSeq) } : {},
				countBudget
			});
			if (computed !== void 0 && computed.changes.length > 0) turns.push(computed);
		}
		const checkpointIds = /* @__PURE__ */ new Set();
		for (const turn of turns) {
			checkpointIds.add(turn.checkpointId);
			if (turn.nextCheckpointId !== "live") checkpointIds.add(turn.nextCheckpointId);
		}
		const unreadable = await probeUnreadableCheckpoints(engine, cwd, checkpointIds);
		const marked = turns.map((turn) => {
			return unreadable.has(turn.checkpointId) || unreadable.has(turn.nextCheckpointId) ? {
				...turn,
				degraded: true
			} : turn;
		});
		const cumulative = await computeCumulativeFsChanges(engine, {
			cwd,
			turns: marked,
			countBudget: { remaining: 600 }
		});
		json(response, 200, {
			sessionId,
			rev,
			turns: marked,
			cumulative
		});
	} catch (error) {
		json(response, 409, {
			error: errorMessage(error),
			code: error instanceof ShadowRewindError ? error.code : "FS_CHANGES_FAILED"
		});
	}
}
//#endregion
export { REWIND_HTTP_PATH, installShadowRewindHttp };
