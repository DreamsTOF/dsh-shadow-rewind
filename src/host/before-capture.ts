/**
 * 宿主适配层·BEFORE 捕获管道（主路捕获，抄 dsh-rewind 的 checkpoint 管道）。
 *
 * 三个钩子（与文件审查半边的 ptc 录制器同一张 cordis 事件表）：
 *  1. `tools/execute`（around-dispatch）：写类工具执行**前**读目标文件全文，
 *     存入 pending——放 here 而非 pre-execute：审批 ask 短路不会跳过本钩子，
 *     被拒绝的调用不会 dispatch（不留悬挂 pending）；
 *  2. `tools/post-execute`：工具成功（!result.isError 且未被否决）后提交，
 *     锚定到当前回合最新的 user/message seq；
 *  3. `tools/result`：兜底清理（工具体 throw 时 post-execute 可能被跳过）。
 *
 * 外加 `session/event`（global）的 user/message 边界重查：外部编辑/删除
 * （写类捕获的盲区）在每条用户消息落盘时补录 BEFORE。
 *
 * 与 dsh-rewind 的差异：内容走 shadow-rewind 引擎的 BEFORE 日志（内联 JSON，
 * 物化时才入 sqlite 内容库），路径解析用 node:fs + canonicalDirectory
 * （不引入 dsh-fs / dsh-sandbox 依赖）；子代理会话一律跳过。
 */
