/**
 * 引擎恢复预览（/shadow-rewind）的**共享 HTTP 层**：解码 + 分页拉全一次做完。
 *
 * 消息级（rewind.ts RewindDialog）与按轮级（审计面板「从快照恢复此轮」）
 * 两个恢复入口共用同一解码器与加载器；弹窗只保留各自的**就绪字段映射与文案**
 * 薄层，字段解析与翻页不重复。
 */
import { REWIND_BASE } from './client-http.ts'

/** 引擎恢复预览的目标寻址（消息 seq 或轮号，与端点 query 对应）。 */
export type RewindTargetQuery =
  | { readonly messageSeq: number }
  | { readonly turn: number }

/** 变更条目（归属徽标与净行数可选）。 */
export interface SharedPreviewChange {
  readonly path: string
  readonly kind: string
  readonly owner?: string
  readonly added?: number
  readonly removed?: number
}

/** 共享解码的完整预览（宽松超集；弹窗再各自收敛）。 */
export type SharedRewindPreview =
  | { readonly status: 'pending' }
  | { readonly status: 'missing' }
  | { readonly status: 'skipped'; readonly reason?: string }
  | { readonly status: 'failed'; readonly error?: string; readonly reason?: string }
  | {
    readonly status: 'ready'
    readonly sessionId?: string
    readonly messageSeq?: number
    readonly turn?: number
    readonly checkpointId?: string
    readonly workspace?: string
    readonly planId?: string
    readonly totalChanges: number
    readonly changes: readonly SharedPreviewChange[]
    readonly truncated: boolean
    readonly offset?: number
    readonly skippedPaths: readonly { path: string; reason: string }[]
  }

/** 非 ok 的预览请求（带宿主错误码）。 */
export class RewindPreviewHttpError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'RewindPreviewHttpError'
    this.code = code
  }
}

/** 宽松逐字段解码宿主预览响应；形状偏差一律退安全缺省，绝不抛。 */
export function decodeSharedRewindPreview(value: unknown): SharedRewindPreview {
  const record = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const status = record.status === 'ready' || record.status === 'pending'
    || record.status === 'skipped' || record.status === 'failed' || record.status === 'missing'
    ? record.status
    : 'missing'
  const changes: SharedPreviewChange[] = Array.isArray(record.changes)
    ? record.changes.map((entry) => {
      const item = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {}
      return {
        path: typeof item.path === 'string' ? item.path : '',
        kind: typeof item.kind === 'string' ? item.kind : 'modified',
        ...(typeof item.owner === 'string' ? { owner: item.owner } : {}),
        ...(typeof item.added === 'number' ? { added: item.added } : {}),
        ...(typeof item.removed === 'number' ? { removed: item.removed } : {}),
      }
    }).filter(change => change.path !== '')
    : []
  const skippedPaths = Array.isArray(record.skippedPaths)
    ? record.skippedPaths.map((entry) => {
      const item = typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        ? entry as Record<string, unknown>
        : {}
      return {
        path: typeof item.path === 'string' ? item.path : '',
        reason: typeof item.reason === 'string' ? item.reason : '',
      }
    }).filter(skip => skip.path !== '')
    : []
  if (status !== 'ready') {
    if (status === 'skipped') {
      return {
        status: 'skipped',
        ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      }
    }
    if (status === 'failed') {
      return {
        status: 'failed',
        ...(typeof record.error === 'string' ? { error: record.error } : {}),
        ...(typeof record.reason === 'string' ? { reason: record.reason } : {}),
      }
    }
    return status === 'pending' ? { status: 'pending' } : { status: 'missing' }
  }
  return {
    status,
    ...(typeof record.sessionId === 'string' ? { sessionId: record.sessionId } : {}),
    ...(typeof record.messageSeq === 'number' ? { messageSeq: record.messageSeq } : {}),
    ...(typeof record.turn === 'number' ? { turn: record.turn } : {}),
    ...(typeof record.checkpointId === 'string' ? { checkpointId: record.checkpointId } : {}),
    ...(typeof record.workspace === 'string' ? { workspace: record.workspace } : {}),
    ...(typeof record.planId === 'string' ? { planId: record.planId } : {}),
    totalChanges: typeof record.totalChanges === 'number' ? record.totalChanges : changes.length,
    changes,
    truncated: record.truncated === true,
    ...(typeof record.offset === 'number' ? { offset: record.offset } : {}),
    skippedPaths,
  }
}

async function getJson(response: Response, url: string): Promise<unknown> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    throw new RewindPreviewHttpError('REWIND_FAILED', `响应无效：${url}`)
  }
  if (!response.ok) {
    const record = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    const code = typeof record.code === 'string' ? record.code : 'REWIND_FAILED'
    const message = typeof record.error === 'string'
      ? record.error
      : `HTTP ${String(response.status)}`
    if (code === 'PLAN_STALE') {
      throw new RewindPreviewHttpError('PLAN_STALE', '恢复计划已过期，请重新检查。')
    }
    throw new RewindPreviewHttpError(code, message)
  }
  return value
}

function queryOf(sessionId: string, target: RewindTargetQuery, details = false, offset?: number): string {
  const targetPart = 'messageSeq' in target
    ? `messageSeq=${String(target.messageSeq)}`
    : `turn=${String(target.turn)}`
  const page = details && offset !== undefined ? `&details=1&offset=${String(offset)}&limit=200` : ''
  return `${REWIND_BASE}?sessionId=${encodeURIComponent(sessionId)}&${targetPart}${page}`
}

/**
 * 拉取一次完整预览：首页 →（ready + truncated）自动按页拉全合并——恢复总是
 * 整树，清单必须完整。非 ready 状态（pending/missing/skipped/failed）原样返回；
 * 分页中途 PLAN_STALE 以带码错误抛出，由弹窗映射。
 */
export async function fetchSharedRewindPreview(
  sessionId: string,
  target: RewindTargetQuery,
): Promise<SharedRewindPreview> {
  const firstResponse = await fetch(queryOf(sessionId, target), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  const firstValue = await getJson(firstResponse, queryOf(sessionId, target))
  const first = decodeSharedRewindPreview(firstValue)
  if (first.status !== 'ready' || !first.truncated) return first

  const collected = [...first.changes]
  let offset = collected.length
  while (first.totalChanges > offset) {
    const url = queryOf(sessionId, target, true, offset)
    const pageResponse = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
    const pageValue = await getJson(pageResponse, url)
    const page = decodeSharedRewindPreview(pageValue)
    if (page.status !== 'ready' || page.checkpointId !== first.checkpointId || page.offset !== offset) {
      throw new RewindPreviewHttpError('PLAN_STALE', '恢复计划已过期，请重新检查。')
    }
    collected.push(...page.changes)
    offset += page.changes.length
    if (page.changes.length === 0) break
  }
  return { ...first, changes: collected, truncated: false }
}
