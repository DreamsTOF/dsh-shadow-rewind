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
    readonly startedAt: number;
    readonly endedAt: number;
}
export interface CommandWindowRegistryDeps {
    /** 工作区 key 规范化（realpath）；失败返回 undefined（静默跳过）。 */
    readonly canonicalDirectory: (path: string) => Promise<string | undefined>;
}
/** 纯内存命令窗口注册表（见模块注释的天花板与升级路径）。 */
export declare class CommandWindowRegistry {
    private readonly deps;
    /** 规范化工作区 key → 按时间顺序的窗口列表。 */
    private readonly windows;
    private readonly keyMemo;
    constructor(deps: CommandWindowRegistryDeps);
    /** 记录一个已闭合的窗口（顺带修剪：过期条目 + 超量保留最新）。 */
    record(cwd: string, window: CommandWindow): Promise<void>;
    /** 与 [startMs, endMs]（闭区间）相交的全部窗口，按记录顺序。 */
    windowsOverlapping(cwd: string, startMs: number, endMs: number): Promise<readonly CommandWindow[]>;
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
