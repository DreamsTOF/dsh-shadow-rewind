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
