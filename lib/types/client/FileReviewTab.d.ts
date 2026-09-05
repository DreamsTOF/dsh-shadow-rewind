/**
 * FileReviewTab —— better-sidebar tab 的本体：列出 agent 在**本会话**改过的
 * 每一个文件（按轮分组），行内渲染行级红/绿 diff，并经本包的宿主
 * file-review Typert remote 提供按轮 / 按文件的撤销 + 重新应用。全部推导都
 * 挂在客户端 runtime 的已定稿会话快照上——什么都不会注入聊天流（那正是本
 * 移植要消除的样式冲突源）。
 */
import type { Context } from '@deepseek-ai/cordis';
/** Tab 组件入参（better-sidebar 的 TabComponentProps 的收窄版）。 */
export interface FileReviewTabProps {
    readonly ctx: Context;
    readonly sessionId: string;
    readonly cwd: string | undefined;
    /** 活跃 tab + 面板已打开；为 false 时暂停实时状态巡检。 */
    readonly visible: boolean;
    /**
     * 侧边栏 tab 句柄。`meta.expandPaths`（string[]）就是聊天轮尾行经
     * updateTab / openTab 写入的深链：一份**新的** meta 引用会被重放成「展开
     * 这些文件的 diff 并滚到第一个」。
     */
    readonly tab: {
        readonly meta?: unknown;
    };
}
/** 侧边栏 tab 本体：逐轮变更组 + 行内 diff + 撤销。 */
export declare function FileReviewTab({ ctx, sessionId, cwd, visible, tab }: FileReviewTabProps): import("react").JSX.Element;
