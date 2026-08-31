/**
 * dsh-shadow-rewind —— 浏览器半边融合入口，两个共存的 UI 面挂同一个
 * 插件 id（dsh-shadow-rewind）之下：
 *
 * 1. 会话回退面（rewind.ts）：每条直发用户消息旁的「恢复到发送之前」按钮、
 *    恢复预览对话框与「恢复并从新会话继续」分叉流程（jj 影子仓库引擎）；
 * 2. 文件审查面（file-review.tsx，自 dsh-file-review-tab 移植）：聊天轮尾的
 *    产物卡片、dsh-better-sidebar 的「文件审查」tab（逐轮 diff + 块级
 *    撤销/保留 + 每轮快照恢复）、以及最终回复里的行内文件提及。
 *
 * 两个面互相独立、语义互补：hunk 撤销/重做提供块级粒度，会话回退提供
 * 「回到任意消息之前」的整树恢复。
 */
import type { Context } from '@deepseek-ai/cordis';
/**
 * 两个子面的 inject 并集：sessions（会话快照）、locale（词典）、remote
 * （Typert）、slots（轮尾链与 header actions）、conversation（草稿注入，
 * 用于「恢复并继续」打开新会话）。betterSidebar 不在其中：它只由可选的
 * dsh-better-sidebar 插件提供，静态声明会让整个插件在未安装该插件的宿主
 * 上永远 pending——改在 applyFileReview 里动态解析（缺失仅降级掉侧边栏
 * tab 面，其余全部可用）。
 */
export declare const inject: string[];
/** Client plugin body: mount the rewind surface and the file-review surface. */
export declare function apply(ctx: Context): void;
