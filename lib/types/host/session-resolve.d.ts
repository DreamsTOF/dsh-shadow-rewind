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
import type { ShadowRewindEngine } from '../engine.js';
import type { RestoreResult } from '../types.js';
import type { TurnCheckpointCoordinator } from './coordinator.js';
import type { RewindHttpDeps } from './types.js';
/** 宿主事件流的会话事件面（与 SessionLogEvent 同形；readSession 统一返回此形状）。 */
export interface SessionEvent {
    readonly type: string;
    readonly seq: number;
    readonly data: {
        readonly turn?: number;
        readonly source?: unknown;
    };
}
/**
 * 归一化宿主会话读取：把 live（ctx.sessions.get）与冷读（sessionQuery
 * readSession）两种来源统一成 `{ id, header{...,seedLength}, events }`，
 * 并把 0.1.2 的 `inheritedEventCount` 映射回插件内部使用的 `seedLength`
 * 语义（fork 继承边界 = 继承事件前缀长度），下游逻辑零改动。
 */
export declare function readSession(deps: Pick<RewindHttpDeps, 'sessions' | 'sessionQuery'>, sessionId: string): Promise<{
    id: string;
    header: {
        cwd?: string;
        parentSession?: string;
        seedLength?: number;
    };
    events: readonly SessionEvent[];
}>;
/** 消息恢复的执行入口：解析 + 与请求带来的 checkpointId 核对（防错配）。 */
export declare function checkpointForRequest(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, messageSeq: number, requestedId: string): Promise<{
    id: string;
    cwd: string;
    messageSeq: number;
    turn: number;
    turnStartSeq: number;
    previousTurnEndSeq?: number;
}>;
interface CheckpointRef {
    readonly id: string;
    readonly cwd: string;
    readonly turn: number;
    readonly turnStartSeq: number;
    readonly previousTurnEndSeq?: number;
    /** 消息模式回显；turn 模式没有。 */
    readonly messageSeq?: number;
}
type ResolvedPreviewTarget = {
    readonly status: 'unavailable';
    readonly response: unknown;
} | {
    readonly status: 'ready';
    readonly checkpoint: CheckpointRef;
    readonly messageSeq?: number;
};
/** 消息旁回退按钮的预览定位（messageSeq 寻址）。 */
export declare function resolveMessageRewindTarget(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, messageSeq: number, coordinator: TurnCheckpointCoordinator): Promise<ResolvedPreviewTarget>;
/** 侧边栏「从快照恢复此轮」的预览定位（turn 寻址）。 */
export declare function resolveTurnRewindTarget(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, turn: number, coordinator: TurnCheckpointCoordinator): Promise<ResolvedPreviewTarget>;
/** 回合快照恢复的执行入口：解析 + 与请求带来的 checkpointId 核对。 */
export declare function turnCheckpointForRequest(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, turn: number, requestedId: string): Promise<{
    id: string;
    cwd: string;
}>;
/** 执行前的公共闸门：计划与检查点同源核对（1.4 #6，检测保留）+
 * planId 必须齐备。确认串已废除（1.4 #2）——「确认」由 GUI 弹窗承担。 */
export declare function applyGuarded(deps: RewindHttpDeps, engine: ShadowRewindEngine, sessionId: string, checkpoint: {
    readonly id: string;
    readonly cwd: string;
}, planId: string | undefined): Promise<RestoreResult>;
/**
 * 「恢复并继续」：文件恢复后按消息边界重建会话——
 *  - 回合前无更早轮终点：直接 create 新会话（首个用户回合）；
 *  - 有 previousTurnEndSeq：在源会话上 fork 到该边界。
 */
export declare function createConversationRestart(deps: RewindHttpDeps, sourceId: string, checkpoint: {
    cwd: string;
    messageSeq: number;
    turn: number;
    turnStartSeq: number;
    previousTurnEndSeq?: number;
}): Promise<{
    sessionId: string;
}>;
/** 列出与目标目录共享同一工作区的活跃会话（canonical realpath 比对）。 */
export declare function sharedWorkspaceSessions(deps: RewindHttpDeps, cwd: string): Promise<readonly string[]>;
export {};
