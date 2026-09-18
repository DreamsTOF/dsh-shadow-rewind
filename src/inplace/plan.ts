/**
 * 就地遮蔽回退（in-place rewind）·纯规划层。
 *
 * 从 dsh-rewind 的 src/rewind.ts 移植的最小逻辑单元，语义不变：
 *  回退到某条用户消息 = 向会话日志追加一条「空 user/message」标记节点，其
 *  surfaceOp 用 replace 把「目标消息及之后全部 surface 节点」替换为它自己
 *  （模型上下文与渲染对话自此只看到目标之前；被遮蔽 seq 经 sourceEventSeqs
 *  引用，日志本身 append-only 不动）。
 *
 * 为什么是「空 user/message」而不是 assistant/message：v2 里 surface replace
 *  只允许替换节点自己带 sourceEventSeqs，assistant/message 已内嵌 provider
 *  stream 不能再带；与 /compact 检查点同型。空内容不携带任何语言，不污染模型
 *  输入；token-meter 的 step 状态机忽略 user/message，idle 时在回合外追加
 *  不需要幽灵 step/start…end 帧。
 *
 * 本层无 I/O、不依赖 Session——全部从事件日志与有序 surface 派生，可单测。
 */
import type { ShadowRewindError } from '../errors.js'

/** 就地回退的目标消息（目前只回退对话；文件恢复由引擎既有路径承担）。 */
export interface InPlaceTargetLike {
  readonly seq: number
  readonly type?: string
  readonly data?: {
    readonly source?: { readonly kind?: unknown }
    readonly content?: readonly unknown[]
  }
}

/** 校验通过的回退计划：目标 + 需要遮蔽的精确 surface 区间。 */
export interface InPlacePlan {
  readonly targetSeq: number
  readonly targetIndex: number
  /** 目标及之后全部 surface 节点 seq（含目标，时间旅行语义）。 */
  readonly shadowedSeqs: readonly number[]
  readonly surfaceStart: number
  readonly surfaceEnd: number
}

export interface InPlacePlanOptions {
  readonly events: readonly InPlaceTargetLike[]
  /** 有序 surface 节点 seq（`session.surface.nodes`）。 */
  readonly surface: readonly number[]
  readonly targetSeq: number
}

/** 是否是直发用户消息（source.kind==='user'）。注入 context / compact 检查点 /
 * 工具回填都以非 'user' source 到达 user/message，绝不能作为回退边界。 */
export function isHumanUserMessage(event: InPlaceTargetLike): boolean {
  return event.type === 'user/message'
    && event.data?.source?.kind === 'user'
    && typeof event.seq === 'number'
    && Number.isSafeInteger(event.seq)
}

/** 期望的失败码，映射到简洁的用户文案。 */
export type InPlaceErrorCode =
  | 'NO_USER_MESSAGES'
  | 'NOT_A_USER_MESSAGE'
  | 'NOT_ON_SURFACE'

/** 就地回退规划的失败。 */
export class InPlacePlanError extends Error {
  constructor(
    readonly code: InPlaceErrorCode,
    message: string,
    options?: { readonly cause?: unknown },
  ) {
    super(message, options)
    this.name = 'InPlacePlanError'
  }
}

/**
 * 校验一个目标 seq 并计算遮蔽区间。
 * 规则：目标必须是直发用户消息且仍在 surface 上；遮蔽区间**含目标**及其后
 * 全部 surface 节点（时间旅行：回退到该消息之前，其内容回填 composer 供重发）。
 */
export function planInPlace(options: InPlacePlanOptions): InPlacePlan {
  const { events, surface, targetSeq } = options
  const targetEvent = events.find(event => event.seq === targetSeq)
  if (targetEvent === undefined || !isHumanUserMessage(targetEvent)) {
    throw new InPlacePlanError(
      'NOT_A_USER_MESSAGE',
      `seq ${String(targetSeq)} 不是可回退的直发用户消息`,
    )
  }
  const targetIndex = surface.indexOf(targetSeq)
  if (targetIndex === -1) {
    throw new InPlacePlanError(
      'NOT_ON_SURFACE',
      `seq ${String(targetSeq)} 已被 compact 遮蔽，不在模型上下文里`,
    )
  }
  const shadowedSeqs = surface.slice(targetIndex)
  if (shadowedSeqs.length === 0) {
    // 理论上 targetIndex 合法即有至少一个；防御性兜底。
    throw new InPlacePlanError('NOT_ON_SURFACE', 'surface 区间为空，无法回退')
  }
  return {
    targetSeq,
    targetIndex,
    shadowedSeqs,
    surfaceStart: shadowedSeqs[0] as number,
    surfaceEnd: shadowedSeqs[shadowedSeqs.length - 1] as number,
  }
}

/**
 * 全部失败码里没有任何子面需要复用 ShadowRewindError 的标识；保留类型引用
 * 仅为将来 host 命令把规划错误统一包装成用户可见 code 时用。这里仅用作
 * 文档锚点（不抛 ShadowRewindError）。
 */
export type InPlaceErrorLike = ShadowRewindError | InPlacePlanError
