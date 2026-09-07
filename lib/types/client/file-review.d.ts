/**
 * 文件审查面，浏览器半边（自 dsh-file-review-tab 移植）：
 *
 * 1. 会话累计 live 条（conversation.input.dock）：文件变更读数 + 行内撤销
 *    + 「审查」入口（打开 AuditOverlay 全屏审查界面）；
 * 2. 文件审查全屏界面（AuditOverlay → FileReviewTab）：逐轮 diff +
 *    按 hunk / 按文件 / 按轮撤销 + 每轮快照恢复（原 better-sidebar tab 移除
 *    后的新家，外壳换成模态对话框）。
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
        /** 聊天侧 UI 面文案（live 条）。 */
        'file-review': DeliverablesKey;
    }
}
/**
 * 必需服务：会话快照、locale、remote 与槽位注册表（轮尾链）。conversation
 * Definition 注册表**刻意不做静态注入**，而是在 apply() 里动态解析：
 * conversation Definition 注册表的服务名随 dsh 版本迁移过（<= 0.1.1 是根
 * `conversationEvents`，0.1.2-alpha.1+ 是 `uiConversation.events`），硬注入
 * 任何一个名字都会让整个插件在另一个版本上永远「pending」并拖垮 web 启动
 * （issue #6）。
 */
export declare const fileReviewInject: string[];
/**
 * 客户端插件主体：挂 locale、装载 Typert remote、注册 live 条与文件提及。
 * @param ctx - 客户端根上下文。
 */
export declare function applyFileReview(ctx: Context): void;
