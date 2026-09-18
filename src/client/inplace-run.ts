/**
 * 就地遮蔽回退·客户端运行通道：经宿主同源 HTTP 端点执行，命令面已移除
 * （回退入口只保留 live 条 / 消息旁回退按钮 / 审计面板三处，聊天流不再出现
 * 命令行）。端点同步执行（宿主侧完成打断等待 + 追加遮蔽标记），返回即结果。
 *
 * 通道事实（0.1.2 客户端服务面，结构类型）：
 *  - chat 快照：`ctx.get('uiConversation')` 的 `binding(sessionId).target('chat')`
 *    `getSnapshot()`（同名 chat 视图由 dsh-client-ui-chat 贡献）——遮蔽后的
 *    座位行隐藏由 rewind.ts 的 applyHiddenSeats 依快照刷新；
 *  - composer 写：`ctx.get('conversation').input.for(sessions.scope(id)).setDraft`。
 */
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import { REWIND_BASE } from './client-http.ts'
import { recordInplaceSpan } from './inplace-view.ts'

/** 最小 chat 视图面（getSnapshot，缺失返回 undefined）。 */
interface ChatViewLike {
  getSnapshot(): unknown
}

/** 最小 uiConversation 服务面。 */
interface UiConversationLike {
  binding(sessionId: string): { target(name: string): ChatViewLike | undefined }
}

/** 一次就地遮蔽的完整结果（HTTP 同步返回）。 */
export type InplaceMaskResult =
  | { readonly status: 'ok'; readonly marker: number; readonly text?: string }
  | { readonly status: 'error'; readonly text: string }

function ctxOf(ctx: unknown): { get?(name: string): unknown } {
  return (ctx ?? {}) as { get?(name: string): unknown }
}

/** 当前 chat 快照（无视图/会话消失 → undefined，绝不抛）。 */
export function chatSnapshotOf(ctx: unknown, sessionId: string): ChatSnapshot | undefined {
  try {
    const get = ctxOf(ctx).get
    if (get === undefined) return undefined
    const ui = get('uiConversation') as UiConversationLike | undefined
    if (ui === undefined) return undefined
    const view = ui.binding(sessionId)?.target('chat')
    const snapshot = view?.getSnapshot()
    return snapshot as ChatSnapshot | undefined
  } catch {
    return undefined
  }
}

/** 执行一次就地遮蔽（宿主 HTTP 端点）。结果以响应为准，网络失败归入 error。 */
export async function runInplaceMask(
  sessionId: string,
  targetSeq: number,
  signal?: AbortSignal,
): Promise<InplaceMaskResult> {
  try {
    const response = await fetch(`${REWIND_BASE}/inplace`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId, messageSeq: targetSeq }),
      ...(signal !== undefined ? { signal } : {}),
    })
    const value: unknown = await response.json().catch(() => null)
    const record = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {}
    if (!response.ok || record.status === 'error') {
      return {
        status: 'error',
        text: typeof record.text === 'string' && record.text !== ''
          ? record.text
          : `宿主拒绝就地回退（HTTP ${String(response.status)}）。`,
      }
    }
    if (record.status !== 'ok' || typeof record.markerSeq !== 'number') {
      return { status: 'error', text: '就地回退响应无效。' }
    }
    // 记录隐藏区间（持久化）：transcript 的座位行据此隐藏被撤回的历史。
    recordInplaceSpan(sessionId, targetSeq, record.markerSeq)
    return {
      status: 'ok',
      marker: record.markerSeq,
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
    }
  } catch (error) {
    return {
      status: 'error',
      text: error instanceof Error ? error.message : String(error),
    }
  }
}
