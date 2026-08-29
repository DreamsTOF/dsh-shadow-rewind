/**
 * 核心引擎：捕获 / 对比 / 计划 / 恢复 / 删除 / 崩溃恢复。
 *
 * 两条铁律贯穿全部路径：
 *  1. 绝不调用工作区自身的任何 VCS——文件枚举只走目录扫描，快照字节只落在
 *     影子 jj 仓库或独立 blob 目录；
 *  2. 恢复必须「计划限时 + 确认串逐字回显 + 恢复前自动 rescue 备份 +
 *     操作日志 + 事后哈希验证」，任何一步不符立即 fail-closed。
 */
import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { lstat, open, readlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { captureSnapshot } from './capture.js'
import { clearCaptureCache, readCaptureCache, writeCaptureCache } from './capture-cache.js'
import { createDeadline } from './deadline.js'
import { ShadowRewindError, errorMessage } from './errors.js'
import { jjAvailable, ShadowJj } from './jj-backend.js'
import { diffTrees, makeId, sha256Hex } from './manifest.js'
import {
  assertSafeParents,
  canonicalDirectory,
  ensureSafeParents,
  isNodeError,
  pathExists,
  pruneEmptyParents,
  removeRestoreTarget,
  replaceRegularFile,
  replaceSymbolicLink,
  resolveWorkspacePath,
} from './path-utils.js'
import { compileExcludes, scanWorkspace } from './scan.js'
import type { ExcludeRule, ScannedPath } from './scan.js'
import { WorkspaceStore } from './store.js'
import type { RestorePlanId } from './types.js'
import {
  FORMAT_VERSION,
  type Manifest,
  type ResolvedShadowRewindConfig,
  type RestoreOperation,
  type RestorePlan,
  type RestorePointKind,
  type RestorePointSummary,
  type RestoreResult,
  type ShadowRewindConfig,
  type SkippedPath,
  type SnapshotEntry,
  type WorkspaceChange,
} from './types.js'

/** 默认排除清单：VCS 目录、依赖、构建产物与常见缓存（自用取向：宁多勿漏）。 */
export const DEFAULT_EXCLUDES: readonly string[] = [
  '.git',
  '.jj',
  'node_modules',
  'dist',
  'build',
  'out',
  'target',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  'coverage',
  '.next',
  '.nuxt',
  '.turbo',
  '.parcel-cache',
  'tmp',
  'temp',
]

const DEFAULTS = {
  maxRestorePoints: 50,
  maxTurnCheckpointsPerSession: 30,
  maxFiles: 20_000,
  maxFileBytes: 16 * 1024 * 1024,
  maxSnapshotBytes: 512 * 1024 * 1024,
  planTtlMs: 15 * 60 * 1_000,
  staleLockMs: 30_000,
  turnCheckpointMode: 'jj',
  turnCheckpointTimeoutMs: 5_000,
  turnCheckpointMaxNewBytes: 32 * 1024 * 1024,
  turnCheckpointTrust: 'fast',
} as const

/** 解析配置：全部字段落定；非法值直接抛错（宁可拒绝启动也不带病运行）。 */
export function resolveConfig(config: ShadowRewindConfig): ResolvedShadowRewindConfig {
  const storageDir = config.storageDir?.trim() !== ''
    ? String(config.storageDir)
    : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'shadow-rewind', 'v1')
  const mode = config.turnCheckpointMode ?? DEFAULTS.turnCheckpointMode
  if (mode !== 'off' && mode !== 'legacy' && mode !== 'jj') {
    throw new ShadowRewindError('INVALID_CONFIG', 'turnCheckpointMode 必须是 off、legacy 或 jj')
  }
  const trust = config.turnCheckpointTrust ?? DEFAULTS.turnCheckpointTrust
  if (trust !== 'fast' && trust !== 'strict') {
    throw new ShadowRewindError('INVALID_CONFIG', 'turnCheckpointTrust 必须是 fast 或 strict')
  }
  return {
    storageDir,
    maxRestorePoints: positiveInteger(config.maxRestorePoints ?? DEFAULTS.maxRestorePoints, 'maxRestorePoints'),
    maxTurnCheckpointsPerSession: positiveInteger(config.maxTurnCheckpointsPerSession ?? DEFAULTS.maxTurnCheckpointsPerSession, 'maxTurnCheckpointsPerSession'),
    maxFiles: positiveInteger(config.maxFiles ?? DEFAULTS.maxFiles, 'maxFiles'),
    maxFileBytes: positiveInteger(config.maxFileBytes ?? DEFAULTS.maxFileBytes, 'maxFileBytes'),
    maxSnapshotBytes: positiveInteger(config.maxSnapshotBytes ?? DEFAULTS.maxSnapshotBytes, 'maxSnapshotBytes'),
    planTtlMs: positiveInteger(config.planTtlMs ?? DEFAULTS.planTtlMs, 'planTtlMs'),
    staleLockMs: positiveInteger(config.staleLockMs ?? DEFAULTS.staleLockMs, 'staleLockMs'),
    turnCheckpointMode: mode,
    turnCheckpointTimeoutMs: positiveInteger(config.turnCheckpointTimeoutMs ?? DEFAULTS.turnCheckpointTimeoutMs, 'turnCheckpointTimeoutMs'),
    turnCheckpointMaxNewBytes: positiveInteger(config.turnCheckpointMaxNewBytes ?? DEFAULTS.turnCheckpointMaxNewBytes, 'turnCheckpointMaxNewBytes'),
    turnCheckpointTrust: trust,
    excludePatterns: config.excludePatterns ?? DEFAULT_EXCLUDES,
  }
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ShadowRewindError('INVALID_CONFIG', `${name} 必须是正整数`)
  }
  return value
}

