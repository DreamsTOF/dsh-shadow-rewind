/**
 * 宿主适配层·插件配置卡片的 schema 单一事实源。
 *
 * Config schema 同时承担两个角色（吸收自 dsh-recall-plugin，ABSORB-RECALL
 * 1.1）：settings namespace「shadow-rewind」的注册 schema（设置卡片据此
 * 渲染与校验）与 config-set 的字段白名单依据；默认值统一引用
 * engine-config.ts 的 CONFIG_DEFAULTS——默认值只此一份，避免重置与 schema
 * 漂移。
 *
 * @deepseek-ai/schemastery 运行时经宿主 node_modules 动态解析（见
 * types/host-modules.d.ts 的说明）：解析失败返回 null，设置卡片降级缺席
 * （config-get 仍可用，writable=false），插件其余功能不受影响。
 */
import { configEnvLocks } from '../engine-config.js';
import type { ShadowRewindConfig } from '../types.js';
/** schemasty schema 的最小结构面（运行时来自宿主解析的真实现）。 */
export interface SchemaLike {
    (value: unknown): unknown;
}
interface Chainable {
    default(value: unknown): Chainable;
    description(text: string): Chainable;
}
interface SchemaModule {
    object(properties: Record<string, unknown>): unknown;
    number(): Chainable;
    boolean(): Chainable;
    string(): Chainable;
    array(items: unknown): Chainable;
}
/** 动态加载宿主提供的 schemasty；不可用返回 null（设置卡片降级缺席）。 */
export declare function loadSchemastery(): Promise<SchemaModule | null>;
/** 构造 settings namespace 注册 schema；schemasty 不可用时返回 null。 */
export declare function createConfigSchema(): Promise<unknown>;
/** 清洗设置卡片提交的补丁：白名单字段 + 类型收敛 + 正整数校验。
 * 返回 null 表示补丁为空；抛出 Error 表示字段非法（消息面向 UI）。 */
export declare function cleanConfigPatch(patch: Record<string, unknown>): Partial<ShadowRewindConfig>;
export { configEnvLocks };
