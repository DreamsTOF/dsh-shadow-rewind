/**
 * 对称模式的路径归因（纯函数）：把「目标检查点 vs 当前树」的每条变更归属
 * 到一段检查点窗口。检查点在回合开始时捕获，因此窗口 [S_j, S_{j+1}) 的
 * 写者就是 S_j 的会话——S0 是目标检查点本身（目标会话），S_j(j≥1) 是其后
 * 按时间升序的快照，最后一个窗口延伸到当前树。
 *
 * 归因只是预览里的建议标签：勾选权在用户，标签错了最多误导、不破坏数据
 * （组合 B 的安全性质）。同一窗口写者的裁决全部机器可查，无需工具可见性。
 */
import type { SnapshotEntry, WorkspaceChange } from './types.js';
export type PathOwner = {
    readonly kind: 'target';
} | {
    readonly kind: 'session';
    readonly sessionId: string;
} | {
    readonly kind: 'multi';
} | {
    readonly kind: 'unknown';
};
export interface PathAttribution {
    readonly owner: PathOwner;
    /** 对称模式勾选清单的默认值：只属于目标会话的路径。 */
    readonly autoSelect: boolean;
}
export declare function attributePaths(options: {
    readonly targetSessionId: string | undefined;
    readonly changes: readonly WorkspaceChange[];
    readonly snapshots: readonly {
        readonly sessionId?: string;
        readonly entries: Readonly<Record<string, SnapshotEntry | null>>;
    }[];
}): Map<string, PathAttribution>;
/** HTTP 序列化：'target' | 'multi' | 'unknown' | 具体会话 id。 */
export declare function serializeOwner(owner: PathOwner): string;
/** 终端写归因置信级：
 *  - `command`   —— mtime 恰落 1 条本会话命令窗口（命令级）；
 *  - `ambiguous` —— 多条窗口重叠无法定位，或双方改动无法区分（宁模糊不错）；
 *  - `external`  —— 无命令窗口命中、窗口归属回本会话（外部写入，声明的盲区）；
 *  - `window`    —— 窗口归属到其它会话（无命令信息）；
 *  - `unknown`   —— 无法归属。 */
export type FsAttributionKind = 'command' | 'ambiguous' | 'external' | 'window' | 'unknown';
/** 关联到的命令窗口（序列化进 fs-changes 响应）。 */
export interface FsCommandRef {
    readonly tool: string;
    readonly callId?: string;
    readonly sessionId: string;
    readonly startedAt: number;
    readonly endedAt: number;
}
/** 一条文件系统变更的完整归因（闸关时随响应透出）。 */
export interface FsAttribution {
    /** serializeOwner 形态：'target' | 'multi' | 'unknown' | <sessionId>。 */
    readonly owner: string;
    /** 回滚勾选清单默认值：仅归属本会话为 true。 */
    readonly autoSelect: boolean;
    readonly attribution: FsAttributionKind;
    readonly command?: FsCommandRef;
    /** 当前内容的写入时间（ms epoch，来自快照条目的 mtimeNs）。 */
    readonly writtenAt?: number;
}
/**
 * 终端写盘归因（纯函数 + 一次注册表查询）：在窗口归属（attributePaths 的
 * ownership）之上，用「文件 mtime ∈ 命令窗口 [startedAt, endedAt]」关联到
 * 具体命令。仅恰 1 条窗口覆盖才给命令级置信——宁模糊不错。
 * 包围轮盲区：完全包住本窗口的其它会话轮在快照网格里没有证据，其写入
 * 会被窗口归属误判为本会话；此时净值内容的 mtime 若落在其它会话的命令
 * 窗口，即为明确的他写者证据——降级 `multi` 交出勾选权（绝不以本会话
 * 名义默认勾选，见函数体注释）。
 *
 * @param windowStartMs/windowEndMs - 轮配对窗口 [current.createdAt, pairEnd.createdAt]，
 * 只做窗口查询剪枝；匹配本身以 mtime 为准（长命令跨轮不漏配）。
 */
export declare function attributeFsChanges(options: {
    readonly targetSessionId: string | undefined;
    readonly cwd: string;
    readonly changes: readonly WorkspaceChange[];
    readonly ownership: ReadonlyMap<string, PathAttribution>;
    readonly windowStartMs: number;
    readonly windowEndMs: number;
    readonly commandWindows?: {
        windowsOverlapping(cwd: string, startMs: number, endMs: number): Promise<readonly {
            readonly sessionId: string;
            readonly tool: string;
            readonly callId?: string;
            readonly startedAt: number;
            readonly endedAt: number;
        }[]>;
    };
}): Promise<Map<string, FsAttribution>>;
