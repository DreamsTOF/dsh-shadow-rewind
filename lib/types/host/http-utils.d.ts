/**
 * 宿主适配层·HTTP 小工具。
 *
 * 端点层的最小 Node req/res 结构面 + 请求体 / 查询参数解析助手。
 * 所有解析失败一律抛 {@link ShadowRewindError}（code = INVALID_ARGUMENTS），
 * 由各端点 handler 统一捕获后按 409/404 回 JSON 错误。
 */
/** 预览响应默认带出的变更条数（分页首屏）。 */
export declare const INITIAL_CHANGE_PREVIEW_LIMIT = 8;
/** 分页单页上限（details=1 拉全清单与 limit 参数共用这个天花板）。 */
export declare const MAX_CHANGE_PAGE_SIZE = 200;
/** 最小 HTTP 面（Node 原生 req/res）。 */
export interface Request {
    readonly method?: string;
    readonly url?: string;
    readonly socket: {
        readonly remoteAddress?: string;
    };
    on(event: string, listener: (chunk: unknown) => void): void;
    on(event: string, listener: () => void): void;
    on(event: string, listener: (error: unknown) => void): void;
}
export interface Response {
    writeHead(status: number, headers: Record<string, string>): void;
    end(body?: string): void;
    on(event: 'data', listener: (chunk: unknown) => void): void;
    on(event: 'end', listener: () => void): void;
    on(event: 'error', listener: (error: unknown) => void): void;
}
/** 端点只服务本机回环：任何非回环来源一律 403（与旧插件同一安全边界）。 */
export declare function isLoopback(address: string | undefined): boolean;
/** 统一 JSON 响应：no-store 防止预览/清单被浏览器缓存成过期数据。 */
export declare function json(response: Response, status: number, value: unknown): void;
/** 读取并解析 JSON 请求体（Buffer 拼接，超限/非法 JSON 都抛 INVALID_ARGUMENTS）。 */
export declare function readJsonBody(request: Request): Promise<unknown>;
/** 要求非空字符串（否则抛 INVALID_ARGUMENTS）。 */
export declare function requiredText(value: unknown, name: string): string;
/** 可选字符串：undefined 直接通过，存在时按 requiredText 校验。 */
export declare function optionalText(value: unknown, name: string): string | undefined;
/** 要求非负整数（接受十进制数字字符串——查询参数天然是字符串）。 */
export declare function nonNegativeInteger(value: unknown, name: string): number;
/** 分页 limit 参数：缺省回 fallback，越界拒绝。 */
export declare function pageSize(value: string | null, fallback: number): number;
