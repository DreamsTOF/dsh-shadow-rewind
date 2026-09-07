/**
 * 核心引擎·基类：存储装配、当前树捕获、检查点内容读取与恢复路径执行。
 *
 * 拆分自原 engine.ts 的「存储/捕获半边」，子类（engine.ts 的
 * ShadowRewindEngine）继承后补齐计划/恢复/undo 生命周期。调用点全部保持
 * `this.xxx` 形态，行为零变化；仅原 private 成员中被子类访问的
 * （captureTree / assertReady）放宽为 protected。
 *
 * 两条铁律贯穿全部路径：
 *  1. 绝不调用工作区自身的任何 VCS——文件枚举只走目录扫描，快照字节只落在
 *     影子 jj 仓库或 SQLite 内容库；
 *  2. 恢复必须「恢复前自动 rescue 备份 + 事后哈希验证」，任何一步不符立即
 *     fail-closed（计划限时 + 确认串回显在子类实现）。
 */

import { constants } from 'node:fs'
import { chmod, lstat, mkdir, open, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { rm } from 'node:fs/promises'
import { captureSnapshot } from './capture.js'
import { clearCaptureCache, readCaptureCache, writeCaptureCache } from './capture-cache.js'
import { ShadowRewindError } from './errors.js'
import { jjAvailable, ShadowJj } from './jj-backend.js'
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
import { BeforeJournal } from './before-journal.js'
import { resolveConfig } from './engine-config.js'
import { depthOf, hasDescendantEntry, readFileBounded, summarize } from './engine-helpers.js'
import { diffTrees, sha256Hex } from './manifest.js'
import type { Manifest, ResolvedShadowRewindConfig, RestorePointSummary, ShadowRewindConfig, SkippedPath, SnapshotEntry, WorkspaceChange } from './types.js'

/** 一次当前树捕获的完整产物。 */
export interface CapturedTree {
  readonly root: string
  readonly entries: Record<string, SnapshotEntry>
  readonly skipped: readonly SkippedPath[]
  readonly treeHash: string
  readonly fileCount: number
  readonly totalBytes: number
  /** full 模式下的产出：影子仓库 commit id。 */
  readonly commitId?: string
}

/** 引擎存储/捕获半边的基类（一个插件进程共享一个，配置驱动，无隐藏全局状态）。 */
export class ShadowRewindEngineBase {
  readonly config: ResolvedShadowRewindConfig
  readonly store: WorkspaceStore
  /** 启动装配完成后的信号。 */
  readonly ready: Promise<void>

  /**
   * 实际生效的内容后端：配置为 jj 但宿主机缺 CLI 时自动降级为内置
   * SQLite 内容库（自动检查点不断档）；显式配置 sqlite/off 不受影响。
   */
  readonly effectiveBackend: 'jj' | 'sqlite'
  /** 降级原因（未降级时为 undefined）。 */
  readonly downgradeReason?: string

  private excludes: readonly ExcludeRule[]
  private readonly shadowRepos = new Map<string, ShadowJj>()
  /** BEFORE 捕获日志（主路捕获的存储半边；消息检查点的物化数据源）。 */
  protected readonly beforeJournal: BeforeJournal

  constructor(config: ShadowRewindConfig = {}) {
    this.config = resolveConfig(config)
    if (this.config.turnCheckpointMode === 'jj' && !jjAvailable()) {
      this.effectiveBackend = 'sqlite'
      this.downgradeReason = '宿主机没有可用的 jj CLI，自动检查点已降级为内置 SQLite 存储'
    } else {
      this.effectiveBackend = this.config.turnCheckpointMode === 'jj' ? 'jj' : 'sqlite'
    }
    this.excludes = compileExcludes(this.config.excludePatterns)
    this.store = new WorkspaceStore(this.config)
    this.beforeJournal = new BeforeJournal(this.store, this.config)
    this.ready = this.store.initialize()
  }

  /**
   * 运行时热更新配置（设置卡片 watch 链路，ABSORB-RECALL 1.2）：重新走
   * resolveConfig 落定（env 覆盖语义在热更路径同样成立），并按需重建排除
   * 编译缓存。storageDir / turnCheckpointMode 是启动级字段（存储根与后端
   * 装配在构造时定死），热更路径强制保留原值——schema 层已拒绝，这里是
   * 最后防线。
   */
  applyConfigPatch(patch: Record<string, unknown>): void {
    const next = resolveConfig({
      ...this.config,
      ...patch,
      storageDir: this.config.storageDir,
      turnCheckpointMode: this.config.turnCheckpointMode,
    })
    const excludesChanged = next.excludePatterns !== this.config.excludePatterns
    Object.assign(this.config, next)
    if (excludesChanged) this.excludes = compileExcludes(this.config.excludePatterns)
  }

  /** GC 双闸阈值：累计删除的 manifest 数达到该值即触发（与时间闸先到先触发）。 */
  private static readonly GC_PENDING_THRESHOLD = 50
  /** GC 双闸时间闸：距上次 GC 超过该间隔即触发。 */
  private static readonly GC_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000
  /** workspace → 双闸状态：累计删除 manifest 数与本次进程内上次 GC 时刻。 */
  private readonly gcPending = new Map<string, number>()
  private readonly gcLastRun = new Map<string, number>()

  /**
   * 删除后的 GC 统一入口（ABSORB-RECALL 六：双闸节流）。原实现挂在
   * create/delete/修剪后每次都跑——30 配额下修剪必触发，纯属浪费。改为
   * 「累计删除 ≥50 个 manifest」或「距上次 GC ≥24h」（gc.stamp 跨重启
   * 续存）先到先触发；孤儿 blob 至多滞留一个窗口期，换来修剪路径的零开销。
   * stamp 缺省 0 视为「很久以前」——每个工作区的首次删除照旧立即回收。
   */
  protected async garbageCollectAfterDeletion(workspace: string, deletedManifests: number): Promise<{ ran: boolean; deletedBlobs: number }> {
    const pending = (this.gcPending.get(workspace) ?? 0) + deletedManifests
    const stamp = this.gcLastRun.get(workspace) ?? await this.store.readGcStamp(workspace)
    const now = Date.now()
    if (pending < ShadowRewindEngineBase.GC_PENDING_THRESHOLD && now - stamp < ShadowRewindEngineBase.GC_MIN_INTERVAL_MS) {
      this.gcPending.set(workspace, pending)
      return { ran: false, deletedBlobs: 0 }
    }
    this.gcPending.set(workspace, 0)
    this.gcLastRun.set(workspace, now)
    await this.store.writeGcStamp(workspace, now).catch(() => undefined)
    const gc = await this.store.collectGarbage(workspace)
    if (gc.deletedBlobs > 0) {
      await clearCaptureCache(join(await this.store.workspaceDir(workspace), 'stat-cache.json'))
    }
    return { ran: true, deletedBlobs: gc.deletedBlobs }
  }

  /** 立即回收指定工作区的孤儿内容（管理面板「立即 GC」；绕过双闸节流）。 */
  async collectGarbageFor(cwd: string, signal?: AbortSignal): Promise<{ deletedBlobs: number; retainedBlobs: number }> {
    await this.assertReady(signal)
    const workspace = await canonicalDirectory(cwd)
    const gc = await this.store.collectGarbage(workspace)
    if (gc.deletedBlobs > 0) {
      await clearCaptureCache(join(await this.store.workspaceDir(workspace), 'stat-cache.json'))
    }
    return gc
  }

  /** 自动检查点是否被配置关闭（与降级区分）。 */
  get turnCheckpointsDisabled(): boolean {
    return this.config.turnCheckpointMode === 'off'
  }

  /** 等启动恢复完成；带 signal 时与之竞争（中止即拒绝）。 */
  protected async assertReady(signal?: AbortSignal): Promise<void> {
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
   * 扫描 + 捕获当前树（共用 stat 缓存增量，sqlite 与 jj 后端同路径）。
   *  - mode = 'inspect'：只构建 entries（供对比/计划）；缓存只读不写回，
   *    避免把对比时刻的 stat 事实污染成下一次持久捕获的增量依据；
   *  - mode = 'persist'：新读内容写入内容后端（sqlite 批量入库 / jj 镜像提交），
   *    并写回缓存，返回 commitId。
   */
  protected async captureTree(
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
    // 缓存命中校验：sqlite 模式 stat 内容库行、jj 模式 stat 镜像文件——
    // 存储被 GC / 影子仓库被清理后，命中项会在这里被识别为失效并重读，
    // 绝不让 manifest 引用「已死亡」的内容。
    const verifyContent = async (path: string, blob: string): Promise<boolean> => {
      if (this.effectiveBackend === 'jj') {
        return pathExists(join(this.shadowRepo(workspace).repoDir, 'checkpoint', ...path.split('/')))
      }
      return this.store.sqliteBlobExists(workspace, blob)
    }
    const captured = await captureSnapshot({
      root: scan.root,
      paths: scan.paths,
      skippedAtScan: scan.skipped,
      emptyDirs: scan.emptyDirs,
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
        // sqlite 后端：把新读内容批量写入内容库（单事务；命中缓存的路径已在库里）。
        // K2：与 jj 后端同一份字节闸——配额语义不随后端分叉（此前 sqlite
        // 路径完全无闸，超限内容在 jj 下被跳过、sqlite 下却成功写入）。
        let newBytes = 0
        const items: { readonly hash: string; readonly content: Buffer }[] = []
        for (const [path, content] of captured.newContent) {
          newBytes += content.length
          if (newBytes > this.config.turnCheckpointMaxNewBytes) {
            throw new ShadowRewindError('TURN_CHECKPOINT_NEW_CONTENT_LIMIT',
              `本次自动检查点需新写 ${String(newBytes)} 字节，超出上限 ${String(this.config.turnCheckpointMaxNewBytes)}`)
          }
          const entry = captured.entries[path]
          if (entry === undefined || entry.kind !== 'file') continue
          items.push({ hash: entry.blob, content })
        }
        await this.store.putSqliteBlobs(workspace, items)
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
    // K1：重建即清——旧 manifest 引用的 commit 随仓库全部死亡，列表不得
    // 再展示恢复必败的条目；清空清单，从重建后的第一份快照重新开始。
    await this.store.purgeManifests(workspace)
    this.shadowRepos.delete(workspace) // 丢弃旧句柄（initialized 标记已失效）
    return (await captureOnce()).commitId
  }

  // ── 检查点内容读取 / 只读查询 ───────────────────────────────────────────

  /** 读取一个检查点的完整条目投影（B1：轨迹重放用它补重放基线）。 */
  async getCheckpointEntries(options: {
    readonly cwd: string
    readonly restorePointId: string
    readonly signal?: AbortSignal
  }): Promise<Readonly<Record<string, SnapshotEntry>>> {
    await this.assertReady(options.signal)
    const workspace = await canonicalDirectory(options.cwd)
    const manifest = await this.store.readManifest(workspace, options.restorePointId)
    return manifest.entries
  }

  /** 查找一个回合的轮起检查点（可选校验 turnStartSeq；轮末相位不参与恢复点查找）。 */
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
      && manifest.phase !== 'end'
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

  /** 列出某会话的所有 turn 检查点（轮起+轮末，按 turn 升序；摘要带 phase）。 */
  async listTurnCheckpoints(options: {
    readonly cwd: string
    readonly sessionId: string
  }): Promise<readonly RestorePointSummary[]> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    const manifests = await this.store.listManifests(workspace)
    return manifests
      .filter((manifest) => manifest.kind === 'turn' && manifest.sessionId === options.sessionId)
      .sort((left, right) => (left.turn ?? 0) - (right.turn ?? 0) || left.id.localeCompare(right.id))
      .map(summarize)
  }

  /**
   * 对比两个检查点的 entries，生成文件系统级别的变更列表。
   * 用于捕获 PowerShell 等终端命令创建/修改/删除的文件（这些没有工具结果节点）。
   * 返回的 changes 结构与 diffTrees 一致，但来源是快照间对比而非当前树。
   */
  async diffCheckpoints(options: {
    readonly cwd: string
    readonly prevCheckpointId: string
    readonly currCheckpointId: string
  }): Promise<{
    readonly changes: readonly WorkspaceChange[]
    readonly skippedPaths: readonly SkippedPath[]
  }> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    const prevManifest = await this.store.readManifest(workspace, options.prevCheckpointId)
    const currManifest = await this.store.readManifest(workspace, options.currCheckpointId)

    // 直接对比两个 manifest 的 entries
    const changes = diffTrees(prevManifest.entries, currManifest.entries)

    // 合并跳过项（任一方跳过的都透出）
    const skippedMap = new Map<string, SkippedPath>()
    for (const skip of prevManifest.skippedPaths) skippedMap.set(skip.path, skip)
    for (const skip of currManifest.skippedPaths) skippedMap.set(skip.path, skip)

    return {
      changes,
      skippedPaths: [...skippedMap.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    }
  }

  /**
   * 从指定检查点读取文件内容。用于为文件系统变更生成完整 diff。
   * 返回 null 表示文件在该检查点不存在（新增或删除）。
   */
  async getFileContentFromCheckpoint(options: {
    readonly cwd: string
    readonly checkpointId: string
    readonly path: string
  }): Promise<Buffer | null> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    const manifest = await this.store.readManifest(workspace, options.checkpointId)
    const entry = manifest.entries[options.path]
    if (!entry || entry.kind !== 'file') return null
    return this.readSnapshotContent(manifest, options.path)
  }

  /**
   * 降级标注（degraded）：检查点的快照内容是否仍可读。抽样「最小的文件条目」
   * 走真实读取路径探测两个后端（jj 影子仓库 / sqlite blob）；清单不存在或
   * 抽样读取失败 = 不可读。只读探测，绝不写任何数据。
   * 借鉴 dsh-checkpoint-diff 的 degraded 标注思路：丢失节点诚实标注，
   * 而不是等到恢复/读取时才响亮报错。
   */
  async checkpointContentReadable(options: {
    readonly cwd: string
    readonly restorePointId: string
  }): Promise<boolean> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    const manifest = await this.store.readManifest(workspace, options.restorePointId)
    // 抽样 3 个（最小 / 最大 / 中位大小）：单样本只覆盖一个 blob 的死活，
    // 大小分布两端的样本能抓住更多「部分损坏」形态。全量校验是恢复时的
    // fail-closed 职责，这里只做 UI 标注——全量化会让大检查点变慢。
    const files = Object.entries(manifest.entries)
      .filter(([, entry]) => entry.kind === 'file')
      .map(([path, entry]) => ({ path, size: entry.kind === 'file' ? entry.size : 0 }))
      .sort((left, right) => left.size - right.size)
    if (files.length === 0) return true
    const samples = files.length <= 2
      ? files
      : [files[0]!, files[Math.floor(files.length / 2)]!, files[files.length - 1]!]
    try {
      for (const sample of samples) {
        await this.readSnapshotContent(manifest, sample.path)
      }
      return true
    } catch {
      return false
    }
  }

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

  // ── 快照内容与恢复路径执行 ──────────────────────────────────────────────

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
    return this.store.readSqliteBlob(manifest.workspace, entry.blob)
  }

  /** 把一组路径恢复成 manifest 记录的状态（先删后写；目录按需重建/回收）。 */
  protected async restorePaths(workspace: string, manifest: Manifest, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    const root = await canonicalDirectory(workspace)
    // 防御性过滤：快照时显式跳过的路径永远不该出现在删除集合里（即使上层
    // 计划已过滤，这里再兜一次底——回滚等旁路也会调到本函数）。
    const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path))
    const deletions = paths.filter((path) => manifest.entries[path] === undefined
      && !skippedSet.has(path)
      && !hasDescendantEntry(manifest, path))
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
      if (entry.kind === 'dir') {
        // 空目录条目：占位路径先移除，再按记录的权限位重建。
        await removeRestoreTarget(target)
        await mkdir(target)
        if (process.platform !== 'win32') await chmod(target, entry.mode)
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
  protected async verifyRestored(workspace: string, manifest: Manifest, paths: readonly string[], signal?: AbortSignal): Promise<void> {
    const root = await canonicalDirectory(workspace)
    for (const path of paths) {
      signal?.throwIfAborted()
      const entry = manifest.entries[path]
      const target = resolveWorkspacePath(root, path)
      if (entry === undefined) {
        if (hasDescendantEntry(manifest, path)) {
          // 隐式目录：快照没有它的条目，但子条目经它恢复——验证它是目录即可。
          let info
          try {
            info = await lstat(target)
          } catch (error) {
            if (isNodeError(error, 'ENOENT')) {
              throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后隐式目录缺失：${JSON.stringify(path)}`)
            }
            throw error
          }
          if (!info.isDirectory()) {
            throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后类型不符（应为目录）：${JSON.stringify(path)}`)
          }
          continue
        }
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
      if (entry.kind === 'dir') {
        if (!info.isDirectory()) {
          throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后类型不符（应为目录）：${JSON.stringify(path)}`)
        }
        if (process.platform !== 'win32' && Number(info.mode & 0o7777n) !== entry.mode) {
          throw new ShadowRewindError('RESTORE_VERIFY_FAILED', `恢复后目录权限不符：${JSON.stringify(path)}`)
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
}
