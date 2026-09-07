import { ShadowRewindError, errorMessage } from "./errors.js";
import { FORMAT_VERSION } from "./types.js";
import { CONFIG_DEFAULTS, DEFAULT_EXCLUDES, configEnvLocks, resolveConfig } from "./engine-config.js";
import { isCheckpointSkipCode } from "./engine-helpers.js";
import { ShadowRewindEngine } from "./engine.js";
import { installBeforeCapture } from "./host/before-capture.js";
import { FileReviewService, transformFile } from "./file-review/file-review-service.js";
import { installFileReviewHost } from "./file-review/host.js";
import { ENV_HINTS, classifyEnvError } from "./host/diagnostics.js";
import { ERROR_BUFFER_MAX, HostErrorLog } from "./host/error-log.js";
import { sessionEvents } from "./host/types.js";
import { TurnCheckpointCoordinator, fuseBackoffMs } from "./host/coordinator.js";
import { cleanConfigPatch, createConfigSchema } from "./host/plugin-config.js";
import { REWIND_HTTP_PATH, installShadowRewindHttp } from "./host/endpoints.js";
import { installShadowRewindCommands } from "./host/commands.js";
import { SETTINGS_NAMESPACE, installSettingsNamespace } from "./host/settings-bridge.js";
import "./rewind-host.js";
import { CHAR_HIGHLIGHT_MAX_CHARS, lineHighlight } from "./char-highlight.js";
//#region src/index.ts
/**
* DSH 插件入口：把引擎、回合协调器与 HTTP 端点装配成 cordis 服务
* `ctx.shadowRewind`，供其它插件消费。
*/
/**
* cordis 服务：`new ShadowRewindService(ctx, config)`。
*  - `agents` 作用域：安装回合第一步的自动快照闸门；
*  - web 作用域：注册 `/shadow-rewind` 端点；
*  - 启动：等引擎完成崩溃恢复，把结果写进日志。
*/
var ShadowRewindService = class {
	engine;
	coordinator;
	/** 设置卡片桥：异步装配（schemasty/settings 服务经宿主解析），到位前为
	* undefined——HTTP handler 闭包运行时读取，桥缺席时 config 端点按只读
	* 降级（ABSORB-RECALL 1.2）。 */
	settingsBridge;
	constructor(ctx, config = {}) {
		ctx.provide("shadowRewind", this);
		this.engine = new ShadowRewindEngine(config);
		this.coordinator = new TurnCheckpointCoordinator(this.engine);
		installBeforeCapture(ctx, this.engine);
		installFileReviewHost(ctx, { storageDir: this.engine.config.storageDir });
		installSettingsNamespace(ctx, this.engine, (message) => ctx.logger.warn(`[shadow-rewind] ${message}`)).then((bridge) => {
			this.settingsBridge = bridge;
		});
		ctx.inject(["agents"], (scope) => {
			this.coordinator.install(scope);
		});
		ctx.inject([
			"webServer",
			"sessions",
			"sessionQuery",
			"sessionController",
			"agents"
		], (scope) => {
			installShadowRewindHttp(scope, this.engine, this.coordinator, () => this.settingsBridge);
		});
		ctx.inject(["commands"], (scope) => {
			installShadowRewindCommands(scope, this.engine);
		});
		this.engine.ready.then(() => {
			ctx.logger.info(`[shadow-rewind] 就绪；存储=${this.engine.config.storageDir} 后端=${this.engine.effectiveBackend}`);
		}).catch((error) => {
			ctx.logger.error(`[shadow-rewind] 启动失败：${error instanceof Error ? error.message : String(error)}`);
		});
	}
	/** 等待启动装配完成。 */
	initialize() {
		return this.engine.ready;
	}
	/** 手动创建恢复点。 */
	create(options) {
		return this.engine.create(options);
	}
	/** 手动触发一个回合检查点（通常由协调器自动完成）。 */
	createTurnCheckpoint(options) {
		return this.engine.createTurnCheckpoint(options);
	}
	/** 查找回合检查点。 */
	findTurnCheckpoint(options) {
		return this.engine.findTurnCheckpoint(options);
	}
	/** 列出恢复点（可选包含 turn / rescue）。 */
	list(options) {
		return this.engine.list(options);
	}
	/** 对比恢复点与当前工作区。 */
	inspect(options) {
		return this.engine.inspect(options);
	}
	/** 生成限时恢复计划（确认串必须逐字回显）。 */
	planRestore(options) {
		return this.engine.planRestore(options);
	}
	/** 执行已批准的恢复计划。 */
	applyRestore(options) {
		return this.engine.applyRestore(options);
	}
	/** 撤销该工作区最近一次恢复（进程内单次 undo，重启失效）。 */
	undoLastRestore(options) {
		return this.engine.undoLastRestore(options);
	}
	/** 删除恢复点（被进程内 undo 记录引用的 rescue 点拒绝删除）。 */
	delete(options) {
		return this.engine.delete(options);
	}
};
//#endregion
export { CHAR_HIGHLIGHT_MAX_CHARS, CONFIG_DEFAULTS, DEFAULT_EXCLUDES, ENV_HINTS, ERROR_BUFFER_MAX, FORMAT_VERSION, FileReviewService, HostErrorLog, REWIND_HTTP_PATH, SETTINGS_NAMESPACE, ShadowRewindEngine, ShadowRewindError, ShadowRewindService, ShadowRewindService as default, TurnCheckpointCoordinator, classifyEnvError, cleanConfigPatch, configEnvLocks, createConfigSchema, errorMessage, fuseBackoffMs, installSettingsNamespace, installShadowRewindCommands, installShadowRewindHttp, isCheckpointSkipCode, lineHighlight, resolveConfig, sessionEvents, transformFile };