/** 一次当前树捕获的完整产物。 */
interface CapturedTree {
  readonly root: string
  readonly entries: Record<string, SnapshotEntry>
  readonly skipped: readonly SkippedPath[]
  readonly treeHash: string
  readonly fileCount: number
  readonly totalBytes: number
  /** full 模式下的产出：影子仓库 commit id。 */
  readonly commitId?: string
}

/** 引擎实例：一个插件进程共享一个（配置驱动，无隐藏全局状态）。 */
export class ShadowRewindEngine {
  readonly config: ResolvedShadowRewindConfig
  readonly store: WorkspaceStore
  /** 启动恢复完成后的信号（恢复条数）。 */
  readonly ready: Promise<number>

  /**
   * 实际生效的内容后端：配置为 jj 但宿主机缺 CLI 时自动降级为 blob
   * （自动检查点不断档）；显式配置 legacy/off 不受影响。
   */
  readonly effectiveBackend: 'jj' | 'blob'
  /** 降级原因（未降级时为 undefined）。 */
  readonly downgradeReason?: string

  private readonly excludes: readonly ExcludeRule[]
  private readonly plans = new Map<RestorePlanId, RestorePlan & { expired?: boolean }>()
  private readonly applying = new Set<RestorePlanId>()
  private readonly shadowRepos = new Map<string, ShadowJj>()

  constructor(config: ShadowRewindConfig = {}) {
    this.config = resolveConfig(config)
    if (this.config.turnCheckpointMode === 'jj' && !jjAvailable()) {
      this.effectiveBackend = 'blob'
      this.downgradeReason = '宿主机没有可用的 jj CLI，自动检查点已降级为内置 blob 存储'
    } else {
      this.effectiveBackend = this.config.turnCheckpointMode === 'off' ? 'blob' : this.config.turnCheckpointMode === 'jj' ? 'jj' : 'blob'
    }
    this.excludes = compileExcludes(this.config.excludePatterns)
    this.store = new WorkspaceStore(this.config)
    this.ready = this.store.initialize()
  }

  /** 自动检查点是否被配置关闭（与降级区分）。 */
  get turnCheckpointsDisabled(): boolean {
    return this.config.turnCheckpointMode === 'off'
  }

