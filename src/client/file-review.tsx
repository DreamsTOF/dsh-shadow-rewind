/**
 * 文件审查面，浏览器半边（自 dsh-file-review-tab 移植）：
 *
 * 1. 会话累计 live 条（conversation.input.dock）：文件变更读数 + 行内撤销
 *    + 「审查」入口（打开 AuditOverlay 全屏审查界面）；
 * 2. 文件审查全屏界面（AuditOverlay → FileReviewTab）：逐轮 diff +
 *    按 hunk / 按文件 / 按轮撤销 + 每轮快照恢复（原 better-sidebar tab 移除
 *    后的新家，外壳换成模态对话框）。
 *
 * 宿主半边的撤销 / 重做能力经本包的 Typert 远端贡献抵达两个面，装配方式与
 * dsh-file-review 完全一致。每一处注册都包在 `ctx.effect` 里，fiber 销毁
 * （HMR / 插件禁用）即干净注销。由合并后的客户端入口（index.tsx）与 rewind
 * 面一同挂载。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatFileMentions } from '@deepseek-ai/dsh-client-ui-chat/client'
import { LiveChangesBar, bindLiveBarSessions, bindLiveBarContext } from './live-bar.tsx'
import { attachLocale, en, LOCALE_NS, zh } from './locales.ts'
import {
  en as chatEn, NS as CHAT_NS, zh as chatZh, type DeliverablesKey,
} from './chat-locales.ts'
import {
  deliverablesDefinition, producedFileMentions, selectProducedFiles,
} from './turn-deliverables.ts'
import { disposeFileReviewRemote, mountFileReviewRemote } from './remote-access.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 聊天侧 UI 面文案（live 条）。 */
    'file-review': DeliverablesKey
  }
}

/**
 * 必需服务：会话快照、locale、remote 与槽位注册表（轮尾链）。conversation
 * Definition 注册表**刻意不做静态注入**，而是在 apply() 里动态解析：
 * conversation Definition 注册表的服务名随 dsh 版本迁移过（<= 0.1.1 是根
 * `conversationEvents`，0.1.2-alpha.1+ 是 `uiConversation.events`），硬注入
 * 任何一个名字都会让整个插件在另一个版本上永远「pending」并拖垮 web 启动
 * （issue #6）。
 */
export const fileReviewInject = [
  'sessions',
  'locale',
  'remote',
  'slots',
]

/**
 * Read a cordis service without the inject requirement（新版 cordis 走
 * `ctx.get`，旧版回落 reflect.get）。
 */
function getService(ctx: Context, name: string): unknown {
  const anyCtx = ctx as unknown as { get?: (name: string) => unknown }
  if (typeof anyCtx.get === 'function') return anyCtx.get(name)
  return ctx.reflect.get(name)
}

/**
 * 本插件需要的 conversation Definition 注册表面：只有按轮注册 deliverables
 * 这一件事。各 dsh 版本上形状相同——变的只是抵达它的服务路径。
 */
interface ConversationDefinitionRegistry {
  register(definition: typeof deliverablesDefinition): () => void
}

/**
 * 不静态注入、动态解析 conversation Definition 注册表。
 * dsh 0.1.2-alpha.1+ 把旧的 `conversationEvents` / `conversationViews` 对折
 * 进单一 `uiConversation` 服务（注册表在其 `.events` 属性上）；dsh 0.1.1 及
 * 更早则暴露为独立的根 `conversationEvents` 服务。运行的 dsh 两者都不提供时
 * 返回 undefined——调用方优雅降级而非阻塞。
 */
function resolveConversationEvents(ctx: Context): ConversationDefinitionRegistry | undefined {
  const uiConversation = getService(ctx, 'uiConversation') as
    | { readonly events?: ConversationDefinitionRegistry | null }
    | undefined
  if (uiConversation?.events !== undefined && uiConversation.events !== null) return uiConversation.events
  const conversationEvents = getService(ctx, 'conversationEvents') as ConversationDefinitionRegistry | undefined
  if (conversationEvents !== undefined && conversationEvents !== null) return conversationEvents
  return undefined
}

