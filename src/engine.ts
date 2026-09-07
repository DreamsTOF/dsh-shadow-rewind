/**
 * 核心引擎：捕获 / 对比 / 计划 / 恢复 / 删除。
 *
 * 两条铁律贯穿全部路径：
 *  1. 绝不调用工作区自身的任何 VCS——文件枚举只走目录扫描，快照字节只落在
 *     影子 jj 仓库或 SQLite 内容库；
 *  2. 恢复 = 恢复前自动 rescue 备份 + 事后哈希验证，失败即进程内自动回滚
 *     到状态 A——「要么 B 要么回 A」的两态翻转（EXPECTED-DESIGN 1.4）。
 *
 * 物理布局（拆分后本文件持有引擎主类与生命周期方法，公开 API 不变）：
 *  - ./engine-config.ts  配置解析与默认值；
 *  - ./engine-base.ts    存储装配 / 当前树捕获 / 检查点内容读取 / 恢复路径执行；
 *  - ./engine-helpers.ts 摘要投影 / 计划新鲜度断言等纯函数。
 *
 * EXPECTED-DESIGN 1.4 落地：lock.json 互斥（#9）、持久操作日志状态机（#11）、
 * 计划 TTL 拒绝（#1）、逐字确认串（#2）、会话绑定拒绝（#3）均已废除/降级；
 * 选择权通过 probe + force（1.2）交给用户。
 */
import { join } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import { clearCaptureCache } from './capture-cache.js'
import { createDeadline } from './deadline.js'
import { ShadowRewindError, errorMessage } from './errors.js'
import { canonicalDirectory, isNodeError, resolveWorkspacePath, validateRelativePath } from './path-utils.js'
import { diffTrees, entriesEqual, hashTree, makeId, sha256Hex } from './manifest.js'
import type { LineageEntry } from './store.js'
import type { SnapshotEntry, WorkspaceChange } from './types.js'
import {
  FORMAT_VERSION,
  type Manifest,
  type RestorePlan,
  type RestorePointKind,
  type RestorePointSummary,
  type RestoreResult,
  type RestoreUndoProbe,
  type RestoreUndoResult,
  type ShadowRewindConfig,
  type SkippedPath,
  type TurnIntent,
  type RestorePlanId,
} from './types.js'
import { ShadowRewindEngineBase } from './engine-base.js'
import { diffAgainstManifest, summarize, structuredClonePlan, assertPlanFresh, wrapCheckpointDeadline } from './engine-helpers.js'

// 原公开 API（index.ts `export * from './engine.js'` 的面）保持不变：
// DEFAULT_EXCLUDES / resolveConfig / isCheckpointSkipCode 现居拆分文件。
export { DEFAULT_EXCLUDES, resolveConfig } from './engine-config.js'
export { isCheckpointSkipCode } from './engine-helpers.js'

/** 撤销记录的单文件条目：before = 恢复前磁盘条目（null = 当时不存在），
 * after = 恢复后条目（null = 恢复把它删了）。 */
interface RestoreUndoRecord {
  readonly restorePointId: string
  readonly rescuePointId: string
  readonly time: number
  readonly files: readonly { readonly rel: string; readonly before: SnapshotEntry | null; readonly after: SnapshotEntry | null }[]
}

/** 过期计划的内存保留窗口：TTL 只作软警告，过期计划仍可执行；
 * 只有远超窗口的陈旧计划才从内存淘汰（进程重启天然清零）。 */
const PLAN_RETENTION_MS = 24 * 60 * 60 * 1_000

/** 工作区相对路径白名单（物化 BEFORE 日志时的 fail-safe 闸）。 */
function isSafeRelativePath(path: string): boolean {
  try {
    validateRelativePath(path)
    return true
  } catch {
    return false
  }
}

/** 撤销范围解析：缺省 = 记录里的全部路径；给 paths 时必须是记录成员
 * （未知路径立即拒绝——防止拿错版本的清单拼出半个撤销）。 */
function resolveUndoScope(record: RestoreUndoRecord, paths: readonly string[] | undefined): readonly string[] {
  if (paths === undefined) return record.files.map((file) => file.rel)
  const known = new Set(record.files.map((file) => file.rel))
  const unknown = paths.filter((path) => !known.has(path))
  if (unknown.length > 0) {
    throw new ShadowRewindError('INVALID_ARGUMENTS', `以下路径不在可撤销清单里：${unknown.slice(0, 5).join(', ')}`)
  }
  return [...new Set(paths)]
}

