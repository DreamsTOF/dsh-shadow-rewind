/**
 * 宿主适配层·fs-changes 的服务端计算：行数统计 + 轮配对 diff + 窗口归属。
 *
 * 轮次配对与 live-tail 的两侧内容宿主本来就持有（检查点 blob / live 扫描读
 * 盘），在服务端把 added/removed 算好随响应下发——过去客户端为渲染 +/− 要
 * 把每个文件的新旧全文各拉一遍，一轮 30 个文件就是 60 个请求。
 *
 * 本文件的共享助手 {@link computeTurnFsChanges} 同时服务两个端点
 * （/shadow-rewind 预览与 /shadow-rewind/fs-changes），配对轮与 live-tail
 * 不再各持一份拷贝。
 */
import type { ShadowRewindEngine } from '../engine.js';
import type { TurnIntent } from '../types.js';
import type { RewindHttpDeps } from './types.js';
/** 单次 fs-changes 请求的行数统计预算（按变更条数计）：超出后剩余变更不带行数。 */
export declare const DIFF_COUNT_BUDGET = 600;
/** 往返校验解码：非 UTF-8 内容按「统计不可得」处理（返回 null），绝不猜着算。 */
export declare function decodeUtf8(bytes: Buffer): string | null;
/** 有界并发执行：保持结果与 tasks 输入同序，任意失败照常上抛。 */
export declare function runLimited<T>(tasks: readonly (() => Promise<T>)[], limit: number): Promise<T[]>;
/** LF 计行：空串 0 行；最后一个换行后无内容不虚增一行。 */
export declare function countLines(text: string): number;
/** 行数按 LF 规范化统计：CRLF 文件不会产生幽灵增删。 */
export declare function lineCounts(before: string, after: string): {
    added: number;
    removed: number;
};
/** 「读当前磁盘」的唯一实现（K8 归一：/file?checkpointId=live 与
 * readChangeSide 此前是两份围栏各异的拷贝）。返回 null = 不可得
 * （不在工作区内 / 软链接 / 缺失 / 读取失败），调用方按各自语义呈现。 */
export declare function readLiveFile(cwd: string, path: string): Promise<Buffer | null>;
/** 读变更单侧内容：checkpointId 或 'live'（当前磁盘，围栏同 /file 端点）。 */
export declare function readChangeSide(engine: ShadowRewindEngine, cwd: string, sourceId: string, path: string): Promise<Buffer | null>;
/** 端点变更条目：path/kind + 服务端预算行数 + 检查点权限位 + 目录标记。
 * oldMode/newMode 供客户端透传给宿主撤销（写回时恢复权限位）；
 * dir 条目的撤销语义是 mkdir/rmdir，不产生行数。
 * owner/autoSelect 为检查点窗口网格归属（勾选清单的建议标签）。 */
export interface FsChangeItem {
    path: string;
    kind: 'added' | 'modified' | 'deleted';
    added?: number;
    removed?: number;
    oldMode?: number;
    newMode?: number;
    dir?: true;
    /** serializeOwner 形态：'target' | 'multi' | 'unknown' | <sessionId>。 */
    owner?: string;
    /** 回滚勾选清单默认值：仅归属本会话为 true。 */
    autoSelect?: boolean;
}
/** 一轮的文件系统变更条目（配对轮与 live-tail 同形）。 */
export interface TurnFsChange {
    readonly turn: number;
    readonly turnStartSeq: number;
    readonly checkpointId: string;
    readonly nextCheckpointId: string;
    readonly live?: true;
    /** 本轮内容型工具调用摘要（轮末检查点的 intent；live 轮从会话事件即时采集）。 */
    readonly intent?: readonly TurnIntent[];
    /** 检查点快照内容抽样不可读（影子仓库丢失 / sqlite 受损等）：诚实标注。 */
    readonly degraded?: true;
    readonly changes: readonly FsChangeItem[];
}
/**
 * 共享配对助手：一轮的「检查点 diff + 窗口归属 + 行数预算」。轮配对
 * （diffCheckpoints）与 live-tail（inspect = 最后检查点 vs 当前磁盘）共用，
 * 两端点（/shadow-rewind 预览与 /shadow-rewind/fs-changes）不再各持一份拷贝。
 *
 * 归属行为：窗口内快照做网格归属（attributePaths），owner/autoSelect 随
 * 条目透出，作为勾选清单的建议标签。归属失败保守保留全部路径。
 *
 * 返回 undefined = 结构性跳过（无 sessionId / 无配对终点）或对比失败
 * （已记警告）；空 changes 数组原样返回，由调用方决定是否透出。
 */
export declare function computeTurnFsChanges(engine: ShadowRewindEngine, deps: Pick<RewindHttpDeps, 'logger'>, options: {
    readonly cwd: string;
    readonly current: {
        readonly id: string;
        readonly sessionId?: string;
        readonly createdAt: number;
        readonly turn: number;
        readonly turnStartSeq: number;
    };
    /** 归属终点：优先同轮轮末检查点（精确轮末树），回退下一轮轮起（旧语义）。 */
    readonly pairEnd?: {
        readonly id: string;
        readonly createdAt: number;
    };
    /** 本轮意图摘要（配对轮取轮末检查点 manifest；live 轮由调用方从会话事件采集）。 */
    readonly intent?: readonly TurnIntent[];
    /** live-tail：无配对终点，对比源是当前磁盘。 */
    readonly live?: boolean;
    readonly countBudget: {
        remaining: number;
    };
}): Promise<TurnFsChange | undefined>;
/** 并行只读探测检查点内容可读性；返回「不可读」的 id 集合（探测失败也算不可读）。 */
export declare function probeUnreadableCheckpoints(engine: ShadowRewindEngine, cwd: string, ids: ReadonlySet<string>): Promise<Set<string>>;
