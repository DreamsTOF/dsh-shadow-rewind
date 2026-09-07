import { createConfigSchema } from "./plugin-config.js";
//#region src/host/settings-bridge.ts
/**
* 宿主适配层·settings namespace 桥（设置页「插件配置」分区接入）。
*
* 注册 namespace「shadow-rewind」，把用户在设置卡片写入的配置经 watch
* 热更新进运行中引擎（engine.applyConfigPatch），无需重启。分支依据是
* 运行时注入实例的实际 API 而非静态包版本（吸收自 dsh-recall-plugin，
* ABSORB-RECALL 1.2——插件 node_modules 固定最新、旧宿主注入旧实例）：
*  1. dsh-settings 包的独立函数 installSettingsSection（≤0.1.2-alpha.1）；
*  2. settings 服务方法 installSection（0.1.2-alpha.2+，官方插件同款）；
*  3. settings 服务 register 核心 API（0.1.1-rc.2 及以前，手动复刻接线）。
* 全部不可用（schemasty / dsh-settings / settings 服务任一缺席）时降级：
* 设置卡片缺席、config 端点 writable=false，插件其余功能不受影响。
*/
/** settings namespace：client 侧 settings.plugin.item slot 的 key 必须一致。 */
const SETTINGS_NAMESPACE = "shadow-rewind";
/** 装配 settings namespace。返回 config 端点使用的读写桥（永不抛错）。 */
async function installSettingsNamespace(ctx, engine, onError) {
	const schema = await createConfigSchema();
	const state = {
		service: null,
		degraded: schema === null
	};
	const hooks = {
		setSource: (fn) => {
			readSettings = fn;
		},
		onChange: () => {
			applyResolved(readSettings());
		}
	};
	let readSettings = () => void 0;
	function applyResolved(resolved) {
		if (resolved !== null && typeof resolved === "object") engine.applyConfigPatch(resolved);
	}
	if (schema !== null) try {
		try {
			const dshSettings = await import("@deepseek-ai/dsh-settings");
			if (typeof dshSettings?.installSettingsSection === "function") {
				dshSettings.installSettingsSection(ctx, SETTINGS_NAMESPACE, schema, {}, hooks);
				state.service = null;
				return buildBridge(state, engine);
			}
		} catch {}
		ctx.inject(["settings"], (scope) => {
			const service = scope.settings;
			if (service === void 0) return;
			state.service = service;
			if (typeof service.installSection === "function") service.installSection(ctx, SETTINGS_NAMESPACE, schema, {}, hooks);
			else if (typeof service.register === "function") {
				const scopeLike = service.register(SETTINGS_NAMESPACE, schema, { base: {} });
				hooks.setSource(() => scopeLike.get());
				hooks.onChange();
				scopeLike.watch(() => hooks.onChange());
			} else {
				state.degraded = true;
				onError("settings 服务无 installSection/register API，设置卡片不可用");
			}
		});
	} catch (error) {
		state.degraded = true;
		onError(`settings namespace skipped: ${error instanceof Error ? error.message : String(error)}`);
	}
	return buildBridge(state, engine);
}
function buildBridge(state, engine) {
	return {
		overridden() {
			try {
				const describe = state.service?.describe;
				if (typeof describe !== "function") return {};
				const list = describe.call(state.service);
				const ours = (Array.isArray(list) ? list : []).find((entry) => entry?.ns === SETTINGS_NAMESPACE);
				return ours?.user !== void 0 && typeof ours.user === "object" ? { ...ours.user } : {};
			} catch {
				return {};
			}
		},
		writable() {
			const service = state.service;
			if (service === void 0 || service === null) return false;
			return service.writable !== false;
		},
		async update(patch) {
			const service = state.service;
			if (service === null || typeof service.update !== "function") throw new Error("settings 服务不可用：请在 profile 的 cordis.patch.yml 按 id: shadow-rewind 覆盖配置");
			await service.update(SETTINGS_NAMESPACE, patch);
		},
		async reset(defaults) {
			const service = state.service;
			if (service === null) throw new Error("settings 服务不可用");
			if (typeof service.replace === "function") {
				await service.replace(SETTINGS_NAMESPACE, {});
				return;
			}
			if (typeof service.update !== "function") throw new Error("settings 服务不可用");
			await service.update(SETTINGS_NAMESPACE, defaults);
			engine.applyConfigPatch(defaults);
		}
	};
}
//#endregion
export { SETTINGS_NAMESPACE, installSettingsNamespace };