/** 引擎实例：一个插件进程共享一个（配置驱动，无隐藏全局状态）。 */
export class ShadowRewindEngine extends ShadowRewindEngineBase {
  private readonly plans = new Map<RestorePlanId, RestorePlan & { expired?: boolean }>()
  private readonly applying = new Set<RestorePlanId>()
  /** 恢复后单次撤销（B1）：workspace → 最近一次恢复的逐路径 before/after。
   * 进程内记录，重启即失效；每次 applyRestore 替换上一次（无 redo）。
   * 部分撤销时按成功路径收缩，全部撤销完才销毁。 */
  private readonly undoRecords = new Map<string, RestoreUndoRecord>()

  constructor(config: ShadowRewindConfig = {}) {
    super(config)
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
  }

  /** 捕获回合检查点（turn）；重复请求同一回合同一相位时幂等返回已有检查点。
   * phase 'start'（缺省）= 轮第一步之前；'end' = turn/end 事件时的轮末快照。 */
  async createTurnCheckpoint(options: {
    readonly cwd: string
    readonly sessionId: string
    readonly turn: number
    readonly turnStartSeq: number
    readonly phase?: 'start' | 'end'
    /** 轮末检查点的本轮内容型工具调用摘要（仅 phase='end' 合法）。 */
    readonly intent?: readonly TurnIntent[]
    readonly signal?: AbortSignal
  }): Promise<RestorePointSummary> {
    const phase = options.phase ?? 'start'
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
      const existing = await this.store.listManifests(workspace)
      const duplicate = existing.find((manifest) => manifest.kind === 'turn'
        && manifest.sessionId === options.sessionId
        && manifest.turn === options.turn
        && manifest.turnStartSeq === options.turnStartSeq
        && (manifest.phase ?? 'start') === phase)
      if (duplicate !== undefined) {
        await this.store.deleteTurnSkip(workspace, options.sessionId, options.turn, options.turnStartSeq).catch(() => undefined)
        return summarize(duplicate)
      }
      const manifest = await this.createLocked(workspace, {
        kind: 'turn',
        sessionId: options.sessionId,
        turn: options.turn,
        turnStartSeq: options.turnStartSeq,
        phase,
        ...(phase === 'end' && options.intent !== undefined ? { intent: options.intent } : {}),
        label: `turn ${String(options.turn)} ${phase === 'end' ? '轮末' : '轮起'}检查点`,
        signal,
      })
      await this.store.deleteTurnSkip(workspace, options.sessionId, options.turn, options.turnStartSeq).catch(() => undefined)
      // 修剪：每会话每相位各保留最新的 N 个 turn 检查点（轮起与轮末互不挤占）。
      // jj 后端的影子 change 不随之删除——change id 是内容历史的地址，
      // 保留无害，删除反而需要额外的 abandon 流程；自用存储换简单性。
      const sameSession = [...existing, manifest]
        .filter((point) => point.kind === 'turn' && point.sessionId === options.sessionId
          && (point.phase ?? 'start') === phase)
        .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      let prunedTurnCheckpoints = 0
      for (const stale of sameSession.slice(this.config.maxTurnCheckpointsPerSession)) {
        if (signal.aborted) break
        if (await this.isReferencedByUndo(workspace, stale.id)) continue
        await this.store.deleteManifest(workspace, stale.id).catch(() => undefined)
        prunedTurnCheckpoints += 1
      }
      if (prunedTurnCheckpoints > 0) {
        // 修剪补 GC（K4）：被修剪 manifest 的 blob 回收不再等下一次无关的
        // create/delete 顺带清理；双闸节流见 engine-base（ABSORB-RECALL 六）。
        await this.garbageCollectAfterDeletion(workspace, prunedTurnCheckpoints)
      }
      return summarize(manifest)
    } catch (error) {
      throw wrapCheckpointDeadline(error, this.config.turnCheckpointTimeoutMs, deadline.signal.aborted)
    } finally {
      deadline.cancel()
    }
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
      readonly phase?: 'start' | 'end'
      readonly intent?: readonly TurnIntent[]
      readonly signal?: AbortSignal
    },
  ): Promise<Manifest> {
    const tree = await this.captureTree(workspace, {
      mode: 'persist',
      message: options.kind === 'turn'
        ? `turn ${String(options.turn)} ${options.phase === 'end' ? 'end' : 'start'} checkpoint (session ${options.sessionId ?? '?'})`
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
      ...(options.phase === undefined ? {} : { phase: options.phase }),
      ...(options.intent === undefined ? {} : { intent: options.intent }),
      createdAt: Date.now(),
      treeHash: tree.treeHash,
      fileCount: tree.fileCount,
      totalBytes: tree.totalBytes,
      entries: tree.entries,
      skippedPaths: tree.skipped,
      restoreCount: 0,
    }
    await this.store.writeManifest(workspace, manifest)
    let prunedRescues = 0
    if (options.kind === 'rescue') {
      // rescue 修剪先于 GC（K4）：本轮修剪掉的 manifest 的 blob 立即进入
      // 本轮 GC 的可回收范围，而不是活到下一轮。rescue 不计入
      // maxRestorePoints（自动安全网不挤占手动配额），但不能无限堆积。
      const rescues = (await this.store.listManifests(workspace))
        .filter((point) => point.kind === 'rescue')
        .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      for (const stale of rescues.slice(Math.max(1, this.config.maxRestorePoints))) {
        if (await this.isReferencedByUndo(workspace, stale.id)) continue
        await this.store.deleteManifest(workspace, stale.id).catch(() => undefined)
        prunedRescues += 1
      }
    }
    if (options.kind !== 'turn') {
      // GC 只删未被引用的内容行（节流见 engine-base 双闸，ABSORB-RECALL 六）；
      // 一旦真删了内容，helper 内会同步作废 stat 缓存，否则下一次命中会把
      // 已删除的 blob 引用进新 manifest（死引用）。
      await this.garbageCollectAfterDeletion(workspace, 1 + prunedRescues)
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
    const manifest = await this.store.readManifest(workspace, options.restorePointId)
    const current = await this.captureTree(workspace, { mode: 'inspect', signal: options.signal })
    // 跳过项不构成恢复动作，也不应伪装成 added 变更迷惑用户——单独透出。
    const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path))
    return {
      restorePoint: summarize(manifest),
      currentTreeHash: current.treeHash,
      changes: diffAgainstManifest(manifest, current.entries)
        .filter((change) => !skippedSet.has(change.path)),
      skippedPaths: manifest.skippedPaths,
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
    const manifest = await this.store.readManifest(workspace, options.restorePointId)
    const current = await this.captureTree(workspace, { mode: 'inspect', signal: options.signal })
    // 树哈希 CAS（1.4 #5，检测保留）：检查之后工作区又变了 → PLAN_STALE。
    if (options.expectedCurrentTreeHash !== undefined && options.expectedCurrentTreeHash !== current.treeHash) {
      throw new ShadowRewindError('PLAN_STALE', '检查之后工作区又发生了变化；请重新检查')
    }
    // 快照时被显式跳过的路径（过大/不支持/读取失败）不在快照里，因此它们
    // 此后的任何变化都绝不构成恢复动作——否则「新增的大文件」会在恢复时
    // 被误删，违背「恢复不碰跳过项」的承诺。
    const skippedSet = new Set(manifest.skippedPaths.map((skip) => skip.path))
    let changes = diffAgainstManifest(manifest, current.entries)
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
      changes,
      skippedPaths: manifest.skippedPaths,
      expected,
    }
    this.plans.set(plan.id, plan)
    return structuredClonePlan(plan)
  }

  /** 查询内存中的恢复计划（不存在返回 undefined；TTL 过期不拒绝——
   * 软警告字段 `expired` 随计划透出，EXPECTED-DESIGN 1.4 #1）。
   * 供 HTTP 层核对「计划与所选检查点同源」。 */
  getRestorePlan(planId: RestorePlanId): (RestorePlan & { expired?: boolean }) | undefined {
    this.expirePlans()
    const plan = this.plans.get(planId)
    if (plan === undefined) return undefined
    return structuredClonePlan(plan)
  }

  /** 执行一个已批准的恢复计划：rescue → 恢复 → 验证（失败自动回滚到状态 A）。
   * EXPECTED-DESIGN 1.4：确认串（#2）与会话绑定拒绝（#3）已废除——后者降级
   * 为结果里的软警告；TTL 过期（#1）不阻断；真正的防漂移闸是 assertPlanFresh。
   * skipUndoRecord：补偿性质的恢复（如 fork 失败的自动回滚）不写 undo 单槽
   * ——它会把「撤销最近一次恢复」的指向覆盖成补偿自己，语义反转。 */
  async applyRestore(options: {
    readonly planId: string
    readonly sessionId?: string
    readonly signal?: AbortSignal
    readonly skipUndoRecord?: boolean
  }): Promise<RestoreResult> {
    await this.assertReady(options.signal)
    this.expirePlans()
    const plan = this.plans.get(options.planId)
    if (plan === undefined) {
      throw new ShadowRewindError('PLAN_NOT_FOUND', `恢复计划 ${options.planId} 不存在`)
    }
    const warnings: string[] = []
    // 会话绑定（1.4 #3）：不匹配降级为软警告，不阻断——选择权在用户。
    if (plan.sessionId !== undefined && plan.sessionId !== options.sessionId) {
      warnings.push(`恢复计划属于会话 ${plan.sessionId}，当前调用方是 ${options.sessionId ?? '（未声明）'}；已按你的选择继续执行`)
    }
    if (this.applying.has(plan.id)) {
      throw new ShadowRewindError('PLAN_IN_PROGRESS', '该恢复计划正在执行')
    }
    this.applying.add(plan.id)
    try {
      const manifest = await this.store.readManifest(plan.workspace, plan.restorePointId)
      // 计划复核（1.4 #4，检测保留）：每条待恢复路径的当前内容必须仍与计划时一致。
      const current = await this.captureTree(plan.workspace, { mode: 'inspect', signal: options.signal })
      assertPlanFresh(plan, current.entries)
      const paths = plan.changes.map((change) => change.path)
      // 恢复前自动备份当前状态——失败的回滚与「后悔药」都靠它。
      const rescue = await this.createLocked(plan.workspace, {
        kind: 'rescue',
        label: `恢复 ${manifest.id} 之前`,
        parentRestorePoint: manifest.id,
        sessionId: options.sessionId,
        signal: options.signal,
      })
      try {
        await this.restorePaths(plan.workspace, manifest, paths, options.signal)
        await this.verifyRestored(plan.workspace, manifest, paths, options.signal)
        await this.store.writeManifest(plan.workspace, {
          ...manifest,
          restoreCount: manifest.restoreCount + 1,
          lastRestoredAt: Date.now(),
        })
        // B1 撤销记录：before = 计划复核时的磁盘条目（rescue 同一刻），
        // after = 快照条目（缺省 = 恢复把它删了）。撤销时逐路径 CAS；
        // force 撤销（用户授权）可绕过 CAS 覆盖后续修改。
        // fork 失败的补偿回滚走 skipUndoRecord：补偿本身也是 applyRestore，
        // 若覆盖单槽记录，「撤销恢复」会被静默反转为「重新应用恢复」。
        if (options.skipUndoRecord !== true) {
          this.undoRecords.set(plan.workspace, {
            restorePointId: manifest.id,
            rescuePointId: rescue.id,
            time: Date.now(),
            files: plan.changes.map((change) => ({
              rel: change.path,
              before: current.entries[change.path] ?? null,
              after: manifest.entries[change.path] ?? null,
            })),
          })
        }
        this.plans.delete(plan.id)
        const result: RestoreResult = {
          restorePointId: manifest.id,
          rescuePointId: rescue.id,
          restoredPaths: paths,
          ...(warnings.length > 0 ? { warnings } : {}),
        }
        return result
      } catch (error) {
        // 主恢复失败 → 立即从 rescue 点回滚全部涉及路径（两态翻转的「回 A」）。
        // 回滚不走 expected 复核：目标就是把状态打回 rescue 时点。
        try {
          const affected = [...new Set([
            ...paths,
            ...diffTrees(rescue.entries, current.entries).map((change) => change.path),
          ])]
          await this.restorePaths(plan.workspace, rescue, affected, options.signal)
          await this.verifyRestored(plan.workspace, rescue, affected, options.signal)
          throw new ShadowRewindError('RESTORE_FAILED_ROLLED_BACK',
            `恢复失败，已自动从备份 ${rescue.id} 还原：${errorMessage(error)}`, { cause: error })
        } catch (rollbackError) {
          if (rollbackError instanceof ShadowRewindError && rollbackError.code === 'RESTORE_FAILED_ROLLED_BACK') {
            throw rollbackError
          }
          // 回滚也失败：不再维护持久化的 recovery-required 状态（1.4 #11）——
          // rescue 点仍在，翻转可幂等重跑，用户重试即收敛。
          throw new ShadowRewindError('RECOVERY_REQUIRED',
            `恢复失败且回滚也失败；可从备份点 ${rescue.id} 重试恢复。主错误：${errorMessage(error)}；回滚错误：${errorMessage(rollbackError)}`)
        }
      }
    } finally {
      this.applying.delete(plan.id)
    }
  }

  /**
   * 撤销最近一次恢复（B1，EXPECTED-DESIGN 1.2 两段式协议）。
   *
   * mode = 'probe'：只做逐路径 CAS 只读比对，返回 {clean, conflicted}——
   * 客户端据此弹三选项对话框（拒绝 / 全部回滚 / 只回滚正常部分），不动磁盘。
   *
   * mode = 'apply'（缺省）执行撤销：
   *  - 逐路径 CAS：当前磁盘条目必须仍等于「恢复后」的状态（内容寻址等价）；
   *    失配路径跳过并如实报告，绝不猜着回退；全部失配 → 409（UNDO_CONFLICT）；
   *  - force = true（用户在弹窗显式授权「全部回滚 / 二次回滚」）：对指定
   *    路径绕过 CAS，直接从 rescue 清单回写——覆盖恢复之后的用户修改；
   *    before=null 的路径（恢复新建的）强制撤销即删除，即使被改过——这是
   *    「绝不删除」的第二处用户授权例外；
   *  - paths：子集撤销（二次回滚按清单来）；成功路径从 undo 记录中收缩，
   *    记录清空才销毁——部分成功永远可重试；
   *  - 撤销动作复用 rescue 清单的 restorePaths（全套安全路径：围栏断言、
   *    原子写、空目录回收、非空拒删、跳过项不删）。
   */
  async undoLastRestore(options: {
    readonly cwd: string
    readonly mode?: 'apply'
    readonly force?: boolean
    readonly paths?: readonly string[]
    readonly signal?: AbortSignal
  }): Promise<RestoreUndoResult>
  async undoLastRestore(options: {
    readonly cwd: string
    readonly mode: 'probe'
    readonly paths?: readonly string[]
    readonly signal?: AbortSignal
  }): Promise<RestoreUndoProbe>
  async undoLastRestore(options: {
    readonly cwd: string
    readonly mode?: 'probe' | 'apply'
    readonly force?: boolean
    readonly paths?: readonly string[]
    readonly signal?: AbortSignal
  }): Promise<RestoreUndoProbe | RestoreUndoResult> {
    await this.assertReady(options.signal)
    const workspace = await canonicalDirectory(options.cwd)
    const record = this.undoRecords.get(workspace)
    if (record === undefined) {
      throw new ShadowRewindError('UNDO_NOT_FOUND',
        '没有可撤销的恢复（进程内只保留最近一次，重启后失效；可从恢复时自动创建的备份点手工恢复）')
    }
    const scope = resolveUndoScope(record, options.paths)
    const rescue = await this.store.readManifest(workspace, record.rescuePointId)
    const current = await this.captureTree(workspace, { mode: 'inspect', signal: options.signal })
    // 逐路径 CAS 分类（probe 与 apply 共用同一判定，保证弹窗看到的与执行的
    // 是同一份事实）。
    const clean: string[] = []
    const conflicted: { path: string; reason: string }[] = []
    for (const rel of scope) {
      const file = record.files.find((entry) => entry.rel === rel)
      if (file === undefined) continue
      const now = current.entries[file.rel] ?? null
      const matches = file.after === null
        ? now === null
        : now !== null && entriesEqual(now, file.after)
      if (matches) clean.push(file.rel)
      else conflicted.push({ path: file.rel, reason: 'content was modified after the restore' })
    }
    if (options.mode === 'probe') {
      return {
        restorePointId: record.restorePointId,
        rescuePointId: record.rescuePointId,
        time: record.time,
        clean,
        conflicted,
      }
    }
    const force = options.force === true
    const undonePaths: string[] = []
    const skippedPaths: { path: string; reason: string }[] = []
    for (const rel of scope) {
      const file = record.files.find((entry) => entry.rel === rel)
      if (file === undefined) continue
      const isClean = clean.includes(rel)
      if (!isClean && !force) {
        const conflict = conflicted.find((entry) => entry.path === rel)
        skippedPaths.push({ path: rel, reason: conflict?.reason ?? 'content was modified after the restore; skipped' })
        continue
      }
      try {
        await this.restorePaths(workspace, rescue, [rel], options.signal)
        await this.verifyRestored(workspace, rescue, [rel], options.signal)
        undonePaths.push(rel)
      } catch (error) {
        skippedPaths.push({ path: rel, reason: `undo failed: ${errorMessage(error)}` })
      }
    }
    if (undonePaths.length === 0 && skippedPaths.length > 0 && !force) {
      throw new ShadowRewindError('UNDO_CONFLICT',
        `全部路径都已被后续修改，无法撤销；可在确认后强制回滚，或从备份点 ${record.rescuePointId} 手工恢复`)
    }
    // 成功路径从记录中收缩：记录清空才销毁——被跳过的路径还有机会重试
    // （弹窗二次回滚 = force + 剩余清单），销毁即永久搁浅。
    const remaining = record.files.filter((file) => !undonePaths.includes(file.rel))
    if (remaining.length === 0) this.undoRecords.delete(workspace)
    else if (remaining.length !== record.files.length) {
      this.undoRecords.set(workspace, { ...record, files: remaining })
    }
    return {
      restorePointId: record.restorePointId,
      rescuePointId: record.rescuePointId,
      undonePaths,
      skippedPaths,
    }
  }

  /** 删除一个恢复点（EXPECTED-DESIGN 1.4 #2：确认串废除；被进程内 undo
   * 记录引用的 rescue 点仍拒绝删除——那是「撤销最近一次恢复」的命脉）。 */
  async delete(options: {
    readonly cwd: string
    readonly restorePointId: string
    readonly signal?: AbortSignal
  }): Promise<{ restorePointId: string; deletedBlobs?: number }> {
    await this.assertReady(options.signal)
    const workspace = await canonicalDirectory(options.cwd)
    if (await this.isReferencedByUndo(workspace, options.restorePointId)) {
      throw new ShadowRewindError('UNDO_REFERENCE', '该恢复点仍被「撤销最近一次恢复」引用，不能删除')
    }
    await this.store.deleteManifest(workspace, options.restorePointId)
    // GC 走双闸节流（ABSORB-RECALL 六）；真删了内容时 helper 内同步作废
    // stat 缓存（不作废的话下一次命中会把死引用写进新 manifest）。
    const gc = await this.garbageCollectAfterDeletion(workspace, 1)
    // 影子 jj 的历史 change 保留不删：它们只是内容地址，删除 manifest 已
    // 让其不可达；批量 abandon 属于运维操作，不混进插件生命周期。
    return { restorePointId: options.restorePointId, ...(gc.deletedBlobs > 0 ? { deletedBlobs: gc.deletedBlobs } : {}) }
  }

  // ── BEFORE 捕获（主路，Claude Code 式）与消息检查点兜底 ─────────────────

  /**
   * 记录一条写盘前捕获（宿主 tools/execute 瀑布调用）。
   * 内容内联进 BEFORE 日志；超限文件（maxFileBytes）直接放弃——
   * 兜底覆盖不到的字节仍有影子整树快照兜着。
   */
  async recordBeforeEntry(options: {
    readonly workspace: string
    readonly sessionId: string
    readonly anchorSeq: number
    readonly callId: string
    /** 工作区相对路径（'/' 分隔）。 */
    readonly rel: string
    readonly existed: boolean
    readonly content: string | null
    readonly mode: number
  }): Promise<void> {
    await this.assertReady()
    const size = options.content === null ? 0 : Buffer.byteLength(options.content, 'utf8')
    if (size > this.config.maxFileBytes) return
    await this.beforeJournal.record(options.workspace, options.sessionId, {
      callId: options.callId,
      anchorSeq: options.anchorSeq,
      path: options.rel,
      existed: options.existed,
      content: options.content,
      size,
      mode: options.mode,
    })
    // 周期性 prune：被清理的 anchor 对应的消息检查点一并删除，让内容 GC
    // 回收独占 blob。失败只丢清理时机，不丢正确性。
    void this.beforeJournal.prune(options.workspace, options.sessionId)
      .then((pruned) => {
        if (pruned.length === 0) return
        return this.pruneMessageRestorePoints(options.workspace, options.sessionId, pruned)
      })
      .catch(() => undefined)
  }

  /**
   * user/message 边界重查（抄 dsh-rewind reconcileTracked）：把本会话全部
   * 被跟踪路径与最近已知内容比对，变化者（含外部编辑/删除）补一条以本消息
   * 锚定的 BEFORE 记录。返回补录条数（仅诊断用）。
   */
  async reconcileTrackedBefore(options: {
    readonly workspace: string
    readonly sessionId: string
    readonly anchorSeq: number
  }): Promise<number> {
    await this.assertReady()
    const tracked = await this.beforeJournal.trackedPaths(options.workspace, options.sessionId)
    let recorded = 0
    for (const rel of tracked) {
      const known = this.beforeJournal.lastKnownContent(options.workspace, options.sessionId, rel)
      const abs = resolveWorkspacePath(options.workspace, rel)
      let content: string | null
      let mode = 0o644
      try {
        const stat = await lstat(abs)
        if (!stat.isFile()) continue
        // 与 scan/capture 同一 mode 口径（原始权限位），undo CAS 不假冲突。
        mode = Number(stat.mode & 0o7777)
        content = await readFile(abs, 'utf8')
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) continue
        content = null
      }
      if (known !== undefined && known === content) continue
      await this.beforeJournal.record(options.workspace, options.sessionId, {
        callId: `recheck-${String(options.anchorSeq)}-${sha256Hex(Buffer.from(rel, 'utf8')).slice(0, 8)}`,
        anchorSeq: options.anchorSeq,
        path: rel,
        existed: content !== null,
        content,
        size: content === null ? 0 : Buffer.byteLength(content, 'utf8'),
        mode,
      })
      recorded += 1
    }
    return recorded
  }

  /**
   * 物化「消息 S 之前」的部分树检查点（BEFORE 日志 → kind 'message' 恢复点）。
   *
   * 这是检查点缺席（关闭/失败/被修剪）时的兜底：每路径取 anchorSeq >= S 的
   * 最早 BEFORE（含边界），existed=true 的进 entries（内容入库 sqlite，
   * id 稳定、重复物化为增量合并）；existed=false（工具创建）进 createdPaths，
   * 计划按「恢复删除」处理。部分树绝不携带 createdPaths 之外的 added 语义
   * ——未捕获路径留在磁盘上不动。
   */
  async ensureMessageRestorePoint(options: {
    readonly cwd: string
    readonly sessionId: string
    readonly messageSeq: number
    readonly turn: number
    readonly turnStartSeq: number
  }): Promise<RestorePointSummary | undefined> {
    await this.assertReady()
    const workspace = await canonicalDirectory(options.cwd)
    const earliest = await this.beforeJournal.earliestAfter(workspace, options.sessionId, options.messageSeq)
    if (earliest.size === 0) return undefined
    const manifests = await this.store.listManifests(workspace)
    const existing = manifests.find((manifest) => manifest.kind === 'message'
      && manifest.sessionId === options.sessionId
      && manifest.messageSeq === options.messageSeq)
    const entries: Record<string, SnapshotEntry> = Object.create(null)
    if (existing !== undefined) {
      for (const [path, entry] of Object.entries(existing.entries)) entries[path] = entry
    }
    const created = new Set<string>(existing?.createdPaths ?? [])
    const blobs: { readonly hash: string; readonly content: Buffer }[] = []
    for (const [rel, entry] of earliest) {
      // 路径白名单：工作区外（宿主管道本应放弃）或畸形路径 fail-safe 跳过，
      // 绝不让非法相对路径写进恢复点。
      if (!isSafeRelativePath(rel)) continue
      if (entry.existed && entry.content !== null) {
        const content = Buffer.from(entry.content, 'utf8')
        const blob = sha256Hex(content)
        const current = entries[rel]
        if (current === undefined || current.kind !== 'file' || current.blob !== blob) {
          entries[rel] = { kind: 'file', blob, size: content.length, mode: entry.mode }
          blobs.push({ hash: blob, content })
        }
        created.delete(rel)
      } else {
        delete entries[rel]
        created.add(rel)
      }
    }
    if (blobs.length > 0) await this.store.putSqliteBlobs(workspace, blobs)
    await this.store.assertStorageSeparated(workspace)
    const manifest: Manifest = {
      version: FORMAT_VERSION,
      id: existing?.id ?? makeId('rp'),
      kind: 'message',
      workspace,
      storage: 'sqlite',
      sessionId: options.sessionId,
      label: `消息 ${String(options.messageSeq)} 之前的 BEFORE 兜底恢复点`,
      turn: options.turn,
      turnStartSeq: options.turnStartSeq,
      messageSeq: options.messageSeq,
      partial: true,
      createdPaths: [...created].sort(),
      createdAt: existing?.createdAt ?? Date.now(),
      treeHash: hashTree(entries),
      fileCount: Object.keys(entries).length,
      totalBytes: Object.values(entries).reduce((total, entry) => total + (entry.kind === 'file' ? entry.size : 0), 0),
      entries,
      skippedPaths: [],
      restoreCount: existing?.restoreCount ?? 0,
      ...(existing?.lastRestoredAt === undefined ? {} : { lastRestoredAt: existing.lastRestoredAt }),
    }
    await this.store.writeManifest(workspace, manifest)
    return summarize(manifest)
  }

  /** 删除被 prune 掉的 anchor 对应的消息检查点（内容 GC 随后回收独占 blob）。 */
  async pruneMessageRestorePoints(workspace: string, sessionId: string, anchorSeqs: readonly number[]): Promise<number> {
    const canonical = await canonicalDirectory(workspace).catch(() => workspace)
    const stale = new Set(anchorSeqs)
    const manifests = await this.store.listManifests(canonical)
    let deleted = 0
    for (const manifest of manifests) {
      if (manifest.kind !== 'message' || manifest.sessionId !== sessionId) continue
      if (manifest.messageSeq === undefined || !stale.has(manifest.messageSeq)) continue
      await this.store.deleteManifest(canonical, manifest.id).catch(() => undefined)
      deleted += 1
    }
    if (deleted > 0) await this.garbageCollectAfterDeletion(canonical, deleted)
    return deleted
  }

  // ── fork 谱系（ABSORB-RECALL 四）─────────────────────────────────────────

  /**
   * 记录 fork 谱系：「恢复并从新会话继续」成功后由宿主端点调用，把
   * childId ↔ parentId 写进工作区状态的 lineage.json，时间线据此显示
   * 「v2 · 恢复自 <检查点>」徽标。谱系是展示性增强：工作区无法定位或
   * 落盘失败都静默吞掉（丢徽标，不丢功能），绝不影响恢复主流程。
   */
  async recordForkLineage(options: {
    readonly cwd: string
    readonly parentSessionId: string
    readonly childSessionId: string
    readonly restorePointId: string
  }): Promise<void> {
    try {
      const workspace = await canonicalDirectory(options.cwd)
      await this.store.appendLineage(workspace, {
        childId: options.childSessionId,
        parentId: options.parentSessionId,
        restorePointId: options.restorePointId,
        time: Date.now(),
      })
    } catch { /* 展示性增强，失败降级为无谱系 */ }
  }

  /** 读取该工作区的 fork 谱系链（时间线/管理面板用）；工作区无效时为空链。 */
  async loadForkLineage(cwd: string): Promise<readonly LineageEntry[]> {
    try {
      const workspace = await canonicalDirectory(cwd)
      return await this.store.readLineage(workspace)
    } catch {
      return []
    }
  }

  // ── 引擎内部簿记 ────────────────────────────────────────────────────────

  private async isReferencedByUndo(workspace: string, restorePointId: string): Promise<boolean> {
    // 进程内 undo 记录引用的 rescue 点是「活的引用」：被修剪掉的话
    // 「撤销最近一次恢复」会在用户点击时才 409（且 UI 无条件渲染该按钮）。
    return this.undoRecords.get(workspace)?.rescuePointId === restorePointId
  }

  private expirePlans(): void {
    const now = Date.now()
    for (const [id, plan] of this.plans) {
      // TTL 只作软警告（1.4 #1）：过期计划保留在内存中仍可执行；
      // 只有远超保留窗口的陈旧计划才淘汰（防长驻进程缓慢泄漏）。
      if (plan.expiresAt + PLAN_RETENTION_MS <= now) this.plans.delete(id)
      else if (plan.expiresAt <= now) plan.expired = true
    }
  }
}
