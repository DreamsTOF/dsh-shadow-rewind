import { createDeadline } from "../deadline.js";
import { ShadowRewindError, errorMessage } from "../errors.js";
import { isCheckpointSkipCode } from "../engine-helpers.js";
import { collectTurnIntent } from "../trace-replay.js";
import { bumpWorkspaceRevision } from "./revision.js";
import { HostErrorLog } from "./error-log.js";
import { sessionEvents } from "./types.js";
//#region src/host/coordinator.ts
/**
* 宿主适配层·回合检查点协调器(TurnCheckpointCoordinator)。
*
* 把「每轮第一步之前自动快照」挂在 agent/pre-step 瀑布最前面(prepend 保证
* 先于其它监听器)，并在 turn/end 事件时冻结轮末树状态。快照失败只记录、
* 绝不阻塞用户回合：
*  - 同一 (sessionId, turn) 的捕获幂等(进行中则等待同一次)；
*  - 同一工作区的捕获经尾队列串行化，绝不交错出「半新半旧」的树；
*  - 超时(可跳过错误码)与失败分开记录，供预览端点向 UI 解释状态；
*  - 连续环境类失败按工作区熔断(3 次 → 5min 起步指数退避、60min 封顶)，
*    冷却期满自动重试、成功一次全部复位——磁盘满/权限坏场景不再每轮白烧；
*  - 失败进进程级最近错误历史(errorLog，/shadow-rewind/status 下发)；
*  - 子代理不建检查点：它的写盘由父会话的轮窗口覆盖。
*/
/** 「会话×回合」的状态键：pending/skips/failures 三张表共用。 */
function checkpointKey(sessionId, turn) {
	return `${sessionId}\0${String(turn)}`;
}
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
/** 让 promise 与中止信号竞争：信号先到则以 signal.reason 拒绝。 */
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
/** 把捕获期错误统一包装为超时错误(保持外层 deadline 的语义)。 */
function asCheckpointError(error, timeoutMs, deadlineAborted) {
	if (deadlineAborted && !(error instanceof ShadowRewindError && error.code === "TURN_CHECKPOINT_TIMEOUT")) return new ShadowRewindError("TURN_CHECKPOINT_TIMEOUT", `自动检查点超出 ${String(timeoutMs)} ms`, { cause: error });
	return error;
}
/** 从事件流尾部向前找第一条满足条件的记录(事件按 seq 升序追加)。 */
function findLast(items, predicate) {
	for (let index = items.length - 1; index >= 0; index -= 1) {
		const item = items[index];
		if (item !== void 0 && predicate(item)) return item;
	}
}
/** 熔断参数：连续失败 FUSE_AFTER 次后进入退避冷却(吸收自 dsh-recall-plugin
* issue #7——失败重试既无谓全量扫描又持续写残骸，实测一下午 127GB)。 */
const FUSE_AFTER = 3;
const FUSE_BACKOFF_BASE_MS = 3e5;
const FUSE_BACKOFF_CAP_MS = 36e5;
/**
* 连续失败 count 次后的冷却时长：5 分钟起步、每多失败一次翻倍、60 分钟
* 封顶；count < FUSE_AFTER 尚未熔断，返回 0。
* ponytail: 纯算术无状态，天花板是「按错误类别分档退避」——真出现该需求
* 时升级为 (kind → base) 映射表。
*/
function fuseBackoffMs(count) {
	if (count < FUSE_AFTER) return 0;
	return Math.min(FUSE_BACKOFF_BASE_MS * 2 ** (count - FUSE_AFTER), FUSE_BACKOFF_CAP_MS);
}
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
	/** 已警告过 agent.id ≠ session.id 的会话（宿主假设违反只告警一次）。 */
	idMismatchWarned = /* @__PURE__ */ new Set();
	/** 进程级最近错误历史（20 条环形缓冲，/shadow-rewind/status 下发）。 */
	errorLog = new HostErrorLog();
	/** workspace → 熔断状态：连续失败计数与冷却截止时刻。 */
	fuses = /* @__PURE__ */ new Map();
	constructor(engine) {
		this.engine = engine;
		if (engine.downgradeReason !== void 0) this.errorLog.push(engine.downgradeReason);
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
		const fuse = this.fuses.get(cwd);
		if (fuse !== void 0 && Date.now() < fuse.skipUntil) return;
		const key = checkpointKey(session.id, turn);
		if (this.endCaptures.has(key)) return;
		const start = findLast(sessionEvents(session), (e) => e.type === "turn/start" && e.data.turn === turn);
		if (start === void 0) {
			ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 轮末检查点跳过：找不到 turn/start 事件`);
			return;
		}
		this.endCaptures.add(key);
		const timeoutMs = this.engine.config.turnCheckpointTimeoutMs;
		const deadline = createDeadline(timeoutMs);
		const intent = collectTurnIntent(sessionEvents(session), start.seq);
		try {
			await this.serializeWorkspace(cwd, deadline.signal, async () => {
				await this.engine.createTurnCheckpoint({
					cwd,
					sessionId: session.id,
					turn,
					turnStartSeq: start.seq,
					phase: "end",
					...intent.length > 0 ? { intent } : {},
					signal: deadline.signal
				});
				bumpWorkspaceRevision(cwd);
				this.fuses.delete(cwd);
			});
		} catch (error) {
			const bounded = asCheckpointError(error, timeoutMs, deadline.signal.aborted);
			const message = errorMessage(bounded);
			if (!(bounded instanceof ShadowRewindError && isCheckpointSkipCode(bounded.code))) {
				this.errorLog.push(message);
				this.advanceFuse(cwd);
			}
			ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 轮末检查点失败（归属退化为下一轮轮起配对）：${message}`);
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
		if (agent.session.header.parentSession !== void 0) return;
		const key = checkpointKey(agent.id, turn);
		const existing = this.captures.get(key);
		if (existing !== void 0) {
			await existing.catch(() => void 0);
			return;
		}
		const cwd = agent.session.header.cwd;
		if (cwd === void 0) return;
		const fuse = this.fuses.get(cwd);
		if (fuse !== void 0 && Date.now() < fuse.skipUntil) {
			this.skips.set(key, `检查点已熔断暂停（连续失败 ${String(fuse.count)} 次），约 ${String(Math.ceil((fuse.skipUntil - Date.now()) / 6e4))} 分钟后自动重试`);
			return;
		}
		if (agent.session.id !== agent.id && !this.idMismatchWarned.has(agent.id)) {
			this.idMismatchWarned.add(agent.id);
			console.warn(`[shadow-rewind] 会话 ${agent.session.id} 的 agent.id (${agent.id}) 与 session.id 不一致；轮检查点按 agent.id 归档，轮配对可能失效`);
		}
		const start = findLast(sessionEvents(agent.session), (event) => event.type === "turn/start" && event.data.turn === turn);
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
				this.fuses.delete(cwd);
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
			else {
				this.failures.set(key, message);
				if (!signal.aborted) {
					this.errorLog.push(message);
					this.advanceFuse(cwd);
				}
			}
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
		this.errorLog.push(message);
		if (context !== void 0) this.advanceFuse(context.cwd);
		ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 检查点失败：${message}`);
	}
	/** 推进工作区熔断：连续 FUSE_AFTER 次失败进入退避冷却；「未熔断 → 熔断」
	* 的跳变沿记一条熔断公告（冷却期内每轮跳过不再逐条刷错误历史）。 */
	advanceFuse(workspace) {
		const fuse = this.fuses.get(workspace) ?? {
			count: 0,
			skipUntil: 0
		};
		fuse.count += 1;
		const backoff = fuseBackoffMs(fuse.count);
		const wasFused = Date.now() < fuse.skipUntil;
		fuse.skipUntil = backoff > 0 ? Date.now() + backoff : 0;
		this.fuses.set(workspace, fuse);
		if (backoff > 0 && !wasFused) this.errorLog.push(`检查点连续失败 ${String(fuse.count)} 次，暂停约 ${String(Math.round(backoff / 6e4))} 分钟后自动重试（工作区熔断）`);
	}
};
//#endregion
export { TurnCheckpointCoordinator, findLast, fuseBackoffMs };
