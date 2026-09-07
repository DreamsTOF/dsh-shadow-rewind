/**
 * 文件审查侧栏 tab·共享类型与纯工具。
 *
 * FileReviewTab.tsx 及其对话框子组件共用的入参/状态形状与无副作用助手。
 * 只做形状定义与纯计算，不持 React 状态、不发请求——组件与本文件单向依赖。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
import type { FileReviewRequest, FileReviewResult, RecordedRequest, RecordedResult } from '../file-review/change-types.ts';
import { type FsAttributionFields, type SessionFileChange } from './session-changes.ts';
import type { UnifiedDiffStats } from './UnifiedDiff.tsx';
/** 页内通知气泡的成功停留时长（自动消失）。 */
export declare const SUCCESS_NOTICE_DURATION = 3000;
/** 页内通知气泡的失败停留时长（自动消失）。 */
export declare const ERROR_NOTICE_DURATION = 8000;
/** Tab 组件入参（better-sidebar 的 TabComponentProps 的收窄版）。 */
export interface FileReviewTabProps {
    readonly ctx: Context;
    readonly sessionId: string;
    readonly cwd: string | undefined;
    /** 活跃 tab + 面板已打开；为 false 时暂停实时状态巡检。 */
    readonly visible: boolean;
    /**
     * 侧边栏 tab 句柄。`meta.expandPaths`（string[]）就是聊天轮尾行经
     * updateTab / openTab 写入的深链：一份**新的** meta 引用会被重放成「展开
     * 这些文件的 diff 并滚到第一个」。
     */
    readonly tab: {
        readonly meta?: unknown;
    };
}
/** 本 tab 用到的 fileReview 远端方法面。 */
export interface FileReviewRemote {
    status(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>;
    apply(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>;
    recorded(request: RecordedRequest): Promise<RemoteResult<RecordedResult>>;
}
/** 页内通知气泡（成功/失败短暂停留后自动消失）。 */
export interface Notice {
    readonly seq: number;
    readonly tone: 'success' | 'error';
    readonly text: string;
}
/** 摊平后的 (轮, 文件) 变更单元，用于状态巡检与开关请求。 */
export interface FlatChange extends FsAttributionFields {
    readonly turn: number;
    readonly path: string;
    readonly diffs: SessionFileChange['diffs'];
    /** fs 删除条目（检查点对比 kind='deleted'）：展示为全红，撤销=写回旧内容。 */
    readonly deleted?: true;
    /** 条目来源：'fs' = 检查点对比派生（终端写盘）；缺省 = 工具结果视图。 */
    readonly origin?: 'fs';
    /** 空目录条目：提交时转成 dirKind，宿主走 mkdir/rmdir 语义。 */
    readonly dir?: true;
    /** 服务端预算的行数（fs 条目懒加载全文前的显示用）。 */
    readonly counts?: {
        readonly added: number;
        readonly removed: number;
    };
}
/** 一个 (轮, 文件) 变更组的状态映射键。 */
export declare function stateKey(turn: number, path: string): string;
/** fs 条目的归属徽标文案：旧宿主无归属（owner 缺省）→ 无徽标。
 * 他会话展示会话标题；多主/未知如实标注。 */
export declare function fsOwnerBadge(file: SessionFileChange, sessionTitle: (id: string) => string | undefined): string | null;
/** 深链的滚动目标：整轮链接滚到轮组，否则滚到文件行。 */
export interface PendingScroll {
    /** 文件行的 stateKey：既是精确目标，也是所在节的回退目标。 */
    readonly rowKey: string;
    /** 多文件链接时，其轮组的轮号——该轮组顶到视口顶部。 */
    readonly turn: number | null;
}
/** 一个文件在本会话某轮的改动记录（文件级时间线节点；按轮升序累积）。 */
export interface FileTurnEntry {
    readonly turn: number;
    readonly live: boolean;
    readonly deleted?: true;
    readonly diffs: SessionFileChange['diffs'];
    /** 服务端预算的行数（fs 条目懒加载全文前的显示用）。 */
    readonly counts?: {
        readonly added: number;
        readonly removed: number;
    };
}
/** 恢复窗口内一个路径的累计统计与最近改动轮次（恢复对话框 +/− 跳转用）。 */
export interface PathWindowStats {
    readonly stats: UnifiedDiffStats;
    readonly latestTurn: number;
}
/** 一组变更只有在 hunks 完整可逆时才判定为可撤销。
 * H1 归一：条件集收敛到 session-changes.reversibleOf（卡片与侧栏共用）。 */
export declare function isReversible(file: SessionFileChange): boolean;
/** 统计累加（轮组/总头部把各文件 +/− 汇总用）。 */
export declare function addStats(left: UnifiedDiffStats, right: UnifiedDiffStats): UnifiedDiffStats;
