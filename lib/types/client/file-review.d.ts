/**
 * 文件审查面，浏览器半边（自 dsh-file-review-tab 移植）：在**同一套产出文件
 * 词汇**上共存的两块 UI——
 *
 * 1. 聊天轮尾行（原始 dsh-file-review 卡片：「已编辑 N 个文件 · +M -K /
 *    撤销 / 审查」），注册在 `conversation.chat.turnTail` 链的 priority -2，
 *    以便**先于** dsh-better-sidebar 自己的 -1 拦截行认领链（链的选举规则是
 *    先到先得：任一时刻只有一行渲染，绝不两行并现）；
 * 2. `file-review` better-sidebar tab（按会话的变更列表 + 行级红/绿 diff +
 *    按 hunk / 按文件 / 按轮撤销，外加按轮做 jj 快照恢复）。
 *
 * 宿主半边的撤销 / 重做能力经本包的 Typert 远端贡献抵达两个面，装配方式与
 * dsh-file-review 完全一致。每一处注册都包在 `ctx.effect` 里，fiber 销毁
 * （HMR / 插件禁用）即干净注销。由合并后的客户端入口（index.tsx）与 rewind
 * 面一同挂载。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type DeliverablesKey } from './chat-locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** 轮尾行文案（聊天侧的 UI 面）。 */
        'file-review': DeliverablesKey;
    }
}
/**
 * 必需服务：会话快照、locale、remote 与槽位注册表（轮尾链）。另外两个服务
 * **刻意不做静态注入**，而是在 apply() 里动态解析：conversation Definition
 * 注册表的服务名随 dsh 版本迁移过（<= 0.1.1 是根 `conversationEvents`，
 * 0.1.2-alpha.1+ 是 `uiConversation.events`），硬注入任何一个名字都会让整个
 * 插件在另一个版本上永远「pending」并拖垮 web 启动（issue #6）；而
 * `betterSidebar` 只由**可选**的 dsh-better-sidebar 插件提供——硬注入会让本
 * 插件在没装它的宿主上永远等待，而 rewind / live 条 / 轮尾行这些面都能
 * 独立工作。
 */
export declare const fileReviewInject: string[];
/**
 * 客户端插件主体：挂 locale、装载 Typert remote、注册聊天轮尾行与侧边栏 tab。
 * @param ctx - 客户端根上下文。
 */
export declare function applyFileReview(ctx: Context): void;
