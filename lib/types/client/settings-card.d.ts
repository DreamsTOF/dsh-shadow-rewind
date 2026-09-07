import type { Context } from '@deepseek-ai/cordis';
/**
 * 宿主 ui-settings 包声明 `settings.plugin.item` keyed slot（按 settings
 * namespace 分发「插件配置」卡片），但该包不在插件 devDependencies 内——
 * 本地补 SlotMap 声明合并（kind/scope 按 recall 插件实测行为：keyed by
 * namespace、root 作用域）。运行时宿主有真声明，类型以本声明为准。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        'settings.plugin.item': {
            kind: 'keyed';
            scope: 'root';
            keyProps: {
                readonly [namespace: string]: object;
            };
        };
    }
}
/** 设置卡片挂载：settings.plugin.item keyed slot，key 必须与 Host 端
 * settings namespace 一致（卡片只渲染「Host 服务的 namespace」与「slot
 * 注册的卡片」的交集）。 */
export declare function settingsApply(ctx: Context): void;
