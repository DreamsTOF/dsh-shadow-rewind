/**
 * 宿主适配层：回合检查点协调器 + `/shadow-rewind` 同源 HTTP 端点。
 *
 * 协调器把「每轮第一步之前自动快照」挂在 agent/pre-step 瀑布最前面；
 * 快照失败只记录、绝不阻塞用户回合。HTTP 端点负责消息→检查点解析、
 * 分页预览、计划生成与恢复执行；会话分叉交给 DSH 官方 create/fork。
 */
import { randomUUID } from 'node:crypto';
import { createDeadline } from './deadline.js';
import { ShadowRewindError, errorMessage } from './errors.js';
import { canonicalDirectory } from './path-utils.js';
import { isCheckpointSkipCode } from './engine.js';
export const REWIND_HTTP_PATH = '/shadow-rewind';
const BODY_LIMIT = 64 * 1024;
const INITIAL_CHANGE_PREVIEW_LIMIT = 8;
const MAX_CHANGE_PAGE_SIZE = 200;
/** 每回合第一步之前抢占快照（失败可跳过、可重试，绝不阻塞回合）。 */
export class TurnCheckpointCoordinator {
    engine;
    /** sessionId\0turn → 捕获 Promise（同回合幂等）。 */
    captures = new Map();
    pending = new Set();
    failures = new Map();
    skips = new Map();
    /** workspace → 串行化尾队列：同一工作区的快照绝不并发。 */
    workspaceTails = new Map();
    constructor(engine) {
        this.engine = engine;
        if (engine.downgradeReason !== undefined) {
            // 降级是重要状态：启动时必须让用户在日志里看到。
            console.warn(`[shadow-rewind] ${engine.downgradeReason}`);
        }
    }
    /** 安装第一步闸门（prepend 保证先于其它监听器）。 */
    install(ctx) {
        ctx.on('agent/pre-step', async (data, next) => {
            if (data.step === 1)
                await this.capture(ctx, data.agent, data.turn, data.signal);
            return next();
        }, { prepend: true });
    }
    /** 无持久检查点时，向 UI 报告当前回合的捕获状态。 */
    state(sessionId, turn) {
        const key = checkpointKey(sessionId, turn);
        if (this.pending.has(key))
            return { status: 'pending' };
        const reason = this.skips.get(key);
        if (reason !== undefined)
            return { status: 'skipped', reason };
        const error = this.failures.get(key);
        return error === undefined ? { status: 'missing' } : { status: 'failed', error };
    }
    async capture(ctx, agent, turn, signal) {
        if (this.engine.turnCheckpointsDisabled)
            return;
        const key = checkpointKey(agent.id, turn);
        const existing = this.captures.get(key);
        if (existing !== undefined) {
            await existing.catch(() => undefined);
            return;
        }
        const cwd = agent.session.header.cwd;
        if (cwd === undefined)
            return;
        const start = findLast(agent.session.events, (event) => event.type === 'turn/start' && event.data.turn === turn);
        if (start === undefined) {
            this.failures.set(key, '第一步之前找不到 turn/start 事件');
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
                    signal: captureSignal,
                });
            }
            catch (error) {
                await this.recordFailure(ctx, agent.id, turn, asCheckpointError(error, timeoutMs, captureDeadline.signal.aborted), {
                    cwd,
                    turnStartSeq: start.seq,
                });
            }
        }).finally(() => {
            this.pending.delete(key);
        });
        this.captures.set(key, capture);
        try {
            await raceWithSignal(capture, outcomeSignal);
        }
        catch (error) {
            const bounded = asCheckpointError(error, timeoutMs, outcomeDeadline.signal.aborted);
            const message = errorMessage(bounded);
            this.pending.delete(key);
            if (bounded instanceof ShadowRewindError && isCheckpointSkipCode(bounded.code)) {
                this.skips.set(key, message);
            }
            else {
                this.failures.set(key, message);
            }
        }
        finally {
            captureDeadline.cancel();
            outcomeDeadline.cancel();
            // 捕获完成后允许同回合重试（幂等由引擎 duplicate 检查保证）。
            this.captures.delete(key);
        }
    }
    /** 同一工作区的捕获排队执行，避免交错快照半新半旧的树。 */
    async serializeWorkspace(workspace, signal, task) {
        const previous = this.workspaceTails.get(workspace) ?? Promise.resolve();
        const current = (async () => {
            await raceWithSignal(previous.catch(() => undefined), signal).catch(() => undefined);
            signal.throwIfAborted();
            await task();
        })();
        this.workspaceTails.set(workspace, current);
        try {
            await current;
        }
        finally {
            if (this.workspaceTails.get(workspace) === current)
                this.workspaceTails.delete(workspace);
        }
    }
    async recordFailure(ctx, sessionId, turn, error, context) {
        const message = errorMessage(error);
        const key = checkpointKey(sessionId, turn);
        if (error instanceof ShadowRewindError && isCheckpointSkipCode(error.code)) {
            boundedSet(this.skips, key, message);
            if (context !== undefined) {
                try {
                    await this.engine.recordTurnCheckpointSkip({
                        cwd: context.cwd,
                        sessionId,
                        turn,
                        turnStartSeq: context.turnStartSeq,
                        reason: message,
                    });
                }
                catch (persistError) {
                    ctx.logger.warn(`[shadow-rewind] 无法持久化检查点跳过记录（${sessionId} turn ${String(turn)}）：${errorMessage(persistError)}`);
                }
            }
            ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 检查点已跳过：${message}`);
            return;
        }
        boundedSet(this.failures, key, message);
        ctx.logger.warn(`[shadow-rewind] 回合 ${String(turn)} 检查点失败：${message}`);
    }
}
/**
 * 有界写入：超过 maxEntries 时淘汰最早写入的条目。
 * 跳过/失败记录按「会话×回合」增长，长驻进程必须设上限防止缓慢泄漏。
 */
function boundedSet(map, key, value, maxEntries = 256) {
    if (!map.has(key) && map.size >= maxEntries) {
        const oldest = map.keys().next().value;
        if (oldest !== undefined)
            map.delete(oldest);
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
    signal.addEventListener('abort', onAbort, { once: true });
    try {
        return await Promise.race([promise, aborted]);
    }
    finally {
        signal.removeEventListener('abort', onAbort);
    }
}
function asCheckpointError(error, timeoutMs, deadlineAborted) {
    if (deadlineAborted && !(error instanceof ShadowRewindError && error.code === 'TURN_CHECKPOINT_TIMEOUT')) {
        return new ShadowRewindError('TURN_CHECKPOINT_TIMEOUT', `自动检查点超出 ${String(timeoutMs)} ms`, { cause: error });
    }
    return error;
}
function findLast(items, predicate) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item !== undefined && predicate(item))
            return item;
    }
    return undefined;
}
/** 注册同源端点；非回环请求一律 403（与旧插件同一安全边界）。 */
export function installShadowRewindHttp(ctx, engine, coordinator) {
    ctx.webServer?.register({
        kind: 'exact',
        path: REWIND_HTTP_PATH,
        handler: (request, response) => handleRewindHttp(ctx, engine, coordinator, request, response),
    });
}
async function handleRewindHttp(deps, engine, coordinator, request, response) {
    try {
        if (!isLoopback(request.socket.remoteAddress)) {
            response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
            response.end(`${JSON.stringify({ error: 'forbidden', code: 'FORBIDDEN' })}\n`);
            return;
        }
        if (request.method === 'GET') {
            const url = new URL(request.url ?? REWIND_HTTP_PATH, 'http://dsh.local');
            const sessionId = requiredText(url.searchParams.get('sessionId'), 'sessionId');
            const messageSeq = nonNegativeInteger(url.searchParams.get('messageSeq'), 'messageSeq');
            const detailsOnly = url.searchParams.get('details') === '1';
            const offset = nonNegativeInteger(url.searchParams.get('offset') ?? '0', 'offset');
            const limit = pageSize(url.searchParams.get('limit'), detailsOnly ? MAX_CHANGE_PAGE_SIZE : INITIAL_CHANGE_PREVIEW_LIMIT);
            const { target, checkpoint } = await resolveMessageCheckpoint(deps, engine, sessionId, messageSeq);
            if (checkpoint === undefined) {
                // 没有持久检查点：先查持久跳过，再回落内存状态。
                const durableSkip = await engine.findTurnCheckpointSkip({
                    cwd: target.cwd,
                    sessionId,
                    turn: target.turn,
                    turnStartSeq: target.turnStartSeq,
                }).catch(() => undefined);
                json(response, 200, durableSkip ?? coordinator.state(sessionId, target.turn));
                return;
            }
            const inspection = await engine.inspect({ cwd: checkpoint.cwd, restorePointId: checkpoint.id });
            const activeSessionIds = await sharedWorkspaceSessions(deps, checkpoint.cwd);
            const changes = inspection.changes.slice(offset, offset + limit);
            const restoreBlocked = activeSessionIds.length > 0;
            const common = {
                status: 'ready',
                sessionId,
                messageSeq,
                turn: checkpoint.turn,
                checkpointId: checkpoint.id,
                turnStartSeq: checkpoint.turnStartSeq,
                totalChanges: inspection.changes.length,
                changes: changes.map((change) => ({ path: change.path, kind: change.kind })),
                offset,
                truncated: offset + changes.length < inspection.changes.length,
                activeSessionIds,
                restoreBlocked,
                // 跳过项逐条透传 {path, reason}——用户必须能看到具体哪些文件
                // 不在快照内、为什么，而不是只给一个数字。
                skippedPaths: inspection.skippedPaths.map((skip) => ({ path: skip.path, reason: skip.reason })),
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
            });
            json(response, 200, { ...common, planId: plan.id, confirmation: plan.confirmation });
            return;
        }
        if (request.method === 'POST') {
            const body = await readJsonBody(request);
            const mode = body.mode;
            if (mode !== 'code' && mode !== 'both') {
                throw new ShadowRewindError('INVALID_ARGUMENTS', 'mode 必须是 "code" 或 "both"');
            }
            const record = body;
            const sessionId = requiredText(record.sessionId, 'sessionId');
            const messageSeq = nonNegativeInteger(record.messageSeq, 'messageSeq');
            const checkpointId = requiredText(record.checkpointId, 'checkpointId');
            const checkpoint = await checkpointForRequest(deps, engine, sessionId, messageSeq, checkpointId);
            const activeSessionIds = await sharedWorkspaceSessions(deps, checkpoint.cwd);
            if (activeSessionIds.length > 0) {
                throw new ShadowRewindError('WORKSPACE_IN_USE', `项目目录同时被其它会话使用：${activeSessionIds.slice(0, 5).join(', ')}`);
            }
            const planId = optionalText(record.planId, 'planId');
            const confirmation = optionalText(record.confirmation, 'confirmation');
            if (planId === undefined || confirmation === undefined) {
                throw new ShadowRewindError('NO_CHANGES', '该回合没有可恢复的项目文件变更');
            }
            const restoreResult = await engine.applyRestore({ planId, confirmation, sessionId });
            if (mode === 'code') {
                json(response, 200, { status: 'completed', mode, ...restoreResult });
                return;
            }
            try {
                const fork = await createConversationRestart(deps, sessionId, checkpoint);
                json(response, 200, { status: 'completed', mode, sessionId: fork.sessionId, ...restoreResult });
            }
            catch (forkError) {
                // 文件已恢复但建会话失败：把文件滚回操作前，绝不留半完成状态。
                // 补偿本身也会产生一个 rescue 点——堆叠由引擎的 rescue 修剪上限控制。
                try {
                    const inspection = await engine.inspect({ cwd: checkpoint.cwd, restorePointId: restoreResult.rescuePointId });
                    const plan = await engine.planRestore({
                        cwd: checkpoint.cwd,
                        restorePointId: restoreResult.rescuePointId,
                        sessionId,
                        expectedCurrentTreeHash: inspection.currentTreeHash,
                    });
                    await engine.applyRestore({ planId: plan.id, confirmation: plan.confirmation, sessionId });
                }
                catch (rollbackError) {
                    throw new ShadowRewindError('RECOVERY_REQUIRED', `新会话创建失败且回滚也失败，可从备份点 ${restoreResult.rescuePointId} 手工恢复。${errorMessage(rollbackError)}`);
                }
                throw new ShadowRewindError('CONVERSATION_REWIND_FAILED', `文件已自动还原；新会话创建失败：${errorMessage(forkError)}`, { cause: forkError });
            }
            return;
        }
        json(response, 405, { error: 'method not allowed', code: 'METHOD_NOT_ALLOWED' });
    }
    catch (error) {
        const status = error instanceof ShadowRewindError && error.code === 'RESTORE_POINT_NOT_FOUND' ? 404 : 409;
        json(response, status, {
            error: errorMessage(error),
            code: error instanceof ShadowRewindError ? error.code : 'REWIND_FAILED',
        });
    }
}
async function readSession(deps, sessionId) {
    const live = deps.sessions.get(sessionId);
    if (live !== undefined) {
        return {
            id: live.id,
            header: live.session.header,
            events: live.session.events,
        };
    }
    const stored = await deps.sessionQuery.readSession(sessionId);
    return {
        id: stored.session.id,
        header: { cwd: stored.session.cwd, parentSession: stored.session.parentSession, seedLength: stored.session.seedLength },
        events: stored.events,
    };
}
async function resolveMessageCheckpoint(deps, engine, sessionId, messageSeq) {
    let current = await readSession(deps, sessionId);
    const target = messageTarget(current, messageSeq);
    const direct = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId, turn: target.turn });
    if (direct !== undefined) {
        if (direct.turnStartSeq !== target.turnStartSeq) {
            throw new ShadowRewindError('PLAN_STALE', '该消息的检查点与回合起点不再匹配');
        }
        return { target, checkpoint: { ...target, id: direct.id } };
    }
    // 子会话（fork 产物）没有自己的检查点时，沿父链在 seed 范围内继承。
    const seen = new Set([sessionId]);
    for (;;) {
        const parentId = current.header.parentSession;
        const seedLength = current.header.seedLength;
        if ((parentId === undefined) !== (seedLength === undefined)) {
            throw new ShadowRewindError('PLAN_STALE', '会话分叉谱系的父元数据不完整');
        }
        if (parentId === undefined || seedLength === undefined
            || target.messageSeq >= seedLength || target.turnStartSeq >= seedLength) {
            return { target };
        }
        if (seen.has(parentId)) {
            throw new ShadowRewindError('PLAN_STALE', '会话分叉谱系出现环');
        }
        seen.add(parentId);
        try {
            current = await readSession(deps, parentId);
        }
        catch (error) {
            throw new ShadowRewindError('PLAN_STALE', `父会话 ${parentId} 不可读`, { cause: error });
        }
        const parentTarget = messageTarget(current, messageSeq);
        if (parentTarget.turn !== target.turn
            || parentTarget.turnStartSeq !== target.turnStartSeq
            || parentTarget.previousTurnEndSeq !== target.previousTurnEndSeq) {
            throw new ShadowRewindError('PLAN_STALE', '分叉谱系与继承的消息边界不再匹配');
        }
        const inherited = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId: parentId, turn: target.turn });
        if (inherited === undefined)
            continue;
        if (inherited.turnStartSeq !== target.turnStartSeq) {
            throw new ShadowRewindError('PLAN_STALE', '继承的检查点与分叉边界不匹配');
        }
        return { target, checkpoint: { ...target, id: inherited.id } };
    }
}
async function checkpointForRequest(deps, engine, sessionId, messageSeq, requestedId) {
    const { target, checkpoint } = await resolveMessageCheckpoint(deps, engine, sessionId, messageSeq);
    if (checkpoint === undefined) {
        throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `消息 ${String(messageSeq)} 没有可用的回退检查点`);
    }
    if (requestedId !== checkpoint.id) {
        throw new ShadowRewindError('PLAN_STALE', '该消息的检查点已变化；请重新打开回退对话框');
    }
    return checkpoint;
}
async function createConversationRestart(deps, sourceId, checkpoint) {
    const source = await readSession(deps, sourceId);
    const current = messageTarget(source, checkpoint.messageSeq);
    if (current.turn !== checkpoint.turn
        || current.turnStartSeq !== checkpoint.turnStartSeq
        || current.previousTurnEndSeq !== checkpoint.previousTurnEndSeq) {
        throw new ShadowRewindError('PLAN_STALE', '会话中已找不到所选消息的回合边界');
    }
    const response = checkpoint.previousTurnEndSeq === undefined
        ? await deps.apiProxy.sessions.create({ rpcId: randomUUID(), payload: { cwd: checkpoint.cwd } })
        : await deps.apiProxy.sessions.fork({ rpcId: randomUUID(), payload: { sessionId: sourceId, atSeq: checkpoint.previousTurnEndSeq } });
    if (!response.result.ok) {
        throw new ShadowRewindError('CONVERSATION_REWIND_FAILED', response.result.error?.message ?? '未知错误');
    }
    return { sessionId: requiredText(response.result.value?.sessionId, 'fork sessionId') };
}
function messageTarget(session, messageSeq) {
    const cwd = session.header.cwd;
    if (cwd === undefined) {
        throw new ShadowRewindError('WORKSPACE_REQUIRED', `会话 ${session.id} 没有工作目录`);
    }
    const message = session.events.find((event) => event.type === 'user/message' && event.seq === messageSeq && isDirectUserMessage(event));
    if (message === undefined) {
        throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `会话 ${session.id} 在 ${String(messageSeq)} 处没有用户消息`);
    }
    const start = findLast(session.events, (event) => event.type === 'turn/start' && event.seq < messageSeq);
    const turn = start?.data.turn;
    if (start === undefined || !Number.isSafeInteger(turn) || (turn ?? 0) < 0) {
        throw new ShadowRewindError('PLAN_STALE', '所选消息没有有效的回合起点');
    }
    // 只允许回退回合的第一条直发消息（插件注入等来源不可回退）。
    const opening = session.events.find((event) => event.type === 'user/message'
        && event.seq > start.seq
        && event.seq <= messageSeq
        && isDirectUserMessage(event));
    if (opening?.seq !== messageSeq) {
        throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', '只支持回退回合的第一条用户消息');
    }
    const interveningEnd = session.events.find((event) => event.type === 'turn/end' && event.seq > start.seq && event.seq < messageSeq);
    if (interveningEnd !== undefined) {
        throw new ShadowRewindError('PLAN_STALE', '所选消息已不在其记录的回合内');
    }
    const previousEnd = findLast(session.events, (event) => event.type === 'turn/end' && event.seq < start.seq);
    return {
        cwd,
        messageSeq,
        turn: turn,
        turnStartSeq: start.seq,
        ...(previousEnd === undefined ? {} : { previousTurnEndSeq: previousEnd.seq }),
    };
}
function isDirectUserMessage(event) {
    const source = event.data.source;
    return source !== null && typeof source === 'object' && !Array.isArray(source)
        && source.kind === 'user';
}
/** 列出与目标目录共享同一工作区的活跃会话（canonical realpath 比对）。 */
async function sharedWorkspaceSessions(deps, cwd) {
    const listed = deps.agents.list();
    if (listed.length === 0)
        return [];
    const root = await canonicalDirectory(cwd).catch(() => undefined);
    if (root === undefined)
        return [];
    const shared = [];
    for (const agent of listed) {
        if (agent.status !== 'running')
            continue;
        const agentCwd = agent.session.header.cwd;
        if (agentCwd === undefined)
            continue;
        const agentRoot = await canonicalDirectory(agentCwd).catch(() => undefined);
        if (agentRoot === root)
            shared.push(agent.session.id);
    }
    return shared.sort();
}
// ── HTTP 小工具 ─────────────────────────────────────────────────────────────
function isLoopback(address) {
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
function json(response, status, value) {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`${JSON.stringify(value)}\n`);
}
async function readJsonBody(request) {
    const chunks = [];
    let size = 0;
    await new Promise((resolve, reject) => {
        request.on('data', (chunk) => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > BODY_LIMIT) {
                reject(new ShadowRewindError('INVALID_ARGUMENTS', '请求体过大'));
                return;
            }
            chunks.push(bytes);
        });
        request.on('end', () => resolve());
        request.on('error', reject);
    });
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch (error) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', '请求体必须是合法 JSON', { cause: error });
    }
}
function requiredText(value, name) {
    if (typeof value !== 'string' || value === '') {
        throw new ShadowRewindError('INVALID_ARGUMENTS', `${name} 必须是非空字符串`);
    }
    return value;
}
function optionalText(value, name) {
    return value === undefined ? undefined : requiredText(value, name);
}
function nonNegativeInteger(value, name) {
    const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', `${name} 必须是非负整数`);
    }
    return parsed;
}
function pageSize(value, fallback) {
    if (value === null)
        return fallback;
    const parsed = nonNegativeInteger(value, 'limit');
    if (parsed < 1 || parsed > MAX_CHANGE_PAGE_SIZE) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', `limit 必须在 1 到 ${String(MAX_CHANGE_PAGE_SIZE)} 之间`);
    }
    return parsed;
}
//# sourceMappingURL=rewind-host.js.map