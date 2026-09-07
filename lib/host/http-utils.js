import { ShadowRewindError } from "../errors.js";
//#region src/host/http-utils.ts
/**
* 宿主适配层·HTTP 小工具。
*
* 端点层的最小 Node req/res 结构面 + 请求体 / 查询参数解析助手。
* 所有解析失败一律抛 {@link ShadowRewindError}（code = INVALID_ARGUMENTS），
* 由各端点 handler 统一捕获后按 409/404 回 JSON 错误。
*/
/** POST 请求体字节上限：超过直接拒绝，不缓冲。 */
const BODY_LIMIT = 65536;
/** 端点只服务本机回环：任何非回环来源一律 403（与旧插件同一安全边界）。 */
function isLoopback(address) {
	return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
/** 统一 JSON 响应：no-store 防止预览/清单被浏览器缓存成过期数据。 */
function json(response, status, value) {
	response.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	response.end(`${JSON.stringify(value)}\n`);
}
/** 读取并解析 JSON 请求体（Buffer 拼接，超限/非法 JSON 都抛 INVALID_ARGUMENTS）。 */
async function readJsonBody(request) {
	const chunks = [];
	let size = 0;
	await new Promise((resolve, reject) => {
		request.on("data", (chunk) => {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += bytes.length;
			if (size > BODY_LIMIT) {
				reject(new ShadowRewindError("INVALID_ARGUMENTS", "请求体过大"));
				return;
			}
			chunks.push(bytes);
		});
		request.on("end", () => resolve());
		request.on("error", reject);
	});
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch (error) {
		throw new ShadowRewindError("INVALID_ARGUMENTS", "请求体必须是合法 JSON", { cause: error });
	}
}
/** 要求非空字符串（否则抛 INVALID_ARGUMENTS）。 */
function requiredText(value, name) {
	if (typeof value !== "string" || value === "") throw new ShadowRewindError("INVALID_ARGUMENTS", `${name} 必须是非空字符串`);
	return value;
}
/** 可选字符串：undefined 直接通过，存在时按 requiredText 校验。 */
function optionalText(value, name) {
	return value === void 0 ? void 0 : requiredText(value, name);
}
/** 要求非负整数（接受十进制数字字符串——查询参数天然是字符串）。 */
function nonNegativeInteger(value, name) {
	const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
	if (!Number.isSafeInteger(parsed) || parsed < 0) throw new ShadowRewindError("INVALID_ARGUMENTS", `${name} 必须是非负整数`);
	return parsed;
}
/** 分页 limit 参数：缺省回 fallback，越界拒绝。 */
function pageSize(value, fallback) {
	if (value === null) return fallback;
	const parsed = nonNegativeInteger(value, "limit");
	if (parsed < 1 || parsed > 200) throw new ShadowRewindError("INVALID_ARGUMENTS", `limit 必须在 1 到 ${String(200)} 之间`);
	return parsed;
}
//#endregion
export { isLoopback, json, nonNegativeInteger, optionalText, pageSize, readJsonBody, requiredText };
