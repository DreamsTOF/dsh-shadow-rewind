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

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

export const PACKAGE_NAME = 'dsh-shadow-rewind'

/** 单个 hunk 的线上形状；起止行为可选（工具结果不保证给出）。 */
const diffSchema = z.object({
  path: z.string(),
  oldText: z.string().nullable(),
  newText: z.string(),
  oldStart: z.number().int().min(1).optional(),
  newStart: z.number().int().min(1).optional(),
})

/** 一次开关请求：方向 + 轮内文件清单。 */
const requestSchema = z.object({
  action: z.enum(['undo', 'redo']),
  files: z.array(z.object({ path: z.string(), diffs: z.array(diffSchema) })),
})

/** 结果侧：逐文件状态；`reason` 承载跳过 / 失败的原因文案。 */
const resultSchema = z.object({
  files: z.array(z.object({
    path: z.string(),
    state: z.enum(['applied', 'undone', 'conflict', 'unsupported', 'error']),
    changed: z.boolean(),
    reason: z.string().optional(),
  })),
})

/** 会话 id 按宿主的类型符号登记，走 lookup 从上下文注入（不经 JSON）。 */
const agentCodec = {
  mode: 'strict' as const,
  typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
  schema: z.intersection(z.string(), z.unknown()),
}

const requestCodec = {
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_NAME}#FileReviewRequest`,
  schema: requestSchema,
}

const resultCodec = {
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_NAME}#FileReviewResult`,
  schema: resultSchema,
}

/** 一条录制的 Code Mode 变更：根 call-id + 工具名 + 路径 + 前后全文。 */
const recordedMutationSchema = z.object({
  rootCallId: z.string(),
  name: z.string(),
  path: z.string(),
  before: z.string().nullable(),
  after: z.string(),
})

const recordedRequestSchema = z.object({
  rootCallIds: z.array(z.string()),
})

const recordedResultSchema = z.object({
  mutations: z.array(recordedMutationSchema),
})

const recordedRequestCodec = {
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_NAME}#RecordedRequest`,
  schema: recordedRequestSchema,
}

const recordedResultCodec = {
  mode: 'strict' as const,
  typeSymbol: `${PACKAGE_NAME}#RecordedResult`,
  schema: recordedResultSchema,
}

/** 组装 status / apply 描述符：两者签名同形，仅方法名不同。 */
function descriptor(method: 'status' | 'apply'): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#fileReview/${method}`,
    service: 'fileReview',
    namespace: 'fileReview',
    method,
    invocation: { kind: 'direct' },
    scope: { context: 'agent', wire: 'agentId' },
    parameters: [{
      name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: agentCodec,
    }, {
      name: 'request', wire: 'request', source: 'json', codec: requestCodec,
    }],
    result: resultCodec,
  }
}

/** 组装 `recorded` 描述符：与开关调用同作用域，但请求/结果是录制载荷。 */
function recordedDescriptor(): InvocationDescriptor {
  return {
    id: `${PACKAGE_NAME}#fileReview/recorded`,
    service: 'fileReview',
    namespace: 'fileReview',
    method: 'recorded',
    invocation: { kind: 'direct' },
    scope: { context: 'agent', wire: 'agentId' },
    parameters: [{
      name: 'agent', wire: 'agentId', source: 'lookup', lookup: 'agent', codec: agentCodec,
    }, {
      name: 'request', wire: 'request', source: 'json', codec: recordedRequestCodec,
    }],
    result: recordedResultCodec,
  }
}

/** 本包对外登记的调用集合：状态巡检、开关、录制读取。 */
export const FILE_REVIEW_INVOCATIONS: readonly InvocationDescriptor[] = [
  descriptor('status'),
  descriptor('apply'),
  recordedDescriptor(),
]
