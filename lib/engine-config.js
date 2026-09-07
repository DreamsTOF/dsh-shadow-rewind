import { ShadowRewindError } from "./errors.js";
import { join } from "node:path";
import { homedir } from "node:os";
//#region src/engine-config.ts
/**
* 核心引擎·配置解析。
*
* ShadowRewindConfig（用户输入）→ ResolvedShadowRewindConfig（全部字段落定）
* 的唯一入口 {@link resolveConfig}：非法值直接抛 INVALID_CONFIG——宁可拒绝
* 启动也不带病运行。默认排除清单与各项上限常量也归档于此。
*
* 配置优先级（吸收自 dsh-recall-plugin，ABSORB-RECALL 1.1/1.4）：
*   env（DSH_SHADOW_REWIND_*，最高优先，设置卡片锁定不可编辑）
*   → 用户配置（cordis.patch.yml insert 行 config 键 / 设置卡片写入）
*   → DEFAULTS（出厂默认，单一事实源：设置卡片 schema 与重置路径共用，
*     避免重置与 schema 漂移）。
* env 值非法时静默回退下一优先级（与 recall 的 pickNumber 一致——env 填错
* 不该让插件拒绝启动）；用户配置非法仍然 throw（宁可拒绝启动也不带病运行）。
*/
/** 默认排除清单：VCS 目录、依赖、构建产物与常见缓存（自用取向：宁多勿漏）。 */
const DEFAULT_EXCLUDES = [
	".git",
	".jj",
	"node_modules",
	"dist",
	"build",
	"out",
	"target",
	"__pycache__",
	".venv",
	"venv",
	".cache",
	"coverage",
	".next",
	".nuxt",
	".turbo",
	".parcel-cache",
	"tmp",
	"temp"
];
/** 各配置项的出厂默认值（全部经 resolveConfig 校验）。设置卡片 schema、
* config-reset 兜底与本文件共用这一份——默认值只此一处。 */
const CONFIG_DEFAULTS = {
	maxRestorePoints: 50,
	maxTurnCheckpointsPerSession: 30,
	maxFiles: 2e4,
	maxFileBytes: 16777216,
	maxSnapshotBytes: 536870912,
	planTtlMs: 9e5,
	turnCheckpointMode: "jj",
	turnCheckpointTimeoutMs: 5e3,
	turnCheckpointMaxNewBytes: 33554432,
	turnCheckpointTrust: "fast"
};
/** env 变量名前缀：DSH_SHADOW_REWIND_<字段大写蛇形>。 */
const ENV_PREFIX = "DSH_SHADOW_REWIND_";
/** 读一个 env 数值（入参为字段短名，内部拼前缀）：缺失/非有限数值返回 undefined。 */
function envNumber(field) {
	const raw = process.env[ENV_PREFIX + field];
	if (raw === void 0 || raw.trim() === "") return void 0;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : void 0;
}
/** 读一个 env 枚举：缺失/不在合法集返回 undefined。 */
function envEnum(field, allowed) {
	const raw = process.env[ENV_PREFIX + field];
	return raw !== void 0 && allowed.includes(raw) ? raw : void 0;
}
/** 读一个 env 正整数：缺失/非正整数返回 undefined。 */
function envPositiveInteger(field) {
	const value = envNumber(field);
	return value !== void 0 && Number.isSafeInteger(value) && value > 0 ? value : void 0;
}
/**
* 各字段的 env 覆盖现状（config-get 端点的 envLocks 依据：设了 env 的字段
* 在设置卡片锁定不可编辑——改了也会被 env 压住，锁死比静默失效诚实）。
*/
function configEnvLocks() {
	const has = (field) => {
		const raw = process.env[ENV_PREFIX + field];
		return raw !== void 0 && raw.trim() !== "";
	};
	return {
		maxRestorePoints: has("MAX_RESTORE_POINTS"),
		maxTurnCheckpointsPerSession: has("MAX_TURN_CHECKPOINTS_PER_SESSION"),
		maxFiles: has("MAX_FILES"),
		maxFileBytes: has("MAX_FILE_BYTES"),
		maxSnapshotBytes: has("MAX_SNAPSHOT_BYTES"),
		planTtlMs: has("PLAN_TTL_MS"),
		turnCheckpointMode: has("TURN_CHECKPOINT_MODE"),
		turnCheckpointTimeoutMs: has("TURN_CHECKPOINT_TIMEOUT_MS"),
		turnCheckpointMaxNewBytes: has("TURN_CHECKPOINT_MAX_NEW_BYTES"),
		turnCheckpointTrust: has("TURN_CHECKPOINT_TRUST"),
		excludePatterns: has("EXCLUDE_PATTERNS")
	};
}
/** env 的 excludePatterns：逗号或分号分隔；空表/未设返回 undefined。 */
function envExcludes() {
	const raw = process.env[ENV_PREFIX + "EXCLUDE_PATTERNS"];
	if (raw === void 0 || raw.trim() === "") return void 0;
	const parts = raw.split(/[,;]/).map((item) => item.trim()).filter((item) => item !== "");
	return parts.length > 0 ? parts : void 0;
}
/** 解析配置：全部字段落定；非法值直接抛错（宁可拒绝启动也不带病运行）。 */
function resolveConfig(config) {
	const storageDir = typeof config.storageDir === "string" && config.storageDir.trim() !== "" ? config.storageDir : join(process.env.DSH_HOME ?? join(homedir(), ".dsh"), "shadow-rewind", "v1");
	const mode = envEnum("TURN_CHECKPOINT_MODE", [
		"off",
		"sqlite",
		"jj"
	]) ?? config.turnCheckpointMode ?? CONFIG_DEFAULTS.turnCheckpointMode;
	if (mode !== "off" && mode !== "sqlite" && mode !== "jj") throw new ShadowRewindError("INVALID_CONFIG", "turnCheckpointMode 必须是 off、sqlite 或 jj");
	const trust = envEnum("TURN_CHECKPOINT_TRUST", ["fast", "strict"]) ?? config.turnCheckpointTrust ?? CONFIG_DEFAULTS.turnCheckpointTrust;
	if (trust !== "fast" && trust !== "strict") throw new ShadowRewindError("INVALID_CONFIG", "turnCheckpointTrust 必须是 fast 或 strict");
	const envExcluded = envExcludes();
	return {
		storageDir,
		maxRestorePoints: positiveInteger(envPositiveInteger("MAX_RESTORE_POINTS") ?? config.maxRestorePoints ?? CONFIG_DEFAULTS.maxRestorePoints, "maxRestorePoints"),
		maxTurnCheckpointsPerSession: positiveInteger(envPositiveInteger("MAX_TURN_CHECKPOINTS_PER_SESSION") ?? config.maxTurnCheckpointsPerSession ?? CONFIG_DEFAULTS.maxTurnCheckpointsPerSession, "maxTurnCheckpointsPerSession"),
		maxFiles: positiveInteger(envPositiveInteger("MAX_FILES") ?? config.maxFiles ?? CONFIG_DEFAULTS.maxFiles, "maxFiles"),
		maxFileBytes: positiveInteger(envPositiveInteger("MAX_FILE_BYTES") ?? config.maxFileBytes ?? CONFIG_DEFAULTS.maxFileBytes, "maxFileBytes"),
		maxSnapshotBytes: positiveInteger(envPositiveInteger("MAX_SNAPSHOT_BYTES") ?? config.maxSnapshotBytes ?? CONFIG_DEFAULTS.maxSnapshotBytes, "maxSnapshotBytes"),
		planTtlMs: positiveInteger(envPositiveInteger("PLAN_TTL_MS") ?? config.planTtlMs ?? CONFIG_DEFAULTS.planTtlMs, "planTtlMs"),
		turnCheckpointMode: mode,
		turnCheckpointTimeoutMs: positiveInteger(envPositiveInteger("TURN_CHECKPOINT_TIMEOUT_MS") ?? config.turnCheckpointTimeoutMs ?? CONFIG_DEFAULTS.turnCheckpointTimeoutMs, "turnCheckpointTimeoutMs"),
		turnCheckpointMaxNewBytes: positiveInteger(envPositiveInteger("TURN_CHECKPOINT_MAX_NEW_BYTES") ?? config.turnCheckpointMaxNewBytes ?? CONFIG_DEFAULTS.turnCheckpointMaxNewBytes, "turnCheckpointMaxNewBytes"),
		turnCheckpointTrust: trust,
		excludePatterns: envExcluded ?? config.excludePatterns ?? DEFAULT_EXCLUDES
	};
}
function positiveInteger(value, name) {
	if (!Number.isSafeInteger(value) || value <= 0) throw new ShadowRewindError("INVALID_CONFIG", `${name} 必须是正整数`);
	return value;
}
//#endregion
export { CONFIG_DEFAULTS, CONFIG_DEFAULTS as DEFAULTS, DEFAULT_EXCLUDES, ENV_PREFIX, configEnvLocks, resolveConfig };