import { readFile, lstat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { canonicalDirectory } from '../path-utils.js'
import { errorMessage } from '../errors.js'
import type { ShadowRewindEngine } from '../engine.js'

/** 只跟踪真实的文件修改工具（同 dsh-rewind 白名单）。 */
const TRACKED_TOOLS = new Set(['write', 'edit', 'str_replace_editor'])
/** str_replace_editor 的变更型命令（view 等只读命令不跟踪）。 */
const MUTATING_EDITOR_COMMANDS = new Set(['create', 'str_replace', 'insert'])

/** 宿主工具瀑布的运行时形状（只消费，不发明依赖）。 */
interface ToolExecutionLike {
  readonly name: string
  readonly callId: string
  readonly arguments?: unknown
  readonly signal?: AbortSignal
  readonly agent?: {
    readonly id?: string
    readonly session?: {
      readonly id: string
      readonly header?: {
        readonly cwd?: string
        readonly origin?: unknown
        readonly delegationDepth?: number
      }
      readonly snapshotEvents?: () => readonly { readonly type: string; readonly seq: number }[]
    }
  }
}
interface ToolResultLike {
  readonly isError?: boolean
}
interface ToolDecisionLike {
  readonly kind: string
}

/** 一条等待提交的 BEFORE 捕获。 */
interface PendingCapture {
  readonly rel: string
  readonly existed: boolean
  readonly content: string | null
  readonly mode: number
}

/** 从工具参数解析目标路径（字段名随工具名分叉，同 dsh-rewind mutationPathOf）。 */
function mutationPathOf(exec: ToolExecutionLike): string | undefined {
  const args = (exec.arguments ?? {}) as { file_path?: unknown; path?: unknown; command?: unknown }
  if (exec.name === 'write' || exec.name === 'edit') {
    return typeof args.file_path === 'string' && args.file_path !== '' ? args.file_path : undefined
  }
  if (exec.name === 'str_replace_editor') {
    if (typeof args.command !== 'string' || !MUTATING_EDITOR_COMMANDS.has(args.command)) return undefined
    return typeof args.path === 'string' && args.path !== '' ? args.path : undefined
  }
  return undefined
}

/** 子代理会话不跟踪（对齐 Claude Code；宿主恢复围栏也只按主会话工作区）。 */
function isSubagent(header: { readonly origin?: unknown; readonly delegationDepth?: number } | undefined): boolean {
  return header !== undefined
    && (header.origin === 'subagent' || (header.delegationDepth ?? 0) > 0)
}

/** anchor：当前回合最新 user/message 的事件 seq（增量缓存，同 dsh-rewind）。 */
interface AnchorCacheEntry {
  readonly anchor: number | undefined
  readonly eventsLength: number
}

function anchorSeqOf(
  session: NonNullable<ToolExecutionLike['agent']>['session'],
  cache: WeakMap<object, AnchorCacheEntry>,
): number | undefined {
  const events = session?.snapshotEvents?.()
  if (events === undefined) return undefined
  const cached = cache.get(session as object)
  if (cached !== undefined && cached.eventsLength === events.length) return cached.anchor
  let anchor = cached?.anchor
  for (let i = events.length - 1; i >= (cached?.eventsLength ?? 0); i--) {
    const event = events[i]
    if (event !== undefined && event.type === 'user/message') {
      anchor = event.seq
      break
    }
  }
  cache.set(session as object, { anchor, eventsLength: events.length })
  return anchor
}

function pendingKey(exec: ToolExecutionLike): string {
  return `${exec.agent?.id ?? 'anon'}:${exec.callId}`
}

export interface BeforeCaptureRuntime {
  readonly pending: Map<string, PendingCapture>
  readonly anchorCache: WeakMap<object, AnchorCacheEntry>
  readonly workspaceCache: Map<string, string | undefined>
}

/**
 * 装配 BEFORE 捕获管道。幂等性由调用方（插件入口的一次性 apply）保证。
 * 捕获/提交的任何失败都只记警告、绝不拦截工具执行——捕获是尽力而为的
 * 安全网，不是工具的前置闸。
 */
export function installBeforeCapture(ctx: unknown, engine: ShadowRewindEngine): void {
  const pending = new Map<string, PendingCapture>()
  const anchorCache = new WeakMap<object, AnchorCacheEntry>()
  const workspaceCache = new Map<string, string | undefined>()

  /** 会话工作区（canonical realpath，与引擎 manifest 的路径空间一致）。 */
  const workspaceOf = async (session: NonNullable<ToolExecutionLike['agent']>['session']): Promise<string | undefined> => {
    const sessionId = session?.id
    if (sessionId === undefined) return undefined
    const cached = workspaceCache.get(sessionId)
    if (cached !== undefined) return cached
    const cwd = session?.header?.cwd
    if (cwd === undefined) {
      workspaceCache.set(sessionId, undefined)
      return undefined
    }
    const workspace = await canonicalDirectory(cwd).catch(() => undefined)
    workspaceCache.set(sessionId, workspace)
    return workspace
  }

  const captureBefore = async (exec: ToolExecutionLike): Promise<void> => {
    if (!TRACKED_TOOLS.has(exec.name)) return
    const session = exec.agent?.session
    if (isSubagent(session?.header)) return
    const rawPath = mutationPathOf(exec)
    if (rawPath === undefined) return
    const workspace = await workspaceOf(session)
    if (workspace === undefined) return
    // 相对路径相对会话工作区解析（镜像 fs 工具规则）；绝对路径原样采纳。
    const abs = isAbsolute(rawPath) ? rawPath : resolve(workspace, rawPath)
    const rel = relative(workspace, abs).split(sep).join('/')
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return // 工作区外：恢复围栏够不着，放弃
    let existed = true
    let content: string | null = null
    let mode = 0o644
    try {
      const stat = await lstat(abs)
      if (!stat.isFile()) return // 目录/符号链接不进 BEFORE 日志（恢复围栏同口径）
      // 与 scan/capture 同一 mode 口径（原始权限位；Windows 的 POSIX 位
      // 不可靠，恢复/校验路径本就跳过它）——口径一致 undo CAS 才不会假冲突。
      mode = Number(stat.mode & 0o7777)
      content = await readFile(abs, 'utf8')
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ENOENT')) return
      existed = false // ENOENT = 该次调用创建文件
    }
    pending.set(pendingKey(exec), { rel, existed, content, mode })
  }

  const commitEntry = async (exec: ToolExecutionLike, result: ToolResultLike): Promise<void> => {
    const key = pendingKey(exec)
    const capture = pending.get(key)
    pending.delete(key) // 先删：无论成败都不残留
    if (capture === undefined) return
    if (result?.isError === true) return // 工具失败不提交（磁盘没变）
    const session = exec.agent?.session
    if (session === undefined) return
    const anchorSeq = anchorSeqOf(session, anchorCache)
    if (anchorSeq === undefined || !Number.isSafeInteger(anchorSeq)) return
    const workspace = await workspaceOf(session)
    if (workspace === undefined) return
    await engine.recordBeforeEntry({
      workspace,
      sessionId: session.id,
      anchorSeq,
      callId: exec.callId,
      rel: capture.rel,
      existed: capture.existed,
      content: capture.content,
      mode: capture.mode,
    })
  }

  const emitter = ctx as {
    on(event: string, listener: (...args: never[]) => unknown, options?: unknown): () => void
    logger?: { warn?(message: string): void }
  }
  const warn = (message: string): void => {
    try {
      emitter.logger?.warn?.(message)
    } catch {
      // logger 缺席时静默（捕获失败已经不拦截主流程）
    }
  }

  emitter.on('tools/execute', async (exec: ToolExecutionLike, next: () => Promise<unknown>): Promise<unknown> => {
    try {
      await captureBefore(exec)
    } catch (error) {
      warn(`[dsh-shadow-rewind] before-capture failed for ${exec.name}: ${errorMessage(error)}`)
    }
    return next()
  })

  emitter.on('tools/post-execute', async (
    exec: ToolExecutionLike,
    result: ToolResultLike,
    next: () => Promise<ToolDecisionLike>,
  ): Promise<ToolDecisionLike> => {
    const decision = await next()
    if (decision.kind !== 'accept') return decision
    try {
      await commitEntry(exec, result)
    } catch (error) {
      warn(`[dsh-shadow-rewind] before-capture commit failed for ${exec.name}: ${errorMessage(error)}`)
    }
    return decision
  })

  emitter.on('tools/result', (exec: ToolExecutionLike): undefined => {
    pending.delete(pendingKey(exec))
    return undefined
  })

  // user/message 边界重查（global）：外部编辑/删除补 BEFORE 记录。
  emitter.on('session/event', (session: NonNullable<ToolExecutionLike['agent']>['session'], event: { readonly type: string; readonly seq: number }): undefined => {
    if (event?.type !== 'user/message') return
    if (isSubagent(session?.header)) return
    const sessionId = session?.id
    if (sessionId === undefined) return
    void (async () => {
      try {
        const workspace = await workspaceOf(session)
        if (workspace === undefined) return
        await engine.reconcileTrackedBefore({ workspace, sessionId, anchorSeq: event.seq })
      } catch (error) {
        warn(`[dsh-shadow-rewind] boundary re-check failed: ${errorMessage(error)}`)
      }
    })()
    return undefined
  }, { global: true })
}
