/** 可取消的超时控制：定时器保持 Node 进程存活直到触发或取消。 */
/** 创建一个 timeoutMs 后自动 abort 的控制器；用完必须 cancel 释放定时器。 */
export function createDeadline(timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort(new DOMException(`deadline exceeded after ${String(timeoutMs)} ms`, 'TimeoutError'));
    }, timeoutMs);
    return {
        signal: controller.signal,
        cancel() {
            clearTimeout(timer);
        },
    };
}
//# sourceMappingURL=deadline.js.map