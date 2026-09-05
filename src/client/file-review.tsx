/**
 * 文件审查面，浏览器半边（自 dsh-file-review-tab 移植）：在**同一套产出文件
 * 词汇**上共存的两块 UI——
 *
 * 1. 聊天轮尾行（原始 dsh-file-review 卡片：「已编辑 N 个文件 · +M -K /
 *    撤销 / 审查」），注册在 `conversation.chat.turnTail` 链的 priority -2，
 *    以便**先于** dsh-better-sidebar 自己的 -1 拦截行认领链（链的选举规则是
 *    先到先得：任一时刻只有一行渲染，绝不两行并现）；
 * 2. `file-review` better-sidebar tab（按会话的变更列表 + 行级红/绿 diff +
 *    按 hunk / 按文件 / 按轮撤销，外加按轮做 jj 快照恢复）。
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
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatFileMentions, ChatSnapshot, TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { BetterSidebarService, TabDescriptor } from 'dsh-better-sidebar/client/service'
import type { FileReviewRequest, FileReviewResult, ProducedFileReview } from '../file-review/change-types.ts'
import { TYPERT_REMOTE } from '../file-review/remote.ts'
import { FileReviewTab } from './FileReviewTab.tsx'
import { ProducedFiles } from './ProducedFiles.tsx'
import { LiveChangesBar, bindLiveBarSessions, bindLiveBarOpenSidebar } from './live-bar.tsx'
import { attachLocale, en, LOCALE_NS, t, zh } from './locales.ts'
import {
  en as chatEn, NS as CHAT_NS, zh as chatZh, type DeliverablesKey,
} from './chat-locales.ts'
import { countChangedFiles, deriveSessionChanges } from './session-changes.ts'
import { cachedFsTurnFor, warmFsChanges } from './fs-diff-utils.ts'
import { dedupeStatus } from './status-dedupe.ts'
import {
  deliverablesDefinition, producedFileMentions, selectProducedFiles,
} from './turn-deliverables.ts'

/**
 * 带文件系统感知的轮尾认领：工具产出的审查照旧认领；而一轮的写盘只发生在
 * 工具之外（PowerShell 等）时，只要 warm 过的 fs-changes 缓存已经知道该轮
 * （键是每会话唯一的 turn/start seq），就用**空 match** 认领——挂载后的卡片
 * 自行拉取内容填满自己。select() 是同步的，异步端点的结果只能经由这个缓存
 * 抵达。
 */
function selectProducedFilesWithFs(owner: TurnTailOwnerProps): readonly ProducedFileReview[] | null {
  const reviews = selectProducedFiles(owner)
  if (reviews !== null) return reviews
  const startSeq = owner.turn.start?.seq
  if (startSeq !== undefined && cachedFsTurnFor(startSeq)?.turn === owner.turn.turn) return []
  return null
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 轮尾行文案（聊天侧的 UI 面）。 */
    'file-review': DeliverablesKey
  }
}

/**
 * 必需服务：会话快照、locale、remote 与槽位注册表（轮尾链）。另外两个服务
 * **刻意不做静态注入**，而是在 apply() 里动态解析：conversation Definition
 * 注册表的服务名随 dsh 版本迁移过（<= 0.1.1 是根 `conversationEvents`，
 * 0.1.2-alpha.1+ 是 `uiConversation.events`），硬注入任何一个名字都会让整个
 * 插件在另一个版本上永远「pending」并拖垮 web 启动（issue #6）；而
 * `betterSidebar` 只由**可选**的 dsh-better-sidebar 插件提供——硬注入会让本
 * 插件在没装它的宿主上永远等待，而 rewind / live 条 / 轮尾行这些面都能
 * 独立工作。
 */
export const fileReviewInject = [
  'sessions',
  'locale',
  'remote',
  'slots',
]

/** Tab 图标：按宿主给的大小画的一个朴素行 diff 字形。 */
function FileReviewIcon({ size }: { readonly size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.25 2.75h6l3.5 3.5v10a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1V3.75a1 1 0 0 1 1-1Z" />
      <path d="M11.25 2.75v3.5h3.5" />
      <path d="M7 10h2.5M10.5 10H12M7 13h5" />
    </svg>
  )
}

