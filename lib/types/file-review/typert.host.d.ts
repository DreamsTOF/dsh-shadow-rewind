/**
 * 宿主半边的 Typert 贡献 —— 经包的 `./typert` 导出被发现并注册。
 *
 * `face: 'host'` 决定这一份只在宿主进程装载；`invocations` 与浏览器半边
 * 引用同一组描述符，因此两端看到的是同一份契约。`model` 只登记服务壳
 * （`members` / `types` 留空）：本服务的方法通过 Typert 调用描述符暴露，
 * 不生成模型工具集。
 */
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry/types';
export declare const TYPERT: TypertContribution;
export default TYPERT;
