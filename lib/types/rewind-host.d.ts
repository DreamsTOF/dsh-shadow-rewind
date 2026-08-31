import type { WorkspaceWriteGate } from './write-gate.js';
import type { ShadowRewindEngine } from './engine.js';
export declare const REWIND_HTTP_PATH = "/shadow-rewind";
/** 写入闸运行时开关的查询/翻转端点（仅回环；不持久化，重启回到配置初值）。 */
export declare const REWIND_GATE_PATH = "/shadow-rewind/gate";
/** 最小化的宿主接口（结构类型）：只声明用到的成员，避免引入 cordis 依赖。 */
export interface HostContext {
    readonly logger: {
        info(message: string): void;
        warn(message: string): void;
        error(message: string): void;
    };
    on(event: 'agent/pre-step', listener: (data: PreStepData, next: () => Promise<unknown>, options?: {
        prepend?: boolean;
    }) => Promise<unknown>, options?: {
        prepend?: boolean;
    }): void;
    on(event: 'session/event', listener: (session: SessionFace, event: SessionEventFace) => void): void;
}
/** session/event 载荷里的会话面（与 AgentFace.session 同形）。 */
export type SessionFace = AgentFace['session'];
/** session/event 载荷里的事件面：只用到 type 与 data.turn。 */
export interface SessionEventFace {
    readonly type: string;
    readonly seq?: number;
    readonly data?: {
        readonly turn?: number;
    };
}
export interface PreStepData {
    readonly agent: AgentFace;
    readonly turn: number;
    readonly step: number;
    readonly signal: AbortSignal;
}
/** 引擎用到的 agent/会话最小面。 */
export interface AgentFace {
    readonly id: string;
    readonly status: string;
    readonly session: {
        readonly id: string;
        readonly header: {
            readonly cwd?: string;
        };
        readonly events: readonly {
            readonly type: string;
            readonly seq: number;
            readonly data: {
                readonly turn?: number;
                readonly source?: unknown;
            };
        }[];
    };
}
/** 每回合第一步之前抢占快照（失败可跳过、可重试，绝不阻塞回合）。 */
export declare class TurnCheckpointCoordinator {
    private readonly engine;
    /** sessionId\0turn → 捕获 Promise（同回合幂等）。 */
    private readonly captures;
    private readonly pending;
    private readonly failures;
    private readonly skips;
    /** sessionId\0turn → 轮末捕获进行中（同回合同相位不重复发起）。 */
    private readonly endCaptures;
    /** workspace → 串行化尾队列：同一工作区的快照绝不并发。 */
    private readonly workspaceTails;
    constructor(engine: ShadowRewindEngine);
    /** 安装第一步闸门（prepend 保证先于其它监听器）与轮末捕获订阅。 */
    install(ctx: HostContext): void;
    /** 轮末捕获（见 install 注释）：与轮起捕获共用工作区串行化尾队列。 */
    captureEnd(ctx: HostContext, session: SessionFace, event: SessionEventFace): Promise<void>;
    /** 无持久检查点时，向 UI 报告当前回合的捕获状态。 */
    state(sessionId: string, turn: number): {
        status: 'pending' | 'skipped' | 'failed' | 'missing';
        reason?: string;
        error?: string;
    };
    capture(ctx: HostContext, agent: AgentFace, turn: number, signal: AbortSignal): Promise<void>;
    /** 同一工作区的捕获排队执行，避免交错快照半新半旧的树。 */
    private serializeWorkspace;
    private recordFailure;
}
/** 最小 HTTP 面（Node 原生 req/res）。 */
interface Request {
    readonly method?: string;
    readonly url?: string;
    readonly socket: {
        readonly remoteAddress?: string;
    };
    on(event: string, listener: (chunk: unknown) => void): void;
    on(event: string, listener: () => void): void;
    on(event: string, listener: (error: unknown) => void): void;
}
interface Response {
    writeHead(status: number, headers: Record<string, string>): void;
    end(body?: string): void;
    on(event: 'data', listener: (chunk: unknown) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (error: unknown) => void): void;
}
/** 宿主给 HTTP 层的服务面（会话读取 / 分叉 / 活跃 agent 列表）。 */
export interface RewindHttpDeps {
    readonly logger: {
        warn(message: string): void;
    };
    readonly sessions: {
        get(sessionId: string): AgentFace | undefined;
    };
    readonly sessionQuery: {
        readSession(sessionId: string): Promise<{
            session: {
                id: string;
                cwd?: string;
                parentSession?: string;
                seedLength?: number;
            };
            events: readonly unknown[];
        }>;
    };
    readonly apiProxy: {
        readonly sessions: {
            create(payload: {
                rpcId: string;
                payload: {
                    cwd: string;
                };
            }): Promise<{
                result: {
                    ok: boolean;
                    value?: {
                        sessionId?: string;
                    };
                    error?: {
                        message: string;
                    };
                };
            }>;
            fork(payload: {
                rpcId: string;
                payload: {
                    sessionId: string;
                    atSeq: number;
                };
            }): Promise<{
                result: {
                    ok: boolean;
                    value?: {
                        sessionId?: string;
                    };
                    error?: {
                        message: string;
                    };
                };
            }>;
        };
    };
    readonly agents: {
        list(): readonly AgentFace[];
    };
}
/** 注册同源端点；非回环请求一律 403（与旧插件同一安全边界）。 */
export declare function installShadowRewindHttp(ctx: RewindHttpDeps & {
    webServer?: {
        register(route: {
            kind: 'exact';
            path: string;
            handler: (request: Request, response: Response) => Promise<void>;
        }): () => void;
    };
}, engine: ShadowRewindEngine, coordinator: TurnCheckpointCoordinator, writeGate: WorkspaceWriteGate): void;
/**
 * 运行中的共享工作区会话分诊：哪些真正阻塞恢复，哪些只是被闸住的旁观者。
 *  - 闸开启：只有「请求者自身」（恢复期间它可能写文件）与「当前所有者」
 *    （唯一未被闸拒绝的写入者）阻塞；其余运行中的会话写入已被拒绝，只提示。
 *  - 闸关闭：保持旧行为——任何运行中的会话都阻塞。
 */
export declare function partitionRunningSessions(runningSessionIds: readonly string[], requesterSessionId: string, ownerSessionId: string | undefined, gateEnabled: boolean): {
    blocking: readonly string[];
    gated: readonly string[];
};
export {};
