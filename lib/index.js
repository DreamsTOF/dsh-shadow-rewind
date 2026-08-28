/**
 * DSH 插件入口：把引擎、回合协调器与 HTTP 端点装配成 cordis 服务
 * `ctx.shadowRewind`，供其它插件消费。
 */
import { ShadowRewindEngine } from './engine.js';
import { installShadowRewindHttp, TurnCheckpointCoordinator } from './rewind-host.js';
export * from './engine.js';
export * from './errors.js';
export * from './rewind-host.js';
export * from './types.js';
/**
 * cordis 服务：`new ShadowRewindService(ctx, config)`。
 *  - `agents` 作用域：安装回合第一步的自动快照闸门；
 *  - web 作用域：注册 `/shadow-rewind` 端点；
 *  - 启动：等引擎完成崩溃恢复，把结果写进日志。
 */
export class ShadowRewindService {
    engine;
    coordinator;
    constructor(ctx, config = {}) {
        ctx.provide('shadowRewind', this);
        this.engine = new ShadowRewindEngine(config);
        this.coordinator = new TurnCheckpointCoordinator(this.engine);
        ctx.inject(['agents'], (scope) => {
            this.coordinator.install(scope);
        });
        ctx.inject(['webServer', 'sessions', 'sessionQuery', 'apiProxy', 'agents'], (scope) => {
            const s = scope;
            installShadowRewindHttp(s, this.engine, this.coordinator);
        });
        void this.engine.ready.then((reconciled) => {
            if (reconciled > 0) {
                ctx.logger.warn(`[shadow-rewind] 启动恢复完成：处理了 ${String(reconciled)} 个中断的恢复操作`);
            }
            else {
                ctx.logger.info(`[shadow-rewind] 就绪；存储=${this.engine.config.storageDir} 后端=${this.engine.effectiveBackend}`);
            }
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
}
export default ShadowRewindService;
//# sourceMappingURL=index.js.map