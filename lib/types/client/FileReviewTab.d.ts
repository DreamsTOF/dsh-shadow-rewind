/**
 * FileReviewTab —— better-sidebar tab 的本体：列出 agent 在**本会话**改过的
 * 每一个文件（按轮分组），行内渲染行级红/绿 diff，并经本包的宿主
 * file-review Typert remote 提供按轮 / 按文件的撤销 + 重新应用。全部推导都
 * 挂在客户端 runtime 的已定稿会话快照上——什么都不会注入聊天流（那正是本
 * 移植要消除的样式冲突源）。
 *
 * 物理布局（拆分后本文件只持有主组件；子件与形状单向依赖）：
 *  - ./file-review-tab-types.ts  共享类型 + 纯工具（stateKey/addStats…）；
 *  - ./review-widgets.tsx        Stats / 图标 / StateBadge / LazyDiff；
 *  - ./turn-rewind-dialog.tsx    「从快照恢复此轮」对话框（独立状态机）；
 *  - ./review-dialogs.tsx        多会话确认弹窗 + 文件级时间线对话框。
 */
import type { FileReviewTabProps } from './file-review-tab-types.ts';
export type { FileReviewTabProps };
/** 侧边栏 tab 本体：逐轮变更组 + 行内 diff + 撤销。 */
export declare function FileReviewTab({ ctx, sessionId, cwd, visible, tab }: FileReviewTabProps): import("react").JSX.Element;
