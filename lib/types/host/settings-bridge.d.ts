/**
 * 宿主适配层·settings namespace 桥（设置页「插件配置」分区接入）。
 *
 * 注册 namespace「shadow-rewind」，把用户在设置卡片写入的配置经 watch
 * 热更新进运行中引擎（engine.applyConfigPatch），无需重启。分支依据是
 * 运行时注入实例的实际 API 而非静态包版本（吸收自 dsh-recall-plugin，
 * ABSORB-RECALL 1.2——插件 node_modules 固定最新、旧宿主注入旧实例）：
 *  1. dsh-settings 包的独立函数 installSettingsSection（≤0.1.2-alpha.1）；
 *  2. settings 服务方法 installSection（0.1.2-alpha.2+，官方插件同款）；
 *  3. settings 服务 register 核心 API（0.1.1-rc.2 及以前，手动复刻接线）。
 * 全部不可用（schemasty / dsh-settings / settings 服务任一缺席）时降级：
 * 设置卡片缺席、config 端点 writable=false，插件其余功能不受影响。
 */
import type { ShadowRewindEngine } from '../engine.js';
import type { SettingsServiceLike } from './types.js';
/** settings namespace：client 侧 settings.plugin.item slot 的 key 必须一致。 */
export declare const SETTINGS_NAMESPACE = "shadow-rewind";
/** config 端点对 settings 用户层的读写面（全部容错：不可用即降级）。 */
export interface SettingsBridge {
    /** 用户已覆盖的字段文档（describe().user）；不可用返回 {}。 */
    overridden(): Record<string, unknown>;
    /** 用户层是否可写（settings 服务在位且未声明只读）。 */
    writable(): boolean;
    /** 写用户层补丁；watch 链路随后热更新进引擎。 */
    update(patch: Record<string, unknown>): Promise<void>;
    /** 重置用户层为默认（优先官方 replace，老版本降级 update 反写 DEFAULTS）。 */
    reset(defaults: Record<string, unknown>): Promise<void>;
}
/** 装配 settings namespace。返回 config 端点使用的读写桥（永不抛错）。 */
export declare function installSettingsNamespace(ctx: {
    inject(names: readonly string[], fn: (scope: {
        settings?: SettingsServiceLike;
    }) => void): void;
    logger: {
        warn(message: string): void;
    };
}, engine: ShadowRewindEngine, onError: (message: string) => void): Promise<SettingsBridge>;
