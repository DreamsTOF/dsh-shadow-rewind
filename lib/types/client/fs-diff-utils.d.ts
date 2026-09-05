/**
 * 文件系统级变更（由检查点对比发现的 PowerShell / 终端写盘）的 diff 工具层。
 *
 * **归属语义**：第 N 轮的文件系统变更 = diff(第 N 轮的轮起检查点, 第 N+1 轮
 * 的轮起检查点)——第 N+1 轮第一步之前的捕获，就是第 N 轮轮末的树状态。宿主
 * 的 `/shadow-rewind/fs-changes` 端点已经做好了这层配对（外加一条把最新检查
 * 点与当前磁盘相比的 live-tail 条目）。
 *
 * **计数先行、全文按需**：同一次构建里宿主任顺便把每条变更的增/删行数算好，
 * 客户端因此能**零全文请求**渲染文件行与统计条；完整内容挂在按
 * (轮 × 路径) 的懒加载层上——只有真正要展示 diff 或执行撤销时才去拉
 * （悬停浮层、展开行、撤销提交），并记忆化到该轮缓存条目变化为止（warm
 * 替换会让该轮记忆失效）。
 */
import type { ProducedFileReview } from '../file-review/change-types.ts';
import type { FsAttributionFields, TurnFileChanges, SessionFileChange } from './session-changes.ts';
/** One fs-level change; added/removed 是服务端预算好的行数（缺省 = 旧宿主）。 */
export interface FsChange extends FsAttributionFields {
    readonly path: string;
    readonly kind: 'added' | 'modified' | 'deleted';
    readonly added?: number;
    readonly removed?: number;
    /** 检查点记录的两侧权限位（透传给宿主，写回时恢复）。 */
    readonly oldMode?: number;
    readonly newMode?: number;
    /** 空目录条目：撤销语义是 mkdir/rmdir，无全文。 */
    readonly dir?: boolean;
}
/** 归因字段投影（占位/补齐/提交各构造点共用）：全缺省时返回空对象。 */
export declare function fsAttributionOf(source: FsAttributionFields): FsAttributionFields;
/** `/shadow-rewind/fs-changes` 返回的一轮文件系统变更。 */
export interface FsChangeTurn {
    readonly turn: number;
    /** turn/start 事件 seq——每会话每轮唯一，正是缓存键。 */
    readonly turnStartSeq: number;
    readonly checkpointId: string;
    /** 下一轮的检查点 id，或 'live'（= 与当前磁盘相比）。 */
    readonly nextCheckpointId: string;
    readonly live?: boolean;
    /** 条目进入模块缓存时才带上（warm 知道会话）。 */
    readonly sessionId?: string;
    readonly changes: readonly FsChange[];
}
/** /shadow-rewind/fs-changes 响应（含数据版本 rev，见 warmFsChanges）。 */
export interface FsChangesPayload {
    readonly turns: readonly FsChangeTurn[];
    /** 工作区数据版本：检查点捕获/恢复成功即递增；缺省 = 旧宿主。 */
    readonly rev?: number;
}
/**
 * 经 HTTP 按检查点读取文件内容。找不到或判定为二进制（NUL 字节守卫）时返回
 * null——调用方一律把 null 当作「全文不可得」，而不是空文件。
 */
export declare function fetchCheckpointFileContent(checkpointId: string, path: string, cwd: string): Promise<string | null>;
/**
 * 从批量端点拉取所有轮次的文件系统变更。
 * 宽松解析：未知 / 缺失字段一律降级（条目丢了就丢了），绝不因一个坏字段
 * 让整个审查面白屏。
 */
export declare function fetchAllFsChanges(sessionId: string): Promise<FsChangesPayload>;
/** 订阅缓存刷新（卡片据此重新推导自己的 fs 条目）。 */
export declare function subscribeFsCache(listener: () => void): () => void;
/** 供轮尾 select() 同步读取的入口：这一轮有 fs 变更吗？ */
export declare function cachedFsTurnFor(turnStartSeq: number): FsChangeTurn | undefined;
/**
 * 把某个会话的 fs-changes 预热进缓存（节流 + 发后不理）。
 * 热路径调用是安全的：徽标渲染、快照订阅都可以随手调一次。
 * rev 未变时（同构建宿主必带）直接跳过解析、缓存写入与通知——warm 的正确性
 * 不再依赖 JSON 深比较；rev 缺省（旧宿主）回退到逐条 JSON 比较。
 */
export declare function warmFsChanges(sessionId: string): void;
/** 按「会话 + 轮」同步读取（live 条的查找键；缓存条目都带 sessionId）。 */
export declare function cachedFsTurnForSessionTurn(sessionId: string, turn: number): FsChangeTurn | undefined;
/**
 * 一个 fs 条目的占位形态：零全文、带服务端行数。卡片/侧边栏/live 条先用它
 * 渲染行与 +/−，内容在悬停、展开或撤销时经 ensureFsFileDiff 按需补齐。
 */
export declare function fsTurnReviews(fsTurn: FsChangeTurn): readonly ProducedFileReview[];
/**
 * 取一个 fs 条目的完整全文条目（撤销/展示 diff 用）。同一 (turn, path) 的
 * 并发与后续调用复用同一个请求；该轮缓存条目被 warm 替换时记忆自动失效
 * （live 条的磁盘内容会随回合推进而变化，绝不能跨更新复用）。
 */
export declare function ensureFsFileDiff(fsTurn: FsChangeTurn, path: string, cwd: string): Promise<SessionFileChange | null>;
/**
 * 把一轮的文件系统变更转成带完整 diff 的 TurnFileChanges。
 * 保留给「确知需要整轮全文」的调用方（如恢复对话框窗口统计）；常规渲染
 * 走 fsTurnReviews + ensureFsFileDiff，避免无谓的全文 HTTP。
 */
export declare function convertFsTurnToFiles(fsTurn: FsChangeTurn, cwd: string): Promise<TurnFileChanges | null>;