interface FileReviewRemote {
  status(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
  apply(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
}

/**
 * Tab 条徽标：本会话改过的不重复文件数。
 * 侧边栏的 tab 条几乎总在重渲染（而且事件流每个事件都发布新快照引用），所以
 * 推导结果按每会话一个廉价的**结构指纹**记忆化——token 流刷新时指纹保持稳定，
 * 直接跳过完整重推导。
 */
const badgeMemo = new Map<string, { fingerprint: string; count: number | null }>()

function snapshotFingerprint(snapshot: ChatSnapshot | null): string {
  if (snapshot === null) return 'none'
  const legacy = snapshot.legacy
  let lastEnd = 0
  for (const endSeq of legacy.turnEnds.values()) lastEnd = endSeq
  return `${legacy.nodes.length}:${legacy.turnEnds.size}:${lastEnd}`
}

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
 * Resolve one session's Chat target snapshot（dsh 0.1.2：会话变更推导的数据
 * 源从 runtime 会话快照换成 uiConversation 会话绑定的 `chat` 视图快照）。
 * uiConversation 缺失（未装配的宿主）返回 null——徽标降级为空。
 */
function resolveChatSnapshot(ctx: Context, sessionId: string): ChatSnapshot | null {
  const uiConversation = getService(ctx, 'uiConversation') as
    | { binding?(source: string): { target?(target: 'chat'): { getSnapshot?(): ChatSnapshot | undefined } } }
    | undefined
  const binding = uiConversation?.binding?.(sessionId)
  const chat = binding?.target?.('chat')?.getSnapshot?.()
  return chat ?? null
}

function badgeCount(ctx: Context, sessionId: string): number | null {
  // 搭车预热 fs-changes 缓存：tab 条渲染高频且覆盖所有会话，warm 内部节流。
  warmFsChanges(sessionId)
  // Host 与浏览器的 sessions 服务共用一个 Cordis 键（见 dsh-file-review）：
  // 在这个边界收窄到浏览器的 ISessions。
  const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
  // 先物化会话绑定（scope 树挂载），chat 目标快照才有数据源。
  void sessions.binding(sessionId as SessionId)
  const snapshot = resolveChatSnapshot(ctx, sessionId)
  const fingerprint = snapshotFingerprint(snapshot)
  const hit = badgeMemo.get(sessionId)
  if (hit !== undefined && hit.fingerprint === fingerprint) return hit.count
  const count = countChangedFiles(deriveSessionChanges(snapshot))
  const value = count === 0 ? null : count
  badgeMemo.set(sessionId, { fingerprint, count: value })
  return value
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
 * 不静态注入、动态解析 better-sidebar 注册表：`betterSidebar` 只由**可选**的
 * dsh-better-sidebar 插件发布，而本插件必须能在没有它的宿主上启动
 * （rewind / live 条 / 轮尾行都能独立运行）。插件缺席时返回 undefined——每个
 * 调用方都优雅降级而非阻塞。
 */
function resolveBetterSidebar(ctx: Context): BetterSidebarService | undefined {
  const sidebar = getService(ctx, 'betterSidebar') as BetterSidebarService | undefined
  if (sidebar === undefined || sidebar === null) return undefined
  return sidebar
}

/**
 * 客户端插件主体：挂 locale、装载 Typert remote、注册聊天轮尾行与侧边栏 tab。
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

  ctx.effect(() => {
    let disposed = false
    let disposeRemote: (() => Promise<void>) | undefined
    void ctx.remote.$mount(TYPERT_REMOTE).then((dispose) => {
      if (disposed) void dispose()
      else disposeRemote = dispose
    }).catch((error: unknown) => {
      console.error('[dsh-shadow-rewind] remote mount error:', error)
    })
    return () => {
      disposed = true
      if (disposeRemote !== undefined) void disposeRemote()
    }
  }, 'shadow-rewind: typert remote')

  // 两个聊天侧 UI 面都在读这个轮内变更累积器：轮尾行的 select() 与行文提及
  // 词汇都派生自本 Definition 发布的 'deliverables' Turn 数据。注册到运行时
  // dsh 暴露的任一 conversation 注册表（见 resolveConversationEvents）；所属
  // 服务被（重新）提供或替换时重注册；一个都不暴露的 dsh 上整个跳过——侧边栏
  // tab 从会话快照派生，没有它也能继续工作。
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

  // 聊天轮尾行——原版 dsh-file-review 卡片，逐字移植。
  // priority -2 先于 dsh-better-sidebar 的 -1 拦截行执行：链的选举规则是
  // 按优先级升序先到先得，所以这一行渲染、侧边栏的 chip 行就放弃（绝不双行）。
  // 本插件被移出装配时，-1 行（或宿主回退）重新接管——关闭态在此无需清理。
  //
  // dsh 0.1.2：链槽位的 inject 为零参工厂（会话身份由组件标准 props
  // sessionId 提供），因此这里的回调全部以 sessionId 为首参。
  ctx.effect(
    () => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectProducedFilesWithFs,
      priority: -2,
      locale: CHAT_NS,
      registrant: 'dsh-shadow-rewind',
      inject: () => {
        const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
        const projectRootFor = (id: string): string | undefined =>
          sessions.list.getSnapshot().byId[id as SessionId]?.cwd
        const invoke = async (
          id: string,
          method: 'status' | 'apply',
          request: FileReviewRequest,
        ): Promise<FileReviewResult> => {
          const scope = sessions.scope(id as SessionId)
          if (scope === undefined) throw new Error('Session is unavailable')
          // 会话 scope 会铸造自己的 Remote 面：带作用域的命名空间乘在 scope 的
          // `remote` 上（agent 标签路由，Tracing 绑定本会话）。
          const fileReview = scope.remote.fileReview as FileReviewRemote | undefined
          if (fileReview === undefined) throw new Error('File review Remote is unavailable')
          const result = await fileReview[method](request)
          if (!result.ok) throw new Error(result.error.message)
          return result.value
        }
        return {
          projectRootFor,
          // status 巡检在传输层做 in-flight 去重（同会话同请求只发一次）；
          // apply 有副作用，绝不参与去重。
          inspectChanges: (id: string, request: FileReviewRequest) => dedupeStatus(id, request, (bound) => invoke(id, 'status', bound)),
          applyChanges: (id: string, request: FileReviewRequest) => invoke(id, 'apply', request),
          // 审查 button / per-file chip：用这些预展开路径打开（或聚焦）侧边栏
          // tab。updateTab 先跑：已经打开的 tab 在这里收到新的 meta 引用（tab
          // 据此重放展开），而下面的 openTab 对已存在的 tab 只**聚焦**、绝不把
          // seed 的 meta 套上去（见 sidebar 服务的 openTab：meta 只在创建时落
          // 地）。对尚未打开的 tab，updateTab 是严格空操作，openTab 则**带着**
          // meta 创建 tab。之后 activateTab 无论如何保证聚焦。
          // `path` 只是顺带传上，好让宿主把它当成一次**内容**打开：折叠中的
          // 侧栏会自动展开把 tab 带进视野（纯类型打开不会动折叠面板）。tab
          // 本身从不读 tab.path。
          openInSidebarTab: (id: string, paths: readonly string[], turn?: number) => {
            const sidebar = resolveBetterSidebar(ctx)
            const first = paths[0]
            if (sidebar === undefined || first === undefined) return
            // `turn` 把深链锚定到某一轮：tab 只为这些路径展开**那一轮**的行
            // （反复出现的路径在其它轮保持折叠）。
            const meta = { expandPaths: [...paths], ...(turn !== undefined ? { turn } : {}) }
            const projectRoot = projectRootFor(id)
            const scope = { sessionId: id, ...(projectRoot !== undefined ? { cwd: projectRoot } : {}) }
            sidebar.updateTab('file-review', { meta })
            sidebar.openTab({ type: 'file-review', path: first, meta }, scope)
            sidebar.activateTab('file-review', scope)
          },
        }
      },
    }, ProducedFiles)),
    'shadow-rewind: turn-tail row',
  )

  // 轮子进行时的 live 读数：输入卡上方那一行环境座位。空闲或没改动时不渲染
  // 任何东西；轮一结束，轮尾卡片接管。dock 座位没有 inject 面，所以会话句柄
  // （供 cwd 查询）在这里绑定一次。
  bindLiveBarSessions((ctx as unknown as { readonly sessions: ISessions }).sessions)
  bindLiveBarOpenSidebar((sessionId, paths, turn) => {
    const sidebar = resolveBetterSidebar(ctx)
    const first = paths[0]
    if (sidebar === undefined || first === undefined) return
    const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
    const projectRoot = sessions.list.getSnapshot().byId[sessionId as SessionId]?.cwd
    const meta = { expandPaths: [...paths], ...(turn !== undefined ? { turn } : {}) }
    const scope = { sessionId, ...(projectRoot !== undefined ? { cwd: projectRoot } : {}) }
    sidebar.updateTab('file-review', { meta })
    sidebar.openTab({ type: 'file-review', path: first, meta }, scope)
    sidebar.activateTab('file-review', scope)
  })
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

  // 侧边栏 tab 只在**可选**的 dsh-better-sidebar 插件存在时才有意义：注册到
  // 任何出现的服务实例上（见 resolveBetterSidebar），它之后被（重新）提供时
  // 再注册一次；没装它的宿主上整体跳过——其余每个面都继续工作。
  let tabRegisteredOn: BetterSidebarService | undefined
  const registerSidebarTab = (): void => {
    const sidebar = resolveBetterSidebar(ctx)
    if (sidebar === undefined || sidebar === tabRegisteredOn) return
    tabRegisteredOn = sidebar
    ctx.effect(() => sidebar.registerTab({
      id: 'file-review',
      title: () => t('tabTitle'),
      icon: (size: number) => <FileReviewIcon size={size} />,
      order: 35,
      single: true,
      badge: (badgeCtx, scope) => badgeCount(badgeCtx as unknown as Context, scope.sessionId),
      component: ({ ctx: tabCtx, scope, visible, tab }) => (
        <FileReviewTab
          ctx={tabCtx as unknown as Context}
          sessionId={scope.sessionId}
          cwd={scope.cwd}
          visible={visible}
          tab={tab}
        />
      ),
    } satisfies TabDescriptor), 'shadow-rewind: register tab')
  }
  registerSidebarTab()
  ctx.on('internal/service', (name: string) => {
    if (name === 'betterSidebar') registerSidebarTab()
  })
}
