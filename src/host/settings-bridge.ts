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

import { createConfigSchema } from './plugin-config.js'
import type { ShadowRewindEngine } from '../engine.js'
import type { SettingsScopeLike, SettingsSectionHooks, SettingsServiceLike } from './types.js'

/** settings namespace：client 侧 settings.plugin.item slot 的 key 必须一致。 */
export const SETTINGS_NAMESPACE = 'shadow-rewind'

/** config 端点对 settings 用户层的读写面（全部容错：不可用即降级）。 */
export interface SettingsBridge {
  /** 用户已覆盖的字段文档（describe().user）；不可用返回 {}。 */
  overridden(): Record<string, unknown>
  /** 用户层是否可写（settings 服务在位且未声明只读）。 */
  writable(): boolean
  /** 写用户层补丁；watch 链路随后热更新进引擎。 */
  update(patch: Record<string, unknown>): Promise<void>
  /** 重置用户层为默认（优先官方 replace，老版本降级 update 反写 DEFAULTS）。 */
  reset(defaults: Record<string, unknown>): Promise<void>
}

/** 桥的运行时状态：settings 服务实例（延迟注入到位）与降级标记。 */
interface BridgeState {
  service: SettingsServiceLike | null
  degraded: boolean
}

/** 装配 settings namespace。返回 config 端点使用的读写桥（永不抛错）。 */
export async function installSettingsNamespace(ctx: {
  inject(names: readonly string[], fn: (scope: { settings?: SettingsServiceLike }) => void): void
  logger: { warn(message: string): void }
}, engine: ShadowRewindEngine, onError: (message: string) => void): Promise<SettingsBridge> {
  const schema = await createConfigSchema()
  const state: BridgeState = { service: null, degraded: schema === null }

  const hooks: SettingsSectionHooks = {
    setSource: (fn) => { readSettings = fn },
    onChange: () => { applyResolved(readSettings()) },
  }
  let readSettings: () => unknown = () => undefined
  function applyResolved(resolved: unknown): void {
    if (resolved !== null && typeof resolved === 'object') {
      engine.applyConfigPatch(resolved as Record<string, unknown>)
    }
  }

  if (schema !== null) {
    try {
      // 形态 1：dsh-settings 独立函数（旧宿主）。动态 import——包缺席时
      // 抛模块级错误，被 catch 后继续尝试形态 2/3。
      try {
        const dshSettings = await import('@deepseek-ai/dsh-settings') as { installSettingsSection?: (ctx: unknown, ns: string, config: unknown, base: unknown, hooks: SettingsSectionHooks) => unknown }
        if (typeof dshSettings?.installSettingsSection === 'function') {
          dshSettings.installSettingsSection(ctx, SETTINGS_NAMESPACE, schema, {}, hooks)
          state.service = null
          return buildBridge(state, engine)
        }
      } catch { /* 包缺席：走 settings 服务形态 */ }
      // 形态 2/3：settings 服务经 cordis inject 到位后分派（服务未装配的
      // 宿主上该 inject 挂起即可——与其余装配同一降级模型）。
      ctx.inject(['settings'], (scope) => {
        const service = scope.settings
        if (service === undefined) return
        state.service = service
        if (typeof service.installSection === 'function') {
          service.installSection(ctx, SETTINGS_NAMESPACE, schema, {}, hooks)
        } else if (typeof service.register === 'function') {
          const scopeLike: SettingsScopeLike = service.register(SETTINGS_NAMESPACE, schema, { base: {} })
          hooks.setSource(() => scopeLike.get())
          hooks.onChange()
          scopeLike.watch(() => hooks.onChange())
        } else {
          state.degraded = true
          onError('settings 服务无 installSection/register API，设置卡片不可用')
        }
      })
    } catch (error) {
      state.degraded = true
      onError(`settings namespace skipped: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return buildBridge(state, engine)
}

function buildBridge(state: BridgeState, engine: ShadowRewindEngine): SettingsBridge {
  return {
    overridden() {
      try {
        const describe = state.service?.describe
        if (typeof describe !== 'function') return {}
        const list = describe.call(state.service)
        const ours = (Array.isArray(list) ? list : []).find((entry) => entry?.ns === SETTINGS_NAMESPACE)
        return ours?.user !== undefined && typeof ours.user === 'object' ? { ...ours.user } : {}
      } catch {
        return {}
      }
    },
    writable() {
      const service = state.service
      if (service === undefined || service === null) return false
      return service.writable !== false
    },
    async update(patch) {
      const service = state.service
      if (service === null || typeof service.update !== 'function') {
        throw new Error('settings 服务不可用：请在 profile 的 cordis.patch.yml 按 id: shadow-rewind 覆盖配置')
      }
      await service.update(SETTINGS_NAMESPACE, patch)
    },
    async reset(defaults) {
      const service = state.service
      if (service === null) throw new Error('settings 服务不可用')
      if (typeof service.replace === 'function') {
        await service.replace(SETTINGS_NAMESPACE, {})
        return
      }
      if (typeof service.update !== 'function') throw new Error('settings 服务不可用')
      // 老版本无 replace：把 DEFAULTS 逐字段 update 反写（等价于清掉用户覆盖）。
      await service.update(SETTINGS_NAMESPACE, defaults)
      // 反写也走了 watch 链路，引擎同步落定。
      engine.applyConfigPatch(defaults)
    },
  }
}
