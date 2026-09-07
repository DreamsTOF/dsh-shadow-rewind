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

import { ShadowRewindError, errorMessage } from '../errors.js'
import { canonicalDirectory } from '../path-utils.js'
import type { ShadowRewindEngine } from '../engine.js'
import type { RestoreResult } from '../types.js'
import type { TurnCheckpointCoordinator } from './coordinator.js'
import { bumpWorkspaceRevision } from './revision.js'
import { findLast } from './coordinator.js'
import { sessionEvents } from './types.js'
import type { HostSessionCore, RewindHttpDeps } from './types.js'

/** 宿主事件流的会话事件面（与 SessionLogEvent 同形；readSession 统一返回此形状）。 */
export interface SessionEvent {
  readonly type: string
  readonly seq: number
  readonly data: { readonly turn?: number; readonly source?: unknown }
}

/** 消息回退目标的会话事实：回合边界 + 前一轮终点(fork 用)。 */
interface MessageTarget {
  readonly cwd: string
  readonly messageSeq: number
  readonly turn: number
  readonly turnStartSeq: number
  readonly previousTurnEndSeq?: number
}

/**
 * 归一化宿主会话读取：把 live（ctx.sessions.get）与冷读（sessionQuery
 * readSession）两种来源统一成 `{ id, header{...,seedLength}, events }`，
 * 并把 0.1.2 的 `inheritedEventCount` 映射回插件内部使用的 `seedLength`
 * 语义（fork 继承边界 = 继承事件前缀长度），下游逻辑零改动。
 */
export async function readSession(
  deps: Pick<RewindHttpDeps, 'sessions' | 'sessionQuery'>,
  sessionId: string,
): Promise<{ id: string; header: { cwd?: string; parentSession?: string; seedLength?: number }; events: readonly SessionEvent[] }> {
  const live = deps.sessions.get(sessionId)
  if (live !== undefined) {
    const core: HostSessionCore | undefined = live.session ?? live
    const header = core?.header
    const inherited = core?.inheritedEventCount ?? header?.seedLength
    return {
      id: core?.id ?? live.id ?? sessionId,
      header: {
        ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
        ...(header?.parentSession === undefined ? {} : { parentSession: header.parentSession }),
        ...(inherited === undefined ? {} : { seedLength: inherited }),
      },
      events: sessionEvents(core ?? live) as readonly SessionEvent[],
    }
  }
  const stored = await deps.sessionQuery.readSession(sessionId)
  const header = stored.session
  const inherited = stored.inheritedEventCount ?? header.seedLength
  return {
    id: header.id ?? sessionId,
    header: {
      ...(header.cwd === undefined ? {} : { cwd: header.cwd }),
      ...(header.parentSession === undefined ? {} : { parentSession: header.parentSession }),
      ...(inherited === undefined ? {} : { seedLength: inherited }),
    },
    events: (stored.events ?? []) as readonly SessionEvent[],
  }
}

/** 消息 → 检查点解析总入口：先查（含 fork 继承的）回合检查点；缺席时用
 * BEFORE 日志物化的部分树消息检查点兜底——「消除没料可回」。 */
async function resolveMessageCheckpoint(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, messageSeq: number): Promise<{
  target: MessageTarget
  checkpoint?: { id: string; cwd: string; messageSeq: number; turn: number; turnStartSeq: number; previousTurnEndSeq?: number }
}> {
  const viaCheckpoints = await resolveMessageCheckpointViaCheckpoints(deps, engine, sessionId, messageSeq)
  if (viaCheckpoints.checkpoint !== undefined) return viaCheckpoints
  const { target } = viaCheckpoints
  const messagePoint = await engine.ensureMessageRestorePoint({
    cwd: target.cwd,
    sessionId,
    messageSeq,
    turn: target.turn,
    turnStartSeq: target.turnStartSeq,
  }).catch(() => undefined)
  if (messagePoint === undefined) return { target }
  return {
    target,
    checkpoint: {
      id: messagePoint.id,
      cwd: target.cwd,
      messageSeq,
      turn: target.turn,
      turnStartSeq: target.turnStartSeq,
      ...(target.previousTurnEndSeq === undefined ? {} : { previousTurnEndSeq: target.previousTurnEndSeq }),
    },
  }
}