  private async assertReady(signal?: AbortSignal): Promise<void> {
    if (signal !== undefined) {
      let abort: () => void = () => {}
      const aborted = new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason)
      })
      signal.addEventListener('abort', abort, { once: true })
      try {
        await Promise.race([this.ready, aborted])
      } finally {
        signal.removeEventListener('abort', abort)
      }
      return
    }
    await this.ready
  }

  private shadowRepo(workspace: string): ShadowJj {
    let repo = this.shadowRepos.get(workspace)
    if (repo === undefined) {
        // 影子仓库路径由工作区路径哈希派生，位于存储根之下——与工作区物理隔离。
        // 哈希截断到 16 位 hex：Windows 的 MAX_PATH 下深层 .jj 内部路径很长，
        // 全长 64 位 hex 目录名容易触顶；16 位（64 bit）对自用场景碰撞可忽略。
        const key = sha256Hex(Buffer.from(workspace, 'utf8')).slice(0, 16)
        repo = new ShadowJj(join(this.config.storageDir, 'shadow-repos', key))
        this.shadowRepos.set(workspace, repo)
      }
    return repo
  }

  // ── 当前树捕获 ──────────────────────────────────────────────────────────

  /**
   * 扫描 + 捕获当前树（共用 stat 缓存增量，blob 与 jj 后端同路径）。
   *  - mode = 'inspect'：只构建 entries（供对比/计划）；缓存只读不写回，
   *    避免把对比时刻的 stat 事实污染成下一次持久捕获的增量依据；
   *  - mode = 'persist'：新读内容写入内容后端（blob putBlob / jj 镜像提交），
   *    并写回缓存，返回 commitId。
   */
  private async captureTree(
    workspace: string,
    options: {
      readonly mode: 'inspect' | 'persist'
      readonly message?: string
      readonly signal?: AbortSignal
    },
  ): Promise<CapturedTree> {
    const scan = await scanWorkspace(workspace, {
      maxFileBytes: this.config.maxFileBytes,
      excludes: this.excludes,
      signal: options.signal,
    })
    const workspaceDir = await this.store.workspaceDir(workspace)
    const cachePath = join(workspaceDir, 'stat-cache.json')
    const cache = await readCaptureCache(cachePath)
    // 缓存命中校验：blob 模式 stat blob 文件、jj 模式 stat 镜像文件——
    // 存储被 GC / 影子仓库被清理后，命中项会在这里被识别为失效并重读，
    // 绝不让 manifest 引用「已死亡」的内容。
    const verifyContent = async (path: string, blob: string): Promise<boolean> => {
      if (this.effectiveBackend === 'blob') return this.store.blobExists(workspace, blob)
      return pathExists(join(this.shadowRepo(workspace).repoDir, 'checkpoint', ...path.split('/')))
    }
    const captured = await captureSnapshot({
      root: scan.root,
      paths: scan.paths,
      skippedAtScan: scan.skipped,
      maxFiles: this.config.maxFiles,
      maxSnapshotBytes: this.config.maxSnapshotBytes,
      strict: this.config.turnCheckpointTrust === 'strict',
      cache,
      ...(options.mode === 'persist' ? { verifyContent } : {}),
      signal: options.signal,
    })
    let commitId: string | undefined
    if (options.mode === 'persist') {
      if (this.effectiveBackend === 'jj') {
        commitId = await this.persistJj(workspace, scan.paths, captured, options.message ?? 'checkpoint', options.signal)
      } else {
        // blob 后端：把新读内容写入内容寻址存储（命中缓存的路径已在存储里）。
        for (const [path, content] of captured.newContent) {
          const entry = captured.entries[path]
          if (entry === undefined || entry.kind !== 'file') continue
          await this.store.putBlob(workspace, entry.blob, content)
        }
      }
      await writeCaptureCache(cachePath, captured.nextCache)
    }
    return {
      root: scan.root,
      entries: captured.entries,
      skipped: captured.skipped,
      treeHash: captured.treeHash,
      fileCount: captured.fileCount,
      totalBytes: captured.totalBytes,
      ...(commitId === undefined ? {} : { commitId }),
    }
  }

  /**
   * jj 持久化：仓库丢失（JJ_REPO_LOST）时删残骸 + 清缓存 + 重试一次。
   * 关键不变量：仓库丢失时 verifyContent 必然拒绝所有命中项（镜像文件已
   * 随仓库消失），因此首轮捕获已是全量重读——newContent 完整，重试无需
   * 重新扫描读取，直接用首轮内容重建仓库即可。
   */
  private async persistJj(
    workspace: string,
    scanPaths: readonly ScannedPath[],
    captured: { readonly newContent: ReadonlyMap<string, Buffer>; readonly newLinks: ReadonlyMap<string, string> },
    message: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const captureOnce = (): Promise<{ readonly commitId: string }> =>
      this.shadowRepo(workspace).capture(scanPaths, captured.newContent, captured.newLinks, message, {
        maxNewBytes: this.config.turnCheckpointMaxNewBytes,
        signal,
      })
    try {
      return (await captureOnce()).commitId
    } catch (error) {
      // 仓库丢失有两种呈现形态：
      //  - 新实例：initialize 检测到残留镜像目录 → JJ_REPO_LOST；
      //  - 进程内旧实例（initialized 标记还在）：目录被删后 jj 直接报
      //    "There is no jj repo"。两者都必须触发清理重试。
      const lost = error instanceof ShadowRewindError
        && (error.code === 'JJ_REPO_LOST'
          || (error.code === 'JJ_COMMAND_FAILED' && error.message.includes('no jj repo')))
      if (!lost) throw error
    }
    await rm(join(this.config.storageDir, 'shadow-repos', sha256Hex(Buffer.from(workspace, 'utf8')).slice(0, 16)), { recursive: true, force: true })
    await clearCaptureCache(join(await this.store.workspaceDir(workspace), 'stat-cache.json'))
    this.shadowRepos.delete(workspace) // 丢弃旧句柄（initialized 标记已失效）
    return (await captureOnce()).commitId
  }

  // ── 恢复点创建 ──────────────────────────────────────────────────────────

  /** 创建一个持久化恢复点（user / rescue）。 */
  async create(options: {
    readonly cwd: string
    readonly kind?: Extract<RestorePointKind, 'user' | 'rescue'>
    readonly sessionId?: string
    readonly label?: string
    readonly parentRestorePoint?: string
    readonly signal?: AbortSignal
  }): Promise<RestorePointSummary> {
    await this.assertReady(options.signal)
    const workspace = await canonicalDirectory(options.cwd)
    await this.store.assertStorageSeparated(workspace)
    const release = await this.store.acquire(workspace, options.signal)
    try {
      if (options.kind !== 'rescue') {
        const existing = await this.store.listManifests(workspace)
        // 配额只统计手动恢复点：rescue 是自动安全网（见 createLocked 的
        // 独立修剪），turn 有自己的每会话窗口——都不能挤占用户配额。
        if (existing.filter((manifest) => manifest.kind === 'user').length >= this.config.maxRestorePoints) {
          throw new ShadowRewindError('RESTORE_POINT_LIMIT', `手动恢复点数量已达上限 ${String(this.config.maxRestorePoints)}`)
        }
      }
      const manifest = await this.createLocked(workspace, {
        kind: options.kind === 'rescue' ? 'rescue' : 'user',
        sessionId: options.sessionId,
        label: options.label,
        parentRestorePoint: options.parentRestorePoint,
        signal: options.signal,
      })
      return summarize(manifest)
    } finally {
      await release()
    }
  }

  /** 捕获回合检查点（turn）；重复请求同一回合时幂等返回已有检查点。 */
  async createTurnCheckpoint(options: {
    readonly cwd: string
    readonly sessionId: string
    readonly turn: number
    readonly turnStartSeq: number
    readonly signal?: AbortSignal
  }): Promise<RestorePointSummary> {
    const deadline = createDeadline(this.config.turnCheckpointTimeoutMs)
    const signal = options.signal === undefined ? deadline.signal : AbortSignal.any([options.signal, deadline.signal])
    try {
      await this.assertReady(signal)
      if (this.turnCheckpointsDisabled) {
        throw new ShadowRewindError('TURN_CHECKPOINT_DISABLED', '自动回合检查点已关闭')
      }
      if (!Number.isSafeInteger(options.turn) || options.turn < 0 || !Number.isSafeInteger(options.turnStartSeq) || options.turnStartSeq < 0) {
        throw new ShadowRewindError('INVALID_ARGUMENTS', 'turn 与 turnStartSeq 必须是非负整数')
      }
      const workspace = await canonicalDirectory(options.cwd)
      await this.store.assertStorageSeparated(workspace)
      const release = await this.store.acquire(workspace, signal)
      try {
        const existing = await this.store.listManifests(workspace)
        const duplicate = existing.find((manifest) => manifest.kind === 'turn'
          && manifest.sessionId === options.sessionId
          && manifest.turn === options.turn
          && manifest.turnStartSeq === options.turnStartSeq)
        if (duplicate !== undefined) {
          await this.store.deleteTurnSkip(workspace, options.sessionId, options.turn, options.turnStartSeq).catch(() => undefined)
          return summarize(duplicate)
        }
        const manifest = await this.createLocked(workspace, {
          kind: 'turn',
          sessionId: options.sessionId,
          turn: options.turn,
          turnStartSeq: options.turnStartSeq,
          label: `turn ${String(options.turn)} 检查点`,
          signal,
        })
        await this.store.deleteTurnSkip(workspace, options.sessionId, options.turn, options.turnStartSeq).catch(() => undefined)
        // 修剪：每会话只保留最新的 N 个 turn 检查点。
        // jj 后端的影子 change 不随之删除——change id 是内容历史的地址，
        // 保留无害，删除反而需要额外的 abandon 流程；自用存储换简单性。
        const sameSession = [...existing, manifest]
          .filter((point) => point.kind === 'turn' && point.sessionId === options.sessionId)
          .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
        for (const stale of sameSession.slice(this.config.maxTurnCheckpointsPerSession)) {
          if (signal.aborted) break
          if (await this.isReferencedByRecovery(workspace, stale.id)) continue
          await this.store.deleteManifest(workspace, stale.id).catch(() => undefined)
        }
        return summarize(manifest)
      } finally {
        await release()
      }
    } catch (error) {
      throw wrapCheckpointDeadline(error, this.config.turnCheckpointTimeoutMs, deadline.signal.aborted)
    } finally {
      deadline.cancel()
    }
  }

  /** 查找一个回合的检查点（可选校验 turnStartSeq）。 */
  async findTurnCheckpoint(options: {
    readonly cwd: string
    readonly sessionId: string
    readonly turn: number
    readonly turnStartSeq?: number
  }): Promise<RestorePointSummary | undefined> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    const manifests = await this.store.listManifests(workspace)
    const found = manifests.find((manifest) => manifest.kind === 'turn'
      && manifest.sessionId === options.sessionId
      && manifest.turn === options.turn
      && (options.turnStartSeq === undefined || manifest.turnStartSeq === options.turnStartSeq))
    return found === undefined ? undefined : summarize(found)
  }

  /** 持久化一次检查点跳过（UI 重启后仍可见）。 */
  async recordTurnCheckpointSkip(options: {
    readonly cwd: string
    readonly sessionId: string
    readonly turn: number
    readonly turnStartSeq: number
    readonly reason: string
  }): Promise<void> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    await this.store.writeTurnSkip(workspace, {
      sessionId: options.sessionId,
      turn: options.turn,
      turnStartSeq: options.turnStartSeq,
      reason: options.reason.slice(0, 2_000),
    })
  }

  /** 读取持久化的检查点跳过记录。 */
  async findTurnCheckpointSkip(options: {
    readonly cwd: string
    readonly sessionId: string
    readonly turn: number
    readonly turnStartSeq: number
  }): Promise<{ reason: string } | undefined> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    return this.store.readTurnSkip(workspace, options.sessionId, options.turn, options.turnStartSeq)
  }

  /** 实际创建 manifest 的内部路径：调用方必须已持有工作区锁。 */
  private async createLocked(
    workspace: string,
    options: {
      readonly kind: RestorePointKind
      readonly sessionId?: string
      readonly label?: string
      readonly parentRestorePoint?: string
      readonly turn?: number
      readonly turnStartSeq?: number
      readonly signal?: AbortSignal
    },
  ): Promise<Manifest> {
    const tree = await this.captureTree(workspace, {
      mode: 'persist',
      message: options.kind === 'turn'
        ? `turn ${String(options.turn)} checkpoint (session ${options.sessionId ?? '?'})`
        : options.kind === 'rescue'
          ? `rescue before restoring ${options.parentRestorePoint ?? '?'}`
          : options.label ?? 'user restore point',
      signal: options.signal,
    })
    const manifest: Manifest = {
      version: FORMAT_VERSION,
      id: makeId('rp'),
      kind: options.kind,
      workspace,
      storage: this.effectiveBackend,
      ...(tree.commitId === undefined ? {} : { commitId: tree.commitId }),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      ...(options.label === undefined ? {} : { label: options.label }),
      ...(options.parentRestorePoint === undefined ? {} : { parentRestorePoint: options.parentRestorePoint }),
      ...(options.turn === undefined ? {} : { turn: options.turn }),
      ...(options.turnStartSeq === undefined ? {} : { turnStartSeq: options.turnStartSeq }),
      createdAt: Date.now(),
      treeHash: tree.treeHash,
      fileCount: tree.fileCount,
      totalBytes: tree.totalBytes,
      entries: tree.entries,
      skippedPaths: tree.skipped,
      restoreCount: 0,
    }
    await this.store.writeManifest(workspace, manifest)
    if (options.kind !== 'turn') {
      // GC 只删未被引用的 blob；一旦真删了内容，就必须同步作废 stat 缓存，
      // 否则下一次命中会把已删除的 blob 引用进新 manifest（死引用）。
      const gc = await this.store.collectGarbage(workspace)
      if (gc.deletedBlobs > 0) {
        await clearCaptureCache(join(await this.store.workspaceDir(workspace), 'stat-cache.json'))
      }
    }
    if (options.kind === 'rescue') {
      // rescue 不计入 maxRestorePoints（它是自动安全网，不该挤占手动配额），
      // 但也不能无限堆积：超出配额时淘汰最旧的，被恢复日志引用的除外。
      const rescues = (await this.store.listManifests(workspace))
        .filter((point) => point.kind === 'rescue')
        .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      for (const stale of rescues.slice(Math.max(1, this.config.maxRestorePoints))) {
        if (await this.isReferencedByRecovery(workspace, stale.id)) continue
        await this.store.deleteManifest(workspace, stale.id).catch(() => undefined)
      }
    }
    return manifest
  }

  // ── 对比 / 计划 / 恢复 ──────────────────────────────────────────────────

  /** 列出恢复点（默认不含 turn 与 rescue；调用方按需打开）。 */
  async list(options: {
    readonly cwd: string
    readonly includeTurnCheckpoints?: boolean
    readonly includeRescue?: boolean
  }): Promise<readonly RestorePointSummary[]> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    const manifests = await this.store.listManifests(workspace)
    return manifests
      .filter((manifest) => manifest.kind === 'user'
        || (manifest.kind === 'rescue' && options.includeRescue === true)
        || (manifest.kind === 'turn' && options.includeTurnCheckpoints === true))
      .map(summarize)
  }

  /** 对比一个恢复点与当前工作区（跳过项以明细透出，不混入 changes）。 */
  async inspect(options: { readonly cwd: string; readonly restorePointId: string; readonly signal?: AbortSignal }): Promise<{
    restorePoint: RestorePointSummary
    currentTreeHash: string
    changes: readonly WorkspaceChange[]
    skippedPaths: readonly SkippedPath[]
  }> {
    await this.assertReady(options.signal)
    const workspace = await canonicalDirectory(options.cwd)
    const release = await this.store.acquire(workspace, options.signal)
    try {
      const manifest = await this.store.readManifest(workspace, options.restorePointId)
      const current = await this.captureTree(workspace, { mode: 'inspect', signal: options.signal })
      // 跳过项不构成恢复动作，也不应伪装成 added 变更迷惑用户——单独透出。
      const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path))
      return {
        restorePoint: summarize(manifest),
        currentTreeHash: current.treeHash,
        changes: diffTrees(manifest.entries, current.entries)
          .filter((change) => !skippedSet.has(change.path)),
        skippedPaths: manifest.skippedPaths,
      }
    } finally {
      await release()
    }
  }

  /** 生成限时恢复计划（确认串必须逐字回显）。 */
  /**
   * 对称模式路径归因的数据源：晚于目标恢复点的全部快照（其它会话的 turn
   * 检查点、rescue 点等），按时间升序，entries 投影到给定路径集。检查点在
   * 回合开始时捕获，因此窗口 [S_j, S_{j+1}) 的写者就是 S_j 的会话。
   * 上限 64 个：归因只是预览里的建议标签（勾选权在用户），更早的时间线
   * 不再细分。
   */
  async listSnapshotsAfter(options: {
    readonly cwd: string
    readonly restorePointId: string
    readonly paths: readonly string[]
    readonly signal?: AbortSignal
  }): Promise<{
    readonly targetSessionId: string | undefined
    readonly snapshots: readonly {
      readonly id: string
      readonly sessionId?: string
      readonly createdAt: number
      readonly entries: Readonly<Record<string, SnapshotEntry | null>>
    }[]
  }> {
    await this.assertReady(options.signal)
    const workspace = await canonicalDirectory(options.cwd)
    const target = await this.store.readManifest(workspace, options.restorePointId)
    const all = await this.store.listManifests(workspace)
    const later = all
      .filter((manifest) => manifest.id !== target.id && manifest.createdAt >= target.createdAt)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .slice(0, 64)
    return {
      targetSessionId: target.sessionId,
      snapshots: later.map((manifest) => {
        const entries: Record<string, SnapshotEntry | null> = Object.create(null)
        for (const path of options.paths) {
          const entry = manifest.entries[path]
          entries[path] = entry === undefined ? null : entry
        }
        return {
          id: manifest.id,
          ...(manifest.sessionId === undefined ? {} : { sessionId: manifest.sessionId }),
          createdAt: manifest.createdAt,
          entries,
        }
      }),
    }
  }

  async planRestore(options: {
    readonly cwd: string
    readonly restorePointId: string
    readonly sessionId?: string
    readonly expectedCurrentTreeHash?: string
    /** 对称模式的勾选式子集：计划只覆盖这些路径（必须都是变更清单成员）。 */
    readonly paths?: readonly string[]
    readonly signal?: AbortSignal
  }): Promise<RestorePlan> {
    await this.assertReady(options.signal)
    this.expirePlans()
    const workspace = await canonicalDirectory(options.cwd)
    const release = await this.store.acquire(workspace, options.signal)
    try {
      const manifest = await this.store.readManifest(workspace, options.restorePointId)
      const current = await this.captureTree(workspace, { mode: 'inspect', signal: options.signal })
      if (options.expectedCurrentTreeHash !== undefined && options.expectedCurrentTreeHash !== current.treeHash) {
        throw new ShadowRewindError('PLAN_STALE', '检查之后工作区又发生了变化；请重新检查')
      }
      // 快照时被显式跳过的路径（过大/不支持/读取失败）不在快照里，因此它们
      // 此后的任何变化都绝不构成恢复动作——否则「新增的大文件」会在恢复时
      // 被误删，违背「恢复不碰跳过项」的承诺。
      const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path))
      let changes = diffTrees(manifest.entries, current.entries)
        .filter((change) => !skippedSet.has(change.path))
      if (options.paths !== undefined) {
        // 未知路径立即拒绝：防止客户端拿错版本的清单拼出半个计划。
        const changePaths = new Set(changes.map((change) => change.path))
        const unknown = options.paths.filter((path) => !changePaths.has(path))
        if (unknown.length > 0) {
          throw new ShadowRewindError('INVALID_ARGUMENTS', `以下路径不在恢复点 ${manifest.id} 的变更清单里：${unknown.slice(0, 5).join(', ')}`)
        }
        const wanted = new Set(options.paths)
        changes = changes.filter((change) => wanted.has(change.path))
        if (changes.length === 0) {
          throw new ShadowRewindError('NO_CHANGES', '勾选的路径没有可恢复的变更')
        }
      }
      if (changes.length === 0) {
        throw new ShadowRewindError('NO_CHANGES', `工作区已经与恢复点 ${manifest.id} 一致`)
      }
      const expected: Record<string, SnapshotEntry | null> = Object.create(null)
      for (const change of changes) {
        expected[change.path] = current.entries[change.path] ?? null
      }
      const now = Date.now()
      const plan: RestorePlan = {
        id: makeId('plan'),
        restorePointId: manifest.id,
        workspace,
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
        createdAt: now,
        expiresAt: now + this.config.planTtlMs,
        confirmation: `RESTORE-${randomBytes(4).toString('hex').toUpperCase()}`,
        changes,
        skippedPaths: manifest.skippedPaths,
        expected,
      }
      this.plans.set(plan.id, plan)
      return structuredClonePlan(plan)
    } finally {
      await release()
    }
  }

  /** 执行一个已批准的恢复计划：rescue → 日志 → 恢复 → 验证（失败自动回滚）。 */
  async applyRestore(options: {
    readonly planId: string
    readonly confirmation: string
    readonly sessionId?: string
    readonly signal?: AbortSignal
  }): Promise<RestoreResult> {
    await this.assertReady(options.signal)
    this.expirePlans()
    const plan = this.plans.get(options.planId)
    if (plan === undefined || plan.expired === true) {
      throw new ShadowRewindError('PLAN_NOT_FOUND', `恢复计划 ${options.planId} 不存在或已过期`)
    }
    if (plan.confirmation !== options.confirmation) {
      throw new ShadowRewindError('CONFIRMATION_MISMATCH', '确认串与恢复计划不一致')
    }
    // 计划绑定会话时，调用方必须证明自己就是那个会话——省略 sessionId
    // 不能绕过校验（否则自动化调用可以拿别人的计划执行恢复）。
    if (plan.sessionId !== undefined && plan.sessionId !== options.sessionId) {
      throw new ShadowRewindError('SESSION_MISMATCH', '恢复计划属于另一个会话')
    }
    if (this.applying.has(plan.id)) {
      throw new ShadowRewindError('PLAN_IN_PROGRESS', '该恢复计划正在执行')
    }
    this.applying.add(plan.id)
    try {
      const release = await this.store.acquire(plan.workspace, options.signal)
      try {
        const manifest = await this.store.readManifest(plan.workspace, plan.restorePointId)
        // 计划复核：每条待恢复路径的当前内容必须仍与计划时一致。
        const current = await this.captureTree(plan.workspace, { mode: 'inspect', signal: options.signal })
        assertPlanFresh(plan, current.entries)
        // 恢复前自动备份当前状态——失败的回滚与「后悔药」都靠它。
        const rescue = await this.createLocked(plan.workspace, {
          kind: 'rescue',
          label: `恢复 ${manifest.id} 之前`,
          parentRestorePoint: manifest.id,
          sessionId: options.sessionId,
          signal: options.signal,
        })
        const operation: RestoreOperation = {
          version: FORMAT_VERSION,
          id: makeId('op'),
          workspace: plan.workspace,
          restorePointId: manifest.id,
          rescuePointId: rescue.id,
          ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
          paths: plan.changes.map((change) => change.path),
          startedAt: Date.now(),
          state: 'running',
        }
        await this.store.writeOperation(operation)
        try {
          await this.restorePaths(plan.workspace, manifest, plan.changes.map((change) => change.path), options.signal)
          await this.verifyRestored(plan.workspace, manifest, operation.paths, options.signal)
          await this.store.writeOperation({
            ...operation,
            state: 'completed',
            finishedAt: Date.now(),
          })
          await this.store.writeManifest(plan.workspace, {
            ...manifest,
            restoreCount: manifest.restoreCount + 1,
            lastRestoredAt: Date.now(),
          })
          this.plans.delete(plan.id)
          const result: RestoreResult = {
            operationId: operation.id,
            restorePointId: manifest.id,
            rescuePointId: rescue.id,
            restoredPaths: operation.paths,
          }
          return result
        } catch (error) {
          // 主恢复失败 → 立即从 rescue 点回滚全部涉及路径。
          // 回滚不走 expected 复核：目标就是把状态打回 rescue 时点。
          await this.store.writeOperation({ ...operation, state: 'rollback-running' }).catch(() => undefined)
          try {
            const affected = [...new Set([
              ...operation.paths,
              ...diffTrees(rescue.entries, current.entries).map((change) => change.path),
            ])]
            await this.restorePaths(plan.workspace, rescue, affected, options.signal)
            await this.verifyRestored(plan.workspace, rescue, affected, options.signal)
            await this.store.writeOperation({
              ...operation,
              state: 'rolled-back',
              finishedAt: Date.now(),
              error: errorMessage(error),
            })
            throw new ShadowRewindError('RESTORE_FAILED_ROLLED_BACK',
              `恢复失败，已自动从备份 ${rescue.id} 还原：${errorMessage(error)}`, { cause: error })
          } catch (rollbackError) {
            if (rollbackError instanceof ShadowRewindError && rollbackError.code === 'RESTORE_FAILED_ROLLED_BACK') {
              throw rollbackError
            }
            await this.store.writeOperation({
              ...operation,
              state: 'recovery-required',
              finishedAt: Date.now(),
              error: errorMessage(error),
              rollbackError: errorMessage(rollbackError),
            }).catch(() => undefined)
            throw new ShadowRewindError('RECOVERY_REQUIRED',
              `恢复失败且回滚也失败；可从备份点 ${rescue.id} 手工恢复。主错误：${errorMessage(error)}；回滚错误：${errorMessage(rollbackError)}`)
          }
        }
      } finally {
        await release()
      }
    } finally {
      this.applying.delete(plan.id)
    }
  }

  /** 删除一个恢复点（确认串必须逐字等于 `DELETE <id>`）。 */
  async delete(options: {
    readonly cwd: string
    readonly restorePointId: string
    readonly confirmation: string
    readonly signal?: AbortSignal
  }): Promise<{ restorePointId: string; deletedBlobs?: number }> {
    await this.assertReady(options.signal)
    if (options.confirmation !== `DELETE ${options.restorePointId}`) {
      throw new ShadowRewindError('CONFIRMATION_MISMATCH', `确认串必须逐字等于 "DELETE ${options.restorePointId}"`)
    }
    const workspace = await canonicalDirectory(options.cwd)
    const release = await this.store.acquire(workspace, options.signal)
    try {
      if (await this.isReferencedByRecovery(workspace, options.restorePointId)) {
        throw new ShadowRewindError('RECOVERY_REFERENCE', '该恢复点仍被未完成的恢复日志引用，不能删除')
      }
      await this.store.deleteManifest(workspace, options.restorePointId)
      const gc = await this.store.collectGarbage(workspace)
      if (gc.deletedBlobs > 0) {
        // 删掉的 blob 可能正是 stat 缓存引用的内容——不作废缓存的话，
        // 下一次命中会把死引用写进新 manifest。
        await clearCaptureCache(join(await this.store.workspaceDir(workspace), 'stat-cache.json'))
      }
      // 影子 jj 的历史 change 保留不删：它们只是内容地址，删除 manifest 已
      // 让其不可达；批量 abandon 属于运维操作，不混进插件生命周期。
      return { restorePointId: options.restorePointId, deletedBlobs: gc.deletedBlobs }
    } finally {
      await release()
    }
  }

  /** 列出中断/需要人工介入的恢复操作。 */
  async listRecovery(options: { readonly cwd: string }): Promise<readonly {
    operationId: string
    restorePointId: string
    rescuePointId: string
    state: 'interrupted' | 'recovery-required'
    paths: readonly string[]
    startedAt: number
    error?: string
    rollbackError?: string
  }[]> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    const operations = await this.store.listOperations(workspace)
    const broken: readonly (RestoreOperation & { state: 'interrupted' | 'recovery-required' })[] = operations
      .filter((operation): operation is RestoreOperation & { state: 'interrupted' | 'recovery-required' } =>
        operation.state === 'interrupted' || operation.state === 'recovery-required')
    return broken.map((operation) => ({
        operationId: operation.id,
        restorePointId: operation.restorePointId,
        rescuePointId: operation.rescuePointId,
        state: operation.state,
        paths: operation.paths,
        startedAt: operation.startedAt,
        ...(operation.error === undefined ? {} : { error: operation.error }),
        ...(operation.rollbackError === undefined ? {} : { rollbackError: operation.rollbackError }),
      }))
  }

  // ── 恢复执行细节 ────────────────────────────────────────────────────────

  /** 从 manifest 的后端读取一个路径的快照字节。 */
  private async readSnapshotContent(manifest: Manifest, path: string, signal?: AbortSignal): Promise<Buffer> {
    if (manifest.storage === 'jj') {
      if (manifest.commitId === undefined) {
        throw new ShadowRewindError('STATE_CORRUPT', `jj 恢复点 ${manifest.id} 缺少 commitId`)
      }
      const content = await this.shadowRepo(manifest.workspace).readSnapshot(manifest.commitId, path, signal)
      if (content === null) {
        throw new ShadowRewindError('STATE_CORRUPT', `影子仓库中不存在 ${JSON.stringify(path)}（commit ${manifest.commitId}）`)
      }
      return content
    }
    const entry = manifest.entries[path]
    if (entry === undefined || entry.kind !== 'file') {
      throw new ShadowRewindError('STATE_CORRUPT', `恢复点 ${manifest.id} 不含文件 ${JSON.stringify(path)}`)
    }
    return this.store.readBlob(manifest.workspace, entry.blob)
  }

  /** 把一组路径恢复成 manifest 记录的状态（先删后写；目录按需重建/回收）。 */
  private async restorePaths(workspace: string, manifest: Manifest, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    const root = await canonicalDirectory(workspace)
    // 防御性过滤：快照时显式跳过的路径永远不该出现在删除集合里（即使上层
    // 计划已过滤，这里再兜一次底——回滚等旁路也会调到本函数）。
    const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path))
    const deletions = paths.filter((path) => manifest.entries[path] === undefined && !skippedSet.has(path))
      .sort((left, right) => depthOf(right) - depthOf(left))
    const restorations = paths.filter((path) => manifest.entries[path] !== undefined)
      .sort((left, right) => depthOf(left) - depthOf(right))
    // 先删「快照中不存在」的路径（新增文件），深层优先，逐个收空目录。
    for (const path of deletions) {
      signal?.throwIfAborted()
      const target = resolveWorkspacePath(root, path)
      await assertSafeParents(root, target)
      await removeRestoreTarget(target)
      await pruneEmptyParents(root, target)
    }
    // 再恢复「快照中存在」的路径，浅层优先（父目录先就位）。
    for (const path of restorations) {
      signal?.throwIfAborted()
      const entry = manifest.entries[path]
      if (entry === undefined) continue
      const target = resolveWorkspacePath(root, path)
      await ensureSafeParents(root, target)
      if (entry.kind === 'symlink') {
        await removeRestoreTarget(target)
        await replaceSymbolicLink(target, entry.target)
        continue
      }
      const content = await this.readSnapshotContent(manifest, path, signal)
      if (sha256Hex(content) !== entry.blob) {
        throw new ShadowRewindError('BLOB_CORRUPT', `路径 ${JSON.stringify(path)} 的快照字节未通过哈希校验`)
      }
      await removeRestoreTarget(target)
      await replaceRegularFile(target, content, entry.mode)
    }
  }

  /** 恢复后验证：每个路径重新落盘读取并与快照条目全等。 */
  private async verifyRestored(workspace: string, manifest: Manifest, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    const root = await canonicalDirectory(workspace)
    for (const path of paths) {
      signal?.throwIfAborted()
      const entry = manifest.entries[path]
      const target = resolveWorkspacePath(root, path)
      if (entry === undefined) {
        // 期望不存在：验证它确实没了。
        let gone = false
        try {
          await lstat(target)
        } catch (error) {
          gone = isNodeError(error, 'ENOENT')
        }
        if (!gone) {
          throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后路径仍存在：${JSON.stringify(path)}`)
        }
        continue
      }
      let info
      try {
        info = await lstat(target, { bigint: true })
      } catch (error) {
        if (isNodeError(error, 'ENOENT')) {
          throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后路径缺失：${JSON.stringify(path)}`)
        }
        throw error
      }
      if (entry.kind === 'symlink') {
        if (!info.isSymbolicLink()) {
          throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后类型不符（应为符号链接）：${JSON.stringify(path)}`)
        }
        const targetValue = await readlink(target)
        if (targetValue !== entry.target) {
          throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后符号链接指向不符：${JSON.stringify(path)}`)
        }
        continue
      }
      if (!info.isFile()) {
        throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后类型不符（应为普通文件）：${JSON.stringify(path)}`)
      }
      // 权限位在 Windows 上不可靠，仅 POSIX 校验；内容始终校验。
      if (process.platform !== 'win32' && Number(info.mode & 0o7777n) !== entry.mode) {
        throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后权限不符：${JSON.stringify(path)}`)
      }
      const handle = await open(target, constants.O_RDONLY)
      try {
        const content = await readFileBounded(handle, entry.size)
        if (sha256Hex(content) !== entry.blob) {
          throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后内容不符：${JSON.stringify(path)}`)
        }
      } finally {
        await handle.close()
      }
    }
  }

  private async isReferencedByRecovery(workspace: string, restorePointId: string): Promise<boolean> {
    const operations = await this.store.listOperations(workspace)
    return operations.some((operation) => (operation.state === 'interrupted' || operation.state === 'recovery-required')
      && (operation.restorePointId === restorePointId || operation.rescuePointId === restorePointId))
  }

  private expirePlans(): void {
    const now = Date.now()
    for (const [id, plan] of this.plans) {
      if (plan.expiresAt <= now) this.plans.delete(id)
    }
  }
}

// ── 模块级工具 ─────────────────────────────────────────────────────────────

function summarize(manifest: Manifest): RestorePointSummary {
  return {
    format: manifest.version,
    id: manifest.id,
    kind: manifest.kind,
    workspace: manifest.workspace,
    storage: manifest.storage,
    ...(manifest.sessionId === undefined ? {} : { sessionId: manifest.sessionId }),
    ...(manifest.label === undefined ? {} : { label: manifest.label }),
    ...(manifest.turn === undefined ? {} : { turn: manifest.turn }),
    ...(manifest.turnStartSeq === undefined ? {} : { turnStartSeq: manifest.turnStartSeq }),
    createdAt: manifest.createdAt,
    treeHash: manifest.treeHash,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    skippedPathCount: manifest.skippedPaths.length,
    restoreCount: manifest.restoreCount,
    ...(manifest.lastRestoredAt === undefined ? {} : { lastRestoredAt: manifest.lastRestoredAt }),
  }
}

function structuredClonePlan(plan: RestorePlan): RestorePlan {
  return JSON.parse(JSON.stringify(plan)) as RestorePlan
}

function assertPlanFresh(plan: RestorePlan, currentEntries: Readonly<Record<string, SnapshotEntry>>): void {
  for (const change of plan.changes) {
    const expected = plan.expected[change.path] ?? null
    const actual = currentEntries[change.path] ?? null
    if (!entriesEquivalent(expected, actual)) {
      throw new ShadowRewindError('PLAN_STALE', `路径在计划生成后又被修改：${JSON.stringify(change.path)}；请重新检查`)
    }
  }
}

function entriesEquivalent(left: SnapshotEntry | null, right: SnapshotEntry | null): boolean {
  if (left === null || right === null) return left === right
  if (left.kind !== right.kind || left.mode !== right.mode) return false
  if (left.kind === 'file' && right.kind === 'file') return left.blob === right.blob && left.size === right.size
  return left.kind === 'symlink' && right.kind === 'symlink' && left.target === right.target
}

function depthOf(path: string): number {
  return path.split('/').length
}

/** 有界读文件：精确读满 expectedSize（不足即视为变化中的文件，返回短读由上层重试）。 */
async function readFileBounded(handle: import('node:fs/promises').FileHandle, expectedSize: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(expectedSize)
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

/** 自动检查点的失败中，哪些属于「可预期跳过」而非故障。 */
export function isCheckpointSkipCode(code: string): boolean {
  return code === 'TURN_CHECKPOINT_DISABLED'
    || code === 'TURN_CHECKPOINT_TIMEOUT'
    || code === 'TURN_CHECKPOINT_NEW_CONTENT_LIMIT'
    || code === 'SNAPSHOT_TOO_LARGE'
    || code === 'TOO_MANY_FILES'
}

/** 把捕获期错误包装为超时（保持外层 deadline 的语义）。 */
function wrapCheckpointDeadline(error: unknown, timeoutMs: number, deadlineAborted: boolean): unknown {
  if (deadlineAborted && !(error instanceof ShadowRewindError && error.code === 'TURN_CHECKPOINT_TIMEOUT')) {
    return new ShadowRewindError('TURN_CHECKPOINT_TIMEOUT', `自动检查点超出 ${String(timeoutMs)} ms`, { cause: error })
  }
  return error
}