import type { GateAgentFace } from './write-gate.js';
/** 一次工具调用的执行墙钟窗口（归因单元）。 */
export interface CommandWindow {
    /** 调用所属的顶层会话 id（子代理已沿谱系上溯解析）。 */
    readonly sessionId: string;
    /** 实际发起调用的 agent id（可能是子代理）。 */
    readonly agentId: string;
    readonly tool: string;
    /** 防御性记录（供未来定位到具体调用）；归因正确性不依赖它。 */
    readonly callId?: string;
    /** 工具参数的截断序列化（如终端命令文本）；纯展示线索，归因不依赖它。 */
    readonly detail?: string;
    readonly startedAt: number;
    readonly endedAt: number;
}
/** 注册表可调参数的缺省值（单一事实源；插件配置解析从这里取默认）。 */
export declare const COMMAND_WINDOW_DEFAULTS: {
    /** 落盘防抖（毫秒）；工具调用成簇到达，与 file-review 录制同量级。 */
    readonly flushMs: 400;
    /** 保留期：超出即修剪（归因查询只跨检查点窗口，6h 足够宽裕）。 */
    readonly retentionMs: number;
    /** 每工作区条目上限：高频短命令下的防泄漏阀（修剪保留最新）。 */
    readonly maxPerWorkspace: 2000;
    /** 单窗口记录的工具参数序列化字节上限；0 = 不记录内容。 */
    readonly detailBytes: 2048;
};
export interface CommandWindowRegistryDeps {
    /** 工作区 key 规范化（realpath）；失败返回 undefined（静默跳过）。 */
    readonly canonicalDirectory: (path: string) => Promise<string | undefined>;
    /** 持久化根目录（shadow-rewind 存储根）；缺省/空串时保持纯内存（不落盘）。 */
    readonly storageDir?: string;
    /** 落盘防抖（毫秒）；缺省走 COMMAND_WINDOW_DEFAULTS.flushMs。 */
    readonly flushMs?: number;
    /** 窗口保留期（毫秒），超出即修剪；缺省走 COMMAND_WINDOW_DEFAULTS.retentionMs。 */
    readonly retentionMs?: number;
    /** 每工作区窗口上限（修剪保留最新）；缺省走 COMMAND_WINDOW_DEFAULTS.maxPerWorkspace。 */
    readonly maxPerWorkspace?: number;
    /** 单窗口记录的工具参数序列化字节上限；0 = 不记录内容；缺省走 COMMAND_WINDOW_DEFAULTS.detailBytes。 */
    readonly detailBytes?: number;
}
/** 命令窗口注册表（可选持久化，见模块注释；接口不因持久化而变）。 */
export declare class CommandWindowRegistry {
    private readonly deps;
    /** 规范化工作区 key → 按时间顺序的窗口列表。 */
    private readonly windows;
    private readonly keyMemo;
    /** 持久化目录；undefined = 纯内存。 */
    private readonly windowsDir;
    private readonly flushMs;
    private readonly retentionMs;
    private readonly maxWindows;
    private readonly detailBytes;
    /** 已完成懒加载的工作区（此后记录直写 windows 并调度落盘）。 */
    private readonly loaded;
    /** 进行中的懒加载任务（保证同 key 只读一次盘）。 */
    private readonly loading;
    /** 懒加载完成前到达的记录缓冲；加载完成后按「磁盘在前、缓冲在后」合并。 */
    private readonly preLoad;
    /** 每工作区的落盘防抖定时器（前沿触发，不重置）。 */
    private readonly flushTimers;
    /** 每工作区的串行化落盘链（防抖触发可能晚于前一次写入）。 */
    private readonly flushChains;
    constructor(deps: CommandWindowRegistryDeps);
    /** 把工具参数序列化为窗口内容（按 detailBytes 截断；0 = 不记录内容）。
     * 宿主契约保证参数 JSON 可序列化，仍防御性兜底：失败即无内容，绝不
     * 影响记录本身。截断可能切断多字节字符（解码器以替换符容错）。 */
    captureDetail(args: unknown): string | undefined;
    /** 记录一个已闭合的窗口（顺带修剪：过期条目 + 超量保留最新）。 */
    record(cwd: string, window: CommandWindow): Promise<void>;
    /** 与 [startMs, endMs]（闭区间）相交的全部窗口，按记录顺序。 */
    windowsOverlapping(cwd: string, startMs: number, endMs: number): Promise<readonly CommandWindow[]>;
    /** 立即冲刷未落盘的工作区（宿主关停时调用，防止防抖窗口内的记录随重启丢失）。 */
    flushPending(): Promise<void>;
    private pushWindow;
    private ensureLoaded;
    private loadFromDisk;
    private scheduleFlush;
    private chainFlush;
    private writeWindows;
    private keyFor;
}
/**
 * 解析调用所属的顶层会话：沿 parentSession 上溯到无父为止（深度上限与
 * 防环内置）。断链/环/超深时停在最深已声明祖先（header 指名的父会话，
 * 即使它已不可解析）——归因宁模糊不错，绝不把子代理误当顶层会话。
 */
export declare function topLevelSessionOf(agent: GateAgentFace, sessions: {
    get(sessionId: string): GateAgentFace | undefined;
} | undefined): string;
/**
 * 在宿主上下文装配命令窗口录制器：`tools/execute` around-dispatch 瀑布包住
 * `next()` 打起止戳——该瀑布的终端即工具体本身，测得的是体的真实墙钟
 * （`tools/pre-execute` 阶段体尚未运行，测时只能挂这里）；装配模式与写入闸
 * 的 installWriteGateHost 相同。被闸拒绝的调用在 prepare 阶段终止、从不进入
 * dispatch，自然不记录；裁决形检查是上游 around-dispatch 监听器以裁决短路
 * 代替执行的兜底。
 *
 * @param sessions - 惰性读取的会话查找面（注入完成前为 undefined，谱系
 * 上溯停止、子代理归于自身——与写入闸同一降级语义）。
 */
export declare function installCommandWindowRecorder(ctx: {
    effect(dispose: () => void, label?: string): void;
    on(event: string, listener: (exec: unknown, next: unknown) => unknown): () => void;
}, registry: CommandWindowRegistry, sessions?: () => {
    get(sessionId: string): GateAgentFace | undefined;
} | undefined): void;
