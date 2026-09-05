/**
 * 宿主与浏览器两份贡献产物共用的严格 Typert 编解码器与调用描述符。
 *
 * 为什么必须共用同一份：两端的线上词汇表一旦漂移，就会在运行时才炸。这里
 * 用 zod 把请求 / 结果 / 录制载荷全部收紧（`mode: 'strict'`，多余字段直接
 * 拒绝），描述符 + `typeSymbol` 一起导出，宿主 `./typert` 与浏览器
 * `./remote` 两个入口引用同一组常量。
 *
 * 注意：编解码器是**线上契约**，改动等于改协议——新增字段一律可选，避免
 * 旧 bundle 与新宿主互相判对方非法。
 */
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol';
export declare const PACKAGE_NAME = "dsh-shadow-rewind";
/** 本包对外登记的调用集合：状态巡检、开关、录制读取。 */
export declare const FILE_REVIEW_INVOCATIONS: readonly InvocationDescriptor[];