/** 消息 → 回合检查点：直查本会话，未命中则沿 fork 父链在 seed 范围内继承。 */
async function resolveMessageCheckpointViaCheckpoints(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, messageSeq: number): Promise<{
  target: MessageTarget
  checkpoint?: { id: string; cwd: string; messageSeq: number; turn: number; turnStartSeq: number; previousTurnEndSeq?: number }
}> {
  let current = await readSession(deps, sessionId)
  const target = messageTarget(current, messageSeq)
  const direct = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId, turn: target.turn })
  if (direct !== undefined) {
    if (direct.turnStartSeq !== target.turnStartSeq) {
      throw new ShadowRewindError('PLAN_STALE', '该消息的检查点与回合起点不再匹配')
    }
    return { target, checkpoint: { ...target, id: direct.id } }
  }
  // 子会话（fork 产物）没有自己的检查点时，沿父链在 seed 范围内继承。
  const seen = new Set([sessionId])
  for (;;) {
    const parentId = current.header.parentSession
    const seedLength = current.header.seedLength
    if ((parentId === undefined) !== (seedLength === undefined)) {
      throw new ShadowRewindError('PLAN_STALE', '会话分叉谱系的父元数据不完整')
    }
    if (parentId === undefined || seedLength === undefined
      || target.messageSeq >= seedLength || target.turnStartSeq >= seedLength) {
      return { target }
    }
    if (seen.has(parentId)) {
      throw new ShadowRewindError('PLAN_STALE', '会话分叉谱系出现环')
    }
    seen.add(parentId)
    try {
      current = await readSession(deps, parentId)
    } catch (error) {
      throw new ShadowRewindError('PLAN_STALE', `父会话 ${parentId} 不可读`, { cause: error })
    }
    const parentTarget = messageTarget(current, messageSeq)
    if (parentTarget.turn !== target.turn
      || parentTarget.turnStartSeq !== target.turnStartSeq
      || parentTarget.previousTurnEndSeq !== target.previousTurnEndSeq) {
      throw new ShadowRewindError('PLAN_STALE', '分叉谱系与继承的消息边界不再匹配')
    }
    const inherited = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId: parentId, turn: target.turn })
    if (inherited === undefined) continue
    if (inherited.turnStartSeq !== target.turnStartSeq) {
      throw new ShadowRewindError('PLAN_STALE', '继承的检查点与分叉边界不匹配')
    }
    return { target, checkpoint: { ...target, id: inherited.id } }
  }
}

/** 消息恢复的执行入口：解析 + 与请求带来的 checkpointId 核对（防错配）。 */
export async function checkpointForRequest(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, messageSeq: number, requestedId: string): Promise<{ id: string; cwd: string; messageSeq: number; turn: number; turnStartSeq: number; previousTurnEndSeq?: number }> {
  const { target, checkpoint } = await resolveMessageCheckpoint(deps, engine, sessionId, messageSeq)
  if (checkpoint === undefined) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `消息 ${String(messageSeq)} 没有可用的回退检查点`)
  }
  if (requestedId !== checkpoint.id) {
    throw new ShadowRewindError('PLAN_STALE', '该消息的检查点已变化；请重新打开回退对话框')
  }
  return checkpoint
}

// ── 预览目标解析（消息 / 回合两种定位统一到同一个预览尾部）────────────────

interface CheckpointRef {
  readonly id: string
  readonly cwd: string
  readonly turn: number
  readonly turnStartSeq: number
  readonly previousTurnEndSeq?: number
  /** 消息模式回显；turn 模式没有。 */
  readonly messageSeq?: number
}

type ResolvedPreviewTarget =
  | { readonly status: 'unavailable'; readonly response: unknown }
  | { readonly status: 'ready'; readonly checkpoint: CheckpointRef; readonly messageSeq?: number }

