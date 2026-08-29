import { ShadowRewindError, errorMessage } from "./errors.js";
import { canonicalDirectory } from "./path-utils.js";
import { FORMAT_VERSION } from "./types.js";
import { DEFAULT_EXCLUDES, ShadowRewindEngine, isCheckpointSkipCode, resolveConfig } from "./engine.js";
import { FileReviewService, transformFile } from "./file-review/file-review-service.js";
import { installFileReviewHost } from "./file-review/host.js";
import { REWIND_GATE_PATH, REWIND_HTTP_PATH, TurnCheckpointCoordinator, installShadowRewindHttp, partitionRunningSessions } from "./rewind-host.js";
import { WorkspaceWriteGate, installWriteGateHost } from "./write-gate.js";
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
	/** 写入闸（「以当前为准」）；恒常构造，config.writeGate 只决定初始开关。 */
	writeGate;
	constructor(ctx, config = {}) {
		ctx.provide("shadowRewind", this);
		this.engine = new ShadowRewindEngine(config);
		this.coordinator = new TurnCheckpointCoordinator(this.engine);
		const gateServices = {};
		this.writeGate = new WorkspaceWriteGate({
			canonicalDirectory: (path) => canonicalDirectory(path).catch(() => void 0),
			get sessions() {
				return gateServices.sessions;
			},
			get agents() {
				return gateServices.agents;
			},
			logger: ctx.logger
		}, {
			enabled: config.writeGate ?? true,
			allow: config.writeGateAllow
		});
		installFileReviewHost(ctx, { storageDir: this.engine.config.storageDir });
		installWriteGateHost(ctx, this.writeGate);
		ctx.inject(["agents"], (scope) => {
			gateServices.agents = scope.agents;
			this.coordinator.install(scope);
			this.writeGate?.install(scope);
		});
		ctx.inject(["sessions"], (scope) => {
			gateServices.sessions = scope.sessions;
		});
		ctx.inject([
			"webServer",
			"sessions",
			"sessionQuery",
			"apiProxy",
			"agents"
		], (scope) => {
			installShadowRewindHttp(scope, this.engine, this.coordinator, this.writeGate);
		});
		this.engine.ready.then((reconciled) => {
			if (reconciled > 0) ctx.logger.warn(`[shadow-rewind] 启动恢复完成：处理了 ${String(reconciled)} 个中断的恢复操作`);
			else ctx.logger.info(`[shadow-rewind] 就绪；存储=${this.engine.config.storageDir} 后端=${this.engine.effectiveBackend}`);
		}).catch((error) => {
			ctx.logger.error(`[shadow-rewind] 启动失败：${error instanceof Error ? error.message : String(error)}`);
		});
	}
	/** 等待启动恢复完成。 */
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
	/** 删除恢复点（confirmation 必须逐字等于 `DELETE <id>`）。 */
	delete(options) {
		return this.engine.delete(options);
	}
	/** 列出中断/需人工介入的恢复操作。 */
	listRecovery(options) {
		return this.engine.listRecovery(options);
	}
};
//#endregion
export { DEFAULT_EXCLUDES, FORMAT_VERSION, FileReviewService, REWIND_GATE_PATH, REWIND_HTTP_PATH, ShadowRewindEngine, ShadowRewindError, ShadowRewindService, ShadowRewindService as default, TurnCheckpointCoordinator, errorMessage, installShadowRewindHttp, isCheckpointSkipCode, partitionRunningSessions, resolveConfig, transformFile };
