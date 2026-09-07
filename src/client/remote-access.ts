/**
 * fileReview 远端命名空间的弹性访问层。
 *
 * 背景（inject 故障的根因）：客户端每个 Typert 命名空间是 cordis 服务
 * `remote.<namespace>`（api-gateway 的 RemoteNamespaceService 以此键注册），
 * `scope.remote.fileReview` 经 cordis traceable 代理解析该组合键——命名空间
 * 挂载丢失（`$mount` 失败 / fiber 被卸载）而声明仍在时，cordis 抛出
 * `cannot get property "remote.fileReview" without inject`。这里把「挂载」
 * 与「访问」收拢成一处：挂载幂等可重试；访问失败自动重挂一次再试，
 * 并把不可恢复的失败转译成可读的错误文案。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FileReviewRequest, FileReviewResult, RecordedRequest, RecordedResult,
} from '../file-review/change-types.ts'
import { TYPERT_REMOTE } from '../file-review/remote.ts'

/** 浏览器半边需要的 fileReview 命名空间方法面。 */
export interface FileReviewRemote {
  status(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
  apply(request: FileReviewRequest): Promise<RemoteResult<FileReviewResult>>
  recorded(request: RecordedRequest): Promise<RemoteResult<RecordedResult>>
}

interface MountableRemote {
  $mount(contribution: unknown): Promise<() => Promise<void>>
}

let mountTask: Promise<void> | undefined

/**
 * 幂等挂载 fileReview 远端贡献。并发调用共享同一任务；失败后允许再次调用
 * 重试（mountTask 复位）。
 */
export function mountFileReviewRemote(ctx: Context): Promise<void> {
  mountTask ??= (async () => {
    const remote = (ctx as unknown as { readonly remote?: MountableRemote }).remote
    if (remote === undefined) throw new Error('remote service is unavailable')
    const dispose = await remote.$mount(TYPERT_REMOTE)
    // 挂载成功；disposer 交给 cordis effect 生命周期（见 applyFileReview）。
    mountDisposers.add(dispose)
  })().catch((error: unknown) => {
    mountTask = undefined
    throw error
  })
  return mountTask
}

/** applyFileReview 的 effect 清理用：卸载全部成功挂载的贡献。 */
const mountDisposers = new Set<() => Promise<void>>()

export function disposeFileReviewRemote(): void {
  for (const dispose of mountDisposers) void dispose()
  mountDisposers.clear()
  mountTask = undefined
}

/**
 * 读取 scope 的 fileReview 命名空间。命名空间服务不可用时 cordis 代理会抛
 * `cannot get property "remote.fileReview" without inject`——原样上抛，
 * 由 invokeFileReviewRemote 统一转译。
 */
function readScopeRemote(scope: unknown): FileReviewRemote | undefined {
  const remote = (scope as { readonly remote?: { readonly fileReview?: FileReviewRemote } }).remote
  return remote?.fileReview
}

/**
 * 解析会话 scope 的 fileReview 命名空间（带一次自愈重试）：
 * 首次访问失败即重挂贡献再取一次；仍失败返回 undefined。
 */
export async function resolveFileReviewRemote(ctx: Context, sessionId: string): Promise<FileReviewRemote | undefined> {
  const sessions = (ctx as unknown as {
    readonly sessions?: { scope(sessionId: string): unknown }
  }).sessions
  const scope = sessions?.scope(sessionId)
  if (scope === undefined) return undefined
  try {
    const remote = readScopeRemote(scope)
    if (remote !== undefined) return remote
  } catch {
    // 命名空间声明在、服务不可用：走下面的重挂路径。
  }
  await mountFileReviewRemote(ctx).catch(() => undefined)
  try {
    return readScopeRemote(scope)
  } catch {
    return undefined
  }
}

/** fileReview/status|apply 的调用包装（结果 error 分支转译成异常）。 */
export async function invokeFileReview(
  ctx: Context,
  sessionId: string,
  method: 'status' | 'apply',
  request: FileReviewRequest,
): Promise<FileReviewResult> {
  const remote = await resolveFileReviewRemote(ctx, sessionId)
  if (remote === undefined) {
    throw new Error('文件审查远端服务不可用（fileReview 命名空间未挂载，详情见控制台 remote mount error）')
  }
  const result = await remote[method](request)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** fileReview/recorded 的调用包装（Code Mode 录制读取）。 */
export async function invokeFileReviewRecorded(
  ctx: Context,
  sessionId: string,
  request: RecordedRequest,
): Promise<RecordedResult> {
  const remote = await resolveFileReviewRemote(ctx, sessionId)
  if (remote === undefined) {
    throw new Error('文件审查远端服务不可用（fileReview 命名空间未挂载，详情见控制台 remote mount error）')
  }
  const result = await remote.recorded(request)
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}
