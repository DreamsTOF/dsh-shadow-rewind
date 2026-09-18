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
/**
 * 会话累计的一条变更（服务端按检查点算好的净变化）：同一路径跨多轮时，
 * prev 侧是最早触碰轮的轮起检查点、next 侧是最后一次触碰的轮末（或 'live'）。
 * live 条的会话累计视图只消费这一份——不再跨轮拼接工具 hunks 与 fs 占位。
 */
export interface FsCumulativeChange extends FsAttributionFields {
    readonly path: string;
    readonly kind: 'added' | 'modified' | 'deleted';
    readonly added?: number;
    readonly removed?: number;
    readonly oldMode?: number;
    readonly newMode?: number;
    readonly dir?: boolean;
    readonly checkpointId: string;
    readonly nextCheckpointId: string;
    /** 最早触碰轮的 turn/start seq（回滚遮蔽基准）。 */
    readonly turnStartSeq: number;
    /** 触碰过该路径的轮号（升序，信息展示用）。 */
    readonly turns: readonly number[];
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
    /** 会话累计净变化（live 条的唯一数据源；旧宿主缺省 = 空）。 */
    readonly cumulative: readonly FsCumulativeChange[];
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
/** 读某会话的累计净变化（未 warm 时为空；live 条按订阅在 warm 后重渲染）。 */
export declare function cachedCumulativeForSession(sessionId: string): readonly FsCumulativeChange[];
/** 订阅缓存刷新（卡片据此重新推导自己的 fs 条目）。 */
export declare function subscribeFsCache(listener: () => void): () => void;
/**
 * 把某个会话的 fs-changes 预热进缓存（节流 + 发后不理）。
 * 热路径调用是安全的：徽标渲染、快照订阅都可以随手调一次。
 * rev 未变时（同构建宿主必带）直接跳过解析、缓存写入与通知——warm 的正确性
 * 不再依赖 JSON 深比较；rev 缺省（旧宿主）回退到逐条 JSON 比较。
 */
export declare function warmFsChanges(sessionId: string): void;
/**
 * 强制刷新某会话的 fs 缓存：绕过 2s 节流，立即重新 warm（供「文件恢复 / 撤销」
 * 这类确定性磁盘变化事件调用——常规 warm 的节流可能让它们被吞掉，审计面板与
 * live 条的 fs 行数停留在恢复前）。in-flight 去重仍生效（同刻并发调用只拉一次）。
 */
export declare function forceWarmFsChanges(sessionId: string): void;
/** 按「会话 + 轮」同步读取（live 条的查找键；缓存条目都带 sessionId）。 */
export declare function cachedFsTurnForSessionTurn(sessionId: string, turn: number): FsChangeTurn | undefined;
/** 某会话缓存的全部 fs 轮条目（按轮升序；live 条的会话累计视图用）。 */
export declare function cachedFsTurnsForSession(sessionId: string): readonly FsChangeTurn[];
/**
 * 一个 fs 条目的占位形态：零全文、带服务端行数。卡片/侧边栏/live 条先用它
 * 渲染行与 +/−，内容在悬停、展开或撤销时经 ensureFsFileDiff 按需补齐。
 * 审计面板（FileReviewTab）需要「全量 + 归因徽标」的变体，故底层共用
 * {@link fsTurnPlaceholders}，这里只施加「本会话写盘」过滤。
 */
export declare function fsTurnReviews(fsTurn: FsChangeTurn, 
/** 可选的条目级过滤（回滚遮蔽按轮近似剔除已恢复的写盘）。 */
keep?: (change: FsChange) => boolean): readonly ProducedFileReview[];
/**
 * 一个 fs 轮的占位条目构造（单一实现）：
 *  - `keep`：条目级过滤（live 条用它只保留本会话写盘；审计传 undefined=全量）；
 *  - `attribution`：带上归属徽标字段（owner，审计面板需要展示他会话/歧义归属；
 *    live 条不需要）。
 */
export declare function fsTurnPlaceholders(fsTurn: FsChangeTurn, options?: {
    readonly keep?: (change: FsChange) => boolean;
    readonly attribution?: boolean;
}): readonly SessionFileChange[];
/**
 * 取一个 fs 条目的完整全文条目（撤销/展示 diff 用）。同一 (turn, path) 的
 * 并发与后续调用复用同一个请求；该轮缓存条目被 warm 替换时记忆自动失效
 * （live 条的磁盘内容会随回合推进而变化，绝不能跨更新复用）。
 */
export declare function ensureFsFileDiff(fsTurn: FsChangeTurn, path: string, cwd: string): Promise<SessionFileChange | null>;
/**
 * 取一条会话累计条目的完整全文（悬停浮层 / 行内撤销 / 打开 diff 前补齐）。
 * 记忆键 = 最早检查点 + 终点检查点 + 路径——同一净变化的并发与后续调用复用
 * 同一个请求；warm 换代会话时记忆随缓存条目变化失效。
 */
export declare function ensureCumulativeFileDiff(item: FsCumulativeChange, cwd: string): Promise<SessionFileChange | null>;
/**
 * 把一轮的文件系统变更转成带完整 diff 的 TurnFileChanges。
 * 保留给「确知需要整轮全文」的调用方（如恢复对话框窗口统计）；常规渲染
 * 走 fsTurnReviews + ensureFsFileDiff，避免无谓的全文 HTTP。
 */
export declare function convertFsTurnToFiles(fsTurn: FsChangeTurn, cwd: string): Promise<TurnFileChanges | null>;
