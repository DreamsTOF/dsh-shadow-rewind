/**
 * 宿主运行时模块的最小类型声明。
 *
 * @deepseek-ai/schemasty 与 @deepseek-ai/dsh-settings 不进 devDependencies
 * ——dsh-settings 0.1.2 系自身的依赖区间（dsh-llm@>=0.1.2 <0.2.0-0）在 npm
 * 上为空解，pnpm 重解析硬失败（官方发布链踩了 ABSORB-RECALL 5.1 同款坑）。
 * 两者运行时一律经宿主 node_modules 动态 import 解析（插件部署在 profile
 * node_modules 同层），解析失败走降级（设置卡片缺失，插件其余功能不受
 * 影响）；这里只声明插件实际消费的成员。
 */

declare module '@deepseek-ai/schemastery' {
  /** schemasty 最小面：链式 builder + 校验器对象（运行时是 class 实例）。 */
  interface SchemaLike {
    readonly schema?: unknown
    (value: unknown): unknown
  }
  interface Chainable extends SchemaLike {
    default(value: unknown): Chainable
    description(text: string): Chainable
    required(): Chainable
  }
  export function object(properties: Record<string, SchemaLike | unknown>): Chainable
  export function number(): Chainable
  export function boolean(): Chainable
  export function string(): Chainable
  export function array(items: SchemaLike | unknown): Chainable
  const Schema: {
    object: typeof object
    number: typeof number
    boolean: typeof boolean
    string: typeof string
    array: typeof array
  }
  export default Schema
}

declare module '@deepseek-ai/dsh-settings' {
  /**
   * 独立函数形态（dsh ≤0.1.2-alpha.1 提供，之后迁移为 settings 服务方法，
   * 同签名）：注册 namespace、组合 base、watch 触发 onChange、卸载回退。
   */
  export function installSettingsSection(
    ctx: unknown,
    namespace: string,
    config: unknown,
    base: unknown,
    hooks: { setSource(fn: () => unknown): void; onChange(): void },
  ): unknown
}
