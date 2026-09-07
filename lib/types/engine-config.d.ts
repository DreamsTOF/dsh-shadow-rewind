/**
 * 核心引擎·配置解析。
 *
 * ShadowRewindConfig（用户输入）→ ResolvedShadowRewindConfig（全部字段落定）
 * 的唯一入口 {@link resolveConfig}：非法值直接抛 INVALID_CONFIG——宁可拒绝
 * 启动也不带病运行。默认排除清单与各项上限常量也归档于此。
 *
 * 配置优先级（吸收自 dsh-recall-plugin，ABSORB-RECALL 1.1/1.4）：
 *   env（DSH_SHADOW_REWIND_*，最高优先，设置卡片锁定不可编辑）
 *   → 用户配置（cordis.patch.yml insert 行 config 键 / 设置卡片写入）
 *   → DEFAULTS（出厂默认，单一事实源：设置卡片 schema 与重置路径共用，
 *     避免重置与 schema 漂移）。
 * env 值非法时静默回退下一优先级（与 recall 的 pickNumber 一致——env 填错
 * 不该让插件拒绝启动）；用户配置非法仍然 throw（宁可拒绝启动也不带病运行）。
 */
import type { ResolvedShadowRewindConfig, ShadowRewindConfig } from './types.js';
/** 默认排除清单：VCS 目录、依赖、构建产物与常见缓存（自用取向：宁多勿漏）。 */
export declare const DEFAULT_EXCLUDES: readonly string[];
/** 各配置项的出厂默认值（全部经 resolveConfig 校验）。设置卡片 schema、
 * config-reset 兜底与本文件共用这一份——默认值只此一处。 */
export declare const CONFIG_DEFAULTS: {
    readonly maxRestorePoints: 50;
    readonly maxTurnCheckpointsPerSession: 30;
    readonly maxFiles: 20000;
    readonly maxFileBytes: number;
    readonly maxSnapshotBytes: number;
    readonly planTtlMs: number;
    readonly turnCheckpointMode: "jj";
    readonly turnCheckpointTimeoutMs: 5000;
    readonly turnCheckpointMaxNewBytes: number;
    readonly turnCheckpointTrust: "fast";
};
/** env 变量名前缀：DSH_SHADOW_REWIND_<字段大写蛇形>。 */
export declare const ENV_PREFIX = "DSH_SHADOW_REWIND_";
/**
 * 各字段的 env 覆盖现状（config-get 端点的 envLocks 依据：设了 env 的字段
 * 在设置卡片锁定不可编辑——改了也会被 env 压住，锁死比静默失效诚实）。
 */
export declare function configEnvLocks(): Record<string, boolean>;
/** 解析配置：全部字段落定；非法值直接抛错（宁可拒绝启动也不带病运行）。 */
export declare function resolveConfig(config: ShadowRewindConfig): ResolvedShadowRewindConfig;
export { CONFIG_DEFAULTS as DEFAULTS };