/** 消息旁回退按钮的预览定位（messageSeq 寻址）。 */
export async function resolveMessageRewindTarget(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, messageSeq: number, coordinator: TurnCheckpointCoordinator): Promise<ResolvedPreviewTarget> {
  const { target, checkpoint } = await resolveMessageCheckpoint(deps, engine, sessionId, messageSeq)
  if (checkpoint === undefined) {
    // 没有持久检查点：先查持久跳过，再回落内存状态。
    const durableSkip = await engine.findTurnCheckpointSkip({
      cwd: target.cwd,
      sessionId,
      turn: target.turn,
      turnStartSeq: target.turnStartSeq,
    }).catch(() => undefined)
    return { status: 'unavailable', response: durableSkip ?? coordinator.state(sessionId, target.turn) }
  }
  return {
    status: 'ready',
    messageSeq,
    checkpoint: {
      id: checkpoint.id,
      cwd: checkpoint.cwd,
      turn: checkpoint.turn,
      turnStartSeq: checkpoint.turnStartSeq,
      ...(checkpoint.previousTurnEndSeq === undefined ? {} : { previousTurnEndSeq: checkpoint.previousTurnEndSeq }),
    },
  }
}

/** 侧边栏「从快照恢复此轮」的预览定位（turn 寻址）。 */
export async function resolveTurnRewindTarget(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, turn: number, coordinator: TurnCheckpointCoordinator): Promise<ResolvedPreviewTarget> {
  const resolved = await resolveTurnCheckpoint(deps, engine, sessionId, turn)
  if (resolved.checkpoint === undefined) {
    const durableSkip = await engine.findTurnCheckpointSkip({
      cwd: resolved.cwd,
      sessionId,
      turn,
      turnStartSeq: resolved.turnStartSeq,
    }).catch(() => undefined)
    return { status: 'unavailable', response: durableSkip ?? coordinator.state(sessionId, turn) }
  }
  return {
    status: 'ready',
    checkpoint: { id: resolved.checkpoint.id, cwd: resolved.cwd, turn, turnStartSeq: resolved.turnStartSeq },
  }
}

/**
 * 回合 → 检查点解析：优先本会话自身的检查点；fork 产物在本会话没有该回合
 * 检查点时沿父链继承——只有回合起点落在 seed 范围内（fork 之前发生的回合）
 * 才允许继承，且继承检查点的 turnStartSeq 必须与本会话的回合起点一致。
 */
async function resolveTurnCheckpoint(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, turn: number): Promise<{
  cwd: string
  turnStartSeq: number
  checkpoint?: { id: string }
}> {
  const viaCheckpoints = await resolveTurnCheckpointViaCheckpoints(deps, engine, sessionId, turn)
  if (viaCheckpoints.checkpoint !== undefined) return viaCheckpoints
  // BEFORE 日志兜底：回合检查点缺席时，取该回合的开场用户消息并物化消息检查点。
  const session = await readSession(deps, sessionId).catch(() => undefined)
  const opening = session?.events.find((event) => event.type === 'user/message'
    && event.seq > viaCheckpoints.turnStartSeq
    && isDirectUserMessage(event))
  if (session === undefined || opening === undefined) return viaCheckpoints
  const messagePoint = await engine.ensureMessageRestorePoint({
    cwd: viaCheckpoints.cwd,
    sessionId,
    messageSeq: opening.seq,
    turn,
    turnStartSeq: viaCheckpoints.turnStartSeq,
  }).catch(() => undefined)
  if (messagePoint === undefined) return viaCheckpoints
  return { cwd: viaCheckpoints.cwd, turnStartSeq: viaCheckpoints.turnStartSeq, checkpoint: { id: messagePoint.id } }
}

