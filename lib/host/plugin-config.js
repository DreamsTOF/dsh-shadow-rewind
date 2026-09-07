import { CONFIG_DEFAULTS, DEFAULT_EXCLUDES } from "../engine-config.js";
//#region src/host/plugin-config.ts
/**
* 宿主适配层·插件配置卡片的 schema 单一事实源。
*
* Config schema 同时承担两个角色（吸收自 dsh-recall-plugin，ABSORB-RECALL
* 1.1）：settings namespace「shadow-rewind」的注册 schema（设置卡片据此
* 渲染与校验）与 config-set 的字段白名单依据；默认值统一引用
* engine-config.ts 的 CONFIG_DEFAULTS——默认值只此一份，避免重置与 schema
* 漂移。
*
* @deepseek-ai/schemastery 运行时经宿主 node_modules 动态解析（见
* types/host-modules.d.ts 的说明）：解析失败返回 null，设置卡片降级缺席
* （config-get 仍可用，writable=false），插件其余功能不受影响。
*/
/** 动态加载宿主提供的 schemasty；不可用返回 null（设置卡片降级缺席）。 */
async function loadSchemastery() {
	try {
		const module = await import("@deepseek-ai/schemastery");
		const resolved = typeof module?.object === "function" ? module : module?.default;
		return resolved !== void 0 && typeof resolved.object === "function" ? resolved : null;
	} catch {
		return null;
	}
}
/** 构造 settings namespace 注册 schema；schemasty 不可用时返回 null。 */
async function createConfigSchema() {
	const Schema = await loadSchemastery();
	if (Schema === null) return null;
	const number = (value, description) => Schema.number().default(value).description(description);
	return Schema.object({
		maxRestorePoints: number(CONFIG_DEFAULTS.maxRestorePoints, "手动恢复点配额（rescue 备份点不占配额）"),
		maxTurnCheckpointsPerSession: number(CONFIG_DEFAULTS.maxTurnCheckpointsPerSession, "每会话每相位保留的轮检查点数（轮起/轮末各一份配额）"),
		maxFiles: number(CONFIG_DEFAULTS.maxFiles, "单次快照允许的最大文件数"),
		maxFileBytes: number(CONFIG_DEFAULTS.maxFileBytes, "超过该字节数的文件不进快照"),
		maxSnapshotBytes: number(CONFIG_DEFAULTS.maxSnapshotBytes, "单次快照总字节上限"),
		planTtlMs: number(CONFIG_DEFAULTS.planTtlMs, "恢复计划有效期（毫秒），过期仅作软警告"),
		turnCheckpointMode: Schema.string().default(CONFIG_DEFAULTS.turnCheckpointMode).description("自动轮检查点后端：jj / sqlite / off（启动级，修改需重启）"),
		turnCheckpointTimeoutMs: number(CONFIG_DEFAULTS.turnCheckpointTimeoutMs, "自动轮检查点超时（毫秒），超时按可预期跳过处理"),
		turnCheckpointMaxNewBytes: number(CONFIG_DEFAULTS.turnCheckpointMaxNewBytes, "单轮检查点新增字节上限，超出跳过本轮快照"),
		turnCheckpointTrust: Schema.string().default(CONFIG_DEFAULTS.turnCheckpointTrust).description("轮检查点信任级别：fast（stat 缓存）/ strict（全量读回）"),
		excludePatterns: Schema.array(Schema.string()).default([...DEFAULT_EXCLUDES]).description("路径排除清单（目录或文件名，匹配的路径不进快照）")
	});
}
/** config-set 的可写字段白名单（storageDir / turnCheckpointMode 为启动级，
* 热更不生效，拒绝运行时修改——改它们必须走 cordis.patch.yml + 重启）。 */
const NUMBER_FIELDS = [
	"maxRestorePoints",
	"maxTurnCheckpointsPerSession",
	"maxFiles",
	"maxFileBytes",
	"maxSnapshotBytes",
	"planTtlMs",
	"turnCheckpointTimeoutMs",
	"turnCheckpointMaxNewBytes"
];
/** 清洗设置卡片提交的补丁：白名单字段 + 类型收敛 + 正整数校验。
* 返回 null 表示补丁为空；抛出 Error 表示字段非法（消息面向 UI）。 */
function cleanConfigPatch(patch) {
	const clean = {};
	for (const field of NUMBER_FIELDS) {
		const value = patch[field];
		if (value === void 0) continue;
		const n = typeof value === "number" ? value : Number(value);
		if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${field} 必须是正整数`);
		clean[field] = n;
	}
	if (patch.turnCheckpointTrust !== void 0) {
		if (patch.turnCheckpointTrust !== "fast" && patch.turnCheckpointTrust !== "strict") throw new Error("turnCheckpointTrust 必须是 fast 或 strict");
		clean.turnCheckpointTrust = patch.turnCheckpointTrust;
	}
	if (patch.excludePatterns !== void 0) {
		if (!Array.isArray(patch.excludePatterns) || !patch.excludePatterns.every((item) => typeof item === "string" && item.trim() !== "")) throw new Error("excludePatterns 必须是非空字符串数组");
		clean.excludePatterns = patch.excludePatterns;
	}
	return clean;
}
//#endregion
export { cleanConfigPatch, createConfigSchema, loadSchemastery };