/**
 * 客户端插件主体：挂 locale、装载 Typert remote、注册 live 条与文件提及。
 * @param ctx - 客户端根上下文。
 */
export function applyFileReview(ctx: Context): void {
  attachLocale(ctx.locale)
  ctx.effect(() => {
    const offZh = ctx.locale.register(LOCALE_NS, 'zh', zh)
    const offEn = ctx.locale.register(LOCALE_NS, 'en', en)
    return () => { offZh(); offEn() }
  }, 'shadow-rewind: tab dictionaries')

  ctx.effect(
    () => ctx.locale.register(CHAT_NS, { zh: chatZh, en: chatEn }),
    'shadow-rewind: chat dictionaries',
  )

  // Typert 远端贡献挂载：幂等任务收拢在 remote-access（失败可重试；访问侧
  // 的弹性解析会在首次调用时自动重挂一次）。挂载错误在此留痕。
  ctx.effect(() => {
    mountFileReviewRemote(ctx).catch((error: unknown) => {
      console.error('[dsh-shadow-rewind] remote mount error:', error)
    })
    return () => { disposeFileReviewRemote() }
  }, 'shadow-rewind: typert remote')

  // 行文提及词汇与 live 条都派生自本 Definition 发布的 'deliverables' Turn
  // 数据。注册到运行时 dsh 暴露的任一 conversation 注册表（见
  // resolveConversationEvents）；所属服务被（重新）提供或替换时重注册；
  // 一个都不暴露的 dsh 上整个跳过——live 条从会话快照派生，没有它也能继续
  // 工作。
  let registeredOn: ConversationDefinitionRegistry | undefined
  const registerDeliverables = (): void => {
    const events = resolveConversationEvents(ctx)
    if (events === undefined || events === registeredOn) return
    registeredOn = events
    ctx.effect(
      () => events.register(deliverablesDefinition),
      'shadow-rewind: deliverables definition',
    )
  }
  registerDeliverables()
  ctx.on('internal/service', (name: string) => {
    if (name === 'conversationEvents' || name === 'uiConversation') registerDeliverables()
  })

  // 会话累计 live 条：输入卡上方那一行环境座位。轮中实时读数，轮结束/空闲后
  // 继续展示会话仍生效的累计改动（回滚后自适应扣减，见 live-bar.tsx）。
  // dock 座位没有 inject 面，所以会话句柄与客户端上下文在这里绑定一次
  // （行内撤销与新界面都经上下文调宿主服务）。
  bindLiveBarSessions((ctx as unknown as { readonly sessions: ISessions }).sessions)
  bindLiveBarContext(ctx)
  ctx.effect(
    () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'shadow-rewind-live',
      locale: CHAT_NS,
      registrant: 'dsh-shadow-rewind',
    }, LiveChangesBar),
    'shadow-rewind: live changes bar',
  )

  // 同一词汇的行文侧：聊天视图经 ctx.get 抵达这个面，所以它的缺席——本插件
  // 被移出装配——就是关闭态。
  ctx.effect(() => {
    const tChat = ctx.locale.bind(CHAT_NS)
    const mentions: ChatFileMentions = {
      forClosing(owner) {
        // 与轮尾链条目跑同一个认领判定：没有产出文件就没有提及词汇——
        // 两个面在构造上就保持一致。
        const reviews = selectProducedFiles(owner)
        if (reviews === null) return undefined
        return producedFileMentions(
          reviews.map(review => review.path),
          owner.openFile,
          path => tChat('produced.open', { name: path }),
        )
      },
    }
    return ctx.provide('chatFileMentions', mentions)
  }, 'shadow-rewind: chat file mentions')
}