async function resolveTurnCheckpointViaCheckpoints(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, turn: number): Promise<{
  cwd: string
  turnStartSeq: number
  checkpoint?: { id: string }
}> {
  let current = await readSession(deps, sessionId)
  const target = turnTarget(current, turn)
  const direct = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId, turn })
  if (direct !== undefined) {
    if (direct.turnStartSeq !== target.turnStartSeq) {
      throw new ShadowRewindError('PLAN_STALE', '该回合的检查点与回合起点不再匹配')
    }
    return { cwd: target.cwd, turnStartSeq: target.turnStartSeq, checkpoint: { id: direct.id } }
  }
  const seen = new Set([sessionId])
  for (;;) {
    const parentId = current.header.parentSession
    const seedLength = current.header.seedLength
    if (parentId === undefined || seedLength === undefined || target.turnStartSeq >= seedLength) {
      return { cwd: target.cwd, turnStartSeq: target.turnStartSeq }
    }
    if (seen.has(parentId)) {
      throw new ShadowRewindError('PLAN_STALE', '会话分叉谱系出现环')
    }
    seen.add(parentId)
    try {
      current = await readSession(deps, parentId)
    } catch (error) {
      throw new ShadowRewindError('PLAN_STALE', `父会话 ${parentId} 不可读`, { cause: error })
    }
    const inherited = await engine.findTurnCheckpoint({ cwd: target.cwd, sessionId: parentId, turn })
    if (inherited === undefined) continue
    if (inherited.turnStartSeq !== target.turnStartSeq) {
      throw new ShadowRewindError('PLAN_STALE', '继承的检查点与该回合起点不匹配')
    }
    return { cwd: target.cwd, turnStartSeq: target.turnStartSeq, checkpoint: { id: inherited.id } }
  }
}

/** 回合 → 会话事实：cwd + turn/start 事件的 seq（检查点配对的锚）。 */
function turnTarget(session: { id: string; header: { cwd?: string }; events: readonly SessionEvent[] }, turn: number): { cwd: string; turnStartSeq: number } {
  const cwd = session.header.cwd
  if (cwd === undefined) {
    throw new ShadowRewindError('WORKSPACE_REQUIRED', `会话 ${session.id} 没有工作目录`)
  }
  const start = session.events.find((event) => event.type === 'turn/start' && event.data.turn === turn)
  if (start === undefined) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `会话 ${session.id} 没有回合 ${String(turn)} 的起点`)
  }
  return { cwd, turnStartSeq: start.seq }
}

/** 回合快照恢复的执行入口：解析 + 与请求带来的 checkpointId 核对。 */
export async function turnCheckpointForRequest(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, turn: number, requestedId: string): Promise<{ id: string; cwd: string }> {
  const resolved = await resolveTurnCheckpoint(deps, engine, sessionId, turn)
  if (resolved.checkpoint === undefined) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `回合 ${String(turn)} 没有可用的快照检查点`)
  }
  if (requestedId !== resolved.checkpoint.id) {
    throw new ShadowRewindError('PLAN_STALE', '该回合的检查点已变化；请重新检查')
  }
  return { id: resolved.checkpoint.id, cwd: resolved.cwd }
}

/** 执行前的公共闸门：计划与检查点同源核对（1.4 #6，检测保留）+
 * planId 必须齐备。确认串已废除（1.4 #2）——「确认」由 GUI 弹窗承担。 */
export async function applyGuarded(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, checkpoint: { readonly id: string; readonly cwd: string }, planId: string | undefined): Promise<RestoreResult> {
  if (planId === undefined) {
    throw new ShadowRewindError('NO_CHANGES', '该回合没有可恢复的项目文件变更')
  }
  // 两种寻址（checkpointId 校验与 plan 校验）必须指向同一个恢复点：
  // 错配（A 预览的 id 配 B 计划的凭据）会静默恢复到错误时点。
  const plan = await engine.getRestorePlan(planId)
  if (plan === undefined || plan.restorePointId !== checkpoint.id || plan.workspace !== checkpoint.cwd) {
    throw new ShadowRewindError('PLAN_STALE', '恢复计划与所选检查点不匹配；请重新打开预览后重试')
  }
  const result = await engine.applyRestore({ planId, sessionId })
  // 恢复改变了磁盘与快照历史：数据版本递增，客户端 fs 缓存随之失效。
  await bumpWorkspaceRevision(checkpoint.cwd)
  return result
}

/**
 * 「恢复并继续」：文件恢复后按消息边界重建会话——
 *  - 回合前无更早轮终点：直接 create 新会话（首个用户回合）；
 *  - 有 previousTurnEndSeq：在源会话上 fork 到该边界。
 */
