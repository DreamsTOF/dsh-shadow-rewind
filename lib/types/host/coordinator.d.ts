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
import type { ShadowRewindEngine } from '../engine.js';
import { HostErrorLog } from './error-log.js';
import type { AgentFace, HostContext, SessionEventFace, SessionFace } from './types.js';
/** 从事件流尾部向前找第一条满足条件的记录(事件按 seq 升序追加)。 */
export declare function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined;
/**
 * 连续失败 count 次后的冷却时长：5 分钟起步、每多失败一次翻倍、60 分钟
 * 封顶；count < FUSE_AFTER 尚未熔断，返回 0。
 * ponytail: 纯算术无状态，天花板是「按错误类别分档退避」——真出现该需求
 * 时升级为 (kind → base) 映射表。
 */
export declare function fuseBackoffMs(count: number): number;
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
    /** 已警告过 agent.id ≠ session.id 的会话（宿主假设违反只告警一次）。 */
    private readonly idMismatchWarned;
    /** 进程级最近错误历史（20 条环形缓冲，/shadow-rewind/status 下发）。 */
    readonly errorLog: HostErrorLog;
    /** workspace → 熔断状态：连续失败计数与冷却截止时刻。 */
    private readonly fuses;
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
    /** 推进工作区熔断：连续 FUSE_AFTER 次失败进入退避冷却；「未熔断 → 熔断」
     * 的跳变沿记一条熔断公告（冷却期内每轮跳过不再逐条刷错误历史）。 */
    private advanceFuse;
}
