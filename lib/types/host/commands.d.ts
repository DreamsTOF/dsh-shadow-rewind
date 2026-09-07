/**
 * 宿主适配层·headless 命令面（A4，借鉴 dsh-checkpoint-diff 的 /diff、/rollback）。
 *
 * dsh 0.1.2 的命令系统是 cordis 服务 `commands`（CommandRuntime.register），
 * 命令不产生模型消息，结果由 UI 直接渲染——脚本与 CLI 也能消费。
 *
 * 提供两个命令：
 *  - /shadow-diff：两个时间节点（轮号 / 检查点 id / trace 序号）之间的变更摘要；
 *  - /shadow-undo：撤销该工作区最近一次文件恢复。
 *
 * 命令服务缺失的宿主上注册静默跳过（`ctx.commands?`），不 pending。
 */
import type { ShadowRewindEngine } from '../engine.js';
import type { AgentFace } from './types.js';
/** 命令注册面（结构类型；`commands` 服务缺失时注册静默跳过，不 pending）。 */
export interface ShadowRewindCommandsHost {
    readonly commands?: {
        register(definition: {
            readonly name: string;
            readonly description: string;
            readonly input?: {
                readonly hint: string;
            };
            readonly handler: (invocation: ShadowRewindCommandInvocation) => Promise<ShadowRewindCommandResult> | ShadowRewindCommandResult;
        }): () => void;
    };
}
export interface ShadowRewindCommandInvocation {
    readonly agent: AgentFace;
    readonly rawInput: string;
    readonly signal?: AbortSignal;
}
export interface ShadowRewindCommandResult {
    readonly kind: 'success' | 'error';
    readonly text: string;
}
/** 注册 headless 命令：/shadow-diff（区间 diff 摘要）与 /shadow-undo（撤销最近一次恢复）。 */
export declare function installShadowRewindCommands(ctx: ShadowRewindCommandsHost, engine: ShadowRewindEngine): void;
