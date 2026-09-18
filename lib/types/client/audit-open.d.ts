/**
 * 打开全屏审查界面（AuditOverlay）的进程内总线。
 *
 * 统一恢复弹窗（rewind.ts RewindDialog）点某行的 +/- 深链时，目标视图分两种：
 * 弹窗开在审计面板内（提供 onJumpToDiff，就地展开滚动）；开在消息旁时没有
 * 面板上下文，经本总线交给 live 条——它是 AuditOverlay 的宿主，负责开窗并
 * 深链展开对应文件。无订阅者时为无害空操作。
 */
type OpenAuditListener = (paths: readonly string[]) => void;
/** 请求打开审查界面并展开给定路径。 */
export declare function openAuditOverlay(paths: readonly string[]): void;
/** 订阅打开请求（live 条挂载时注册；返回解绑函数）。 */
export declare function subscribeOpenAudit(listener: OpenAuditListener): () => void;
export {};