export async function createConversationRestart(deps: RewindHttpDeps, sourceId: string, checkpoint: { cwd: string; messageSeq: number; turn: number; turnStartSeq: number; previousTurnEndSeq?: number }): Promise<{ sessionId: string }> {
  const source = await readSession(deps, sourceId)
  const current = messageTarget(source, checkpoint.messageSeq)
  if (current.turn !== checkpoint.turn
    || current.turnStartSeq !== checkpoint.turnStartSeq
    || current.previousTurnEndSeq !== checkpoint.previousTurnEndSeq) {
    throw new ShadowRewindError('PLAN_STALE', '会话中已找不到所选消息的回合边界')
  }
  try {
    // dsh 0.1.2 起 apiProxy 移除：会话网关收敛为 `ctx.sessionController`
    // （方法直连、错误以 throw 表达），不再包 RPC 信封。
    const sessionId = checkpoint.previousTurnEndSeq === undefined
      ? (await deps.sessionController.create({ cwd: checkpoint.cwd })).sessionId
      : (await deps.sessionController.fork({ sessionId: sourceId, atSeq: checkpoint.previousTurnEndSeq })).sessionId
    return { sessionId }
  } catch (error) {
    throw new ShadowRewindError('CONVERSATION_REWIND_FAILED', errorMessage(error), { cause: error })
  }
}

/** 消息 → 会话事实（含一系列 fail-closed 校验，见各 throw）。 */
function messageTarget(session: { id: string; header: { cwd?: string }; events: readonly SessionEvent[] }, messageSeq: number): MessageTarget {
  const cwd = session.header.cwd
  if (cwd === undefined) {
    throw new ShadowRewindError('WORKSPACE_REQUIRED', `会话 ${session.id} 没有工作目录`)
  }
  const message = session.events.find((event) => event.type === 'user/message' && event.seq === messageSeq && isDirectUserMessage(event))
  if (message === undefined) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `会话 ${session.id} 在 ${String(messageSeq)} 处没有用户消息`)
  }
  const start = findLast(session.events, (event) => event.type === 'turn/start' && event.seq < messageSeq)
  const turn = start?.data.turn
  if (start === undefined || !Number.isSafeInteger(turn) || (turn ?? 0) < 0) {
    throw new ShadowRewindError('PLAN_STALE', '所选消息没有有效的回合起点')
  }
  // 只允许回退回合的第一条直发消息（插件注入等来源不可回退）。
  const opening = session.events.find((event) => event.type === 'user/message'
    && event.seq > start.seq
    && event.seq <= messageSeq
    && isDirectUserMessage(event))
  if (opening?.seq !== messageSeq) {
    throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', '只支持回退回合的第一条用户消息')
  }
  const interveningEnd = session.events.find((event) => event.type === 'turn/end' && event.seq > start.seq && event.seq < messageSeq)
  if (interveningEnd !== undefined) {
    throw new ShadowRewindError('PLAN_STALE', '所选消息已不在其记录的回合内')
  }
  const previousEnd = findLast(session.events, (event) => event.type === 'turn/end' && event.seq < start.seq)
  return {
    cwd,
    messageSeq,
    turn: turn as number,
    turnStartSeq: start.seq,
    ...(previousEnd === undefined ? {} : { previousTurnEndSeq: previousEnd.seq }),
  }
}

/** 直发用户消息判定：source.kind === 'user'（插件注入等来源不满足）。 */
function isDirectUserMessage(event: SessionEvent): boolean {
  const source = event.data.source
  return source !== null && typeof source === 'object' && !Array.isArray(source)
    && (source as { kind?: unknown }).kind === 'user'
}

/** 列出与目标目录共享同一工作区的活跃会话（canonical realpath 比对）。 */
export async function sharedWorkspaceSessions(deps: RewindHttpDeps, cwd: string): Promise<readonly string[]> {
  const listed = deps.agents.list()
  if (listed.length === 0) return []
  const root = await canonicalDirectory(cwd).catch(() => undefined)
  if (root === undefined) return []
  const shared: string[] = []
  for (const agent of listed) {
    if (agent.status !== 'running') continue
    const agentCwd = agent.session.header.cwd
    if (agentCwd === undefined) continue
    const agentRoot = await canonicalDirectory(agentCwd).catch(() => undefined)
    if (agentRoot === root) shared.push(agent.session.id)
  }
  return shared.sort()
}
