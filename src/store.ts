/**
 * 持久化存储层：工作区目录映射、恢复点清单、自动检查点跳过记录与
 * SQLite 内容寻址库（jj 缺失时的降级目标）。
 *
 * 工作区 key = SHA-256(规范化绝对路径)。工作区改名/移动后得到全新 key，
 * 旧数据原样保留（不迁移、不删除）——全新插件没有历史包袱，隔离即正确。
 *
 * EXPECTED-DESIGN 1.4（两态翻转、去锁）：lock.json 工作区互斥与持久操作
 * 日志状态机均已废除——前者消灭僵尸锁与 PID 复用死锁隐患（并发一致性由
 * 单实例假设承担），后者在「要么 B 要么回 A」的双态模型下失去意义（失败
 * 直接退回状态 A，rescue 点是唯一持久兜底）。
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, realpath, rm, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { ShadowRewindError } from './errors.js'
import {
  isNodeError,
  pathExists,
  readJson,
  safeDirectoryNames,
  safeFileNames,
  syncDirectory,
  writeJsonAtomic,
} from './path-utils.js'
import { parseManifest, sha256Hex } from './manifest.js'
import type { ResolvedShadowRewindConfig } from './types.js'

const ID_PATTERN = /^rp_[0-9a-z]+_[0-9a-f]{12}$/

/** fork 谱系条目（ABSORB-RECALL 四）：childId 是 fork 出的新会话。 */
export interface LineageEntry {
  readonly childId: string
  readonly parentId: string
  /** 触发 fork的恢复点（「恢复并从新会话继续」的时点）。 */
  readonly restorePointId?: string
  readonly time: number
}

/** 每个工作区的全部持久化状态。 */
export class WorkspaceStore {
  private readonly config: ResolvedShadowRewindConfig

  constructor(config: ResolvedShadowRewindConfig) {
    this.config = config
  }

  /** 启动装配：确保存储根存在。历史遗留的操作日志文件不再读取——
   * 下一次 GC / 清理时自然过期，不做启动期迁移。 */
  async initialize(): Promise<void> {
    await mkdir(join(this.config.storageDir, 'workspaces'), { recursive: true, mode: 0o700 })
  }

  /** 规范工作区 → 状态目录（binding 校验通过后）。 */
  async workspaceDir(workspace: string): Promise<string> {
    // 哈希截断到 16 位 hex：Windows MAX_PATH 下过长目录名会误伤嵌套状态；
    // 工作区身份的权威校验在 binding 文件，不靠 key 全长。
    const key = sha256Hex(Buffer.from(workspace, 'utf8')).slice(0, 16)
    const dir = join(this.config.storageDir, 'workspaces', key)
    const bindingPath = join(dir, 'workspace.json')
    if (await pathExists(bindingPath)) {
      const binding = await readJson(bindingPath) as { workspace?: unknown }
      if (binding.workspace !== workspace) {
        throw new ShadowRewindError('STATE_CORRUPT', `状态目录 ${key} 已绑定到其它工作区`)
      }
      return dir
    }
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeJsonAtomic(bindingPath, { version: 1, workspace })
    return dir
  }

  // ── 恢复点清单 ──────────────────────────────────────────────────────────

  async writeManifest(workspace: string, manifest: Parameters<typeof parseManifest>[0]): Promise<void> {
    const parsed = parseManifest(manifest)
    if (parsed.workspace !== workspace) {
      throw new ShadowRewindError('STATE_CORRUPT', '恢复点 workspace 与存储目标不一致')
    }
    const dir = await this.workspaceDir(workspace)
    await writeJsonAtomic(join(dir, 'manifests', `${parsed.id}.json`), parsed)
  }

  async readManifest(workspace: string, id: string): Promise<ReturnType<typeof parseManifest>> {
    if (!ID_PATTERN.test(id)) throw new ShadowRewindError('INVALID_RESTORE_POINT_ID', `恢复点 id 无效：${JSON.stringify(id)}`)
    const dir = await this.workspaceDir(workspace)
    let raw: unknown
    try {
      raw = await readJson(join(dir, 'manifests', `${id}.json`))
    } catch (error) {
      if (isMissingStateRead(error)) {
        throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `恢复点 ${id} 不存在`, { cause: error })
      }
      throw error
    }
    const manifest = parseManifest(raw)
    if (manifest.id !== id || manifest.workspace !== workspace) {
      throw new ShadowRewindError('STATE_CORRUPT', `恢复点 ${id} 的持久化身份不一致`)
    }
    return manifest
  }

  async listManifests(workspace: string): Promise<readonly ReturnType<typeof parseManifest>[]> {
    const dir = await this.workspaceDir(workspace)
    const result = []
    for (const filename of await safeFileNames(join(dir, 'manifests'))) {
      const manifest = parseManifest(await readJson(join(dir, 'manifests', filename)))
      if (manifest.workspace !== workspace || filename !== `${manifest.id}.json`) {
        throw new ShadowRewindError('STATE_CORRUPT', `清单 ${filename} 的持久化身份不一致`)
      }
      result.push(manifest)
    }
    return result.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
  }

  async deleteManifest(workspace: string, id: string): Promise<void> {
    if (!ID_PATTERN.test(id)) throw new ShadowRewindError('INVALID_RESTORE_POINT_ID', `恢复点 id 无效：${JSON.stringify(id)}`)
    const dir = await this.workspaceDir(workspace)
    try {
      await unlink(join(dir, 'manifests', `${id}.json`))
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        throw new ShadowRewindError('RESTORE_POINT_NOT_FOUND', `恢复点 ${id} 不存在`)
      }
      throw error
    }
    await syncDirectory(join(dir, 'manifests'))
  }

  /**
   * 影子仓库丢失重建后（K1）：旧 manifest 引用的 commit 已全部死亡——
   * 整目录清除全部清单。决策语义是「重建即清」：列表不再展示内容已失、
   * 恢复必败的恢复点（与其逐个标 degraded，不如诚实清空）。
   * 跳过记录不在此列：它只是提示。
   */
  async purgeManifests(workspace: string): Promise<void> {
    const dir = await this.workspaceDir(workspace)
    await rm(join(dir, 'manifests'), { recursive: true, force: true })
  }

  // ── fork 谱系（ABSORB-RECALL 四）──────────────────────────────────────────

  /** 追加一条 fork 谱系（childId ↔ parentId）到工作区状态目录的
   * lineage.json。缺失/损坏按空表处理（谱系是展示性增强，不致命）；
   * 同一 (childId, parentId) 只记一次（fork 幂等）。 */
  async appendLineage(workspace: string, entry: LineageEntry): Promise<void> {
    const dir = await this.workspaceDir(workspace)
    const existing = await this.readLineage(workspace)
    if (existing.some((item) => item.childId === entry.childId && item.parentId === entry.parentId)) return
    existing.push(entry)
    await writeJsonAtomic(join(dir, 'lineage.json'), existing)
  }

  /** 读取 fork 谱系链；缺失/损坏返回空数组（按无谱系展示）。 */
  async readLineage(workspace: string): Promise<LineageEntry[]> {
    const dir = await this.workspaceDir(workspace)
    try {
      const raw = await readJson(join(dir, 'lineage.json')) as unknown
      if (!Array.isArray(raw)) return []
      return raw.filter((item): item is LineageEntry =>
        typeof item === 'object' && item !== null
        && typeof (item as LineageEntry).childId === 'string'
        && typeof (item as LineageEntry).parentId === 'string'
        && typeof (item as LineageEntry).time === 'number')
    } catch {
      return []
    }
  }

  // ── GC 双闸节流戳（ABSORB-RECALL 六）──────────────────────────────────────

  /** 读上次 GC 时刻（gc.stamp，跨重启续存）；缺失/损坏返回 0（视为很久前）。 */
  async readGcStamp(workspace: string): Promise<number> {
    const dir = await this.workspaceDir(workspace)
    try {
      const raw = await readJson(join(dir, 'gc.stamp')) as { lastRunAt?: unknown }
      return typeof raw?.lastRunAt === 'number' && Number.isFinite(raw.lastRunAt) ? raw.lastRunAt : 0
    } catch {
      return 0
    }
  }

  /** 记录本次 GC 时刻。失败上抛由调用方静默（节流退化为每次都跑，不损正确性）。 */
  async writeGcStamp(workspace: string, lastRunAt: number): Promise<void> {
    const dir = await this.workspaceDir(workspace)
    await writeJsonAtomic(join(dir, 'gc.stamp'), { version: 1, lastRunAt })
  }

  // ── 自动检查点跳过记录（重启后 UI 仍可见）─────────────────────────────────

  async writeTurnSkip(workspace: string, skip: {
    sessionId: string
    turn: number
    turnStartSeq: number
    reason: string
  }): Promise<void> {
    const dir = await this.workspaceDir(workspace)
    const key = sha256Hex(Buffer.from(`${skip.sessionId}\0${skip.turn}\0${skip.turnStartSeq}`, 'utf8'))
    await writeJsonAtomic(join(dir, 'turn-outcomes', `${key}.json`), {
      version: 1,
      ...skip,
      createdAt: Date.now(),
    })
  }

  async readTurnSkip(workspace: string, sessionId: string, turn: number, turnStartSeq: number): Promise<{ reason: string } | undefined> {
    const dir = await this.workspaceDir(workspace)
    const key = sha256Hex(Buffer.from(`${sessionId}\0${turn}\0${turnStartSeq}`, 'utf8'))
    try {
      const value = await readJson(join(dir, 'turn-outcomes', `${key}.json`)) as { reason?: unknown }
      return typeof value.reason === 'string' ? { reason: value.reason } : undefined
    } catch (error) {
      if (isMissingStateRead(error)) return undefined
      throw error
    }
  }

  async deleteTurnSkip(workspace: string, sessionId: string, turn: number, turnStartSeq: number): Promise<void> {
    const dir = await this.workspaceDir(workspace)
    const key = sha256Hex(Buffer.from(`${sessionId}\0${turn}\0${turnStartSeq}`, 'utf8'))
    try {
      await unlink(join(dir, 'turn-outcomes', `${key}.json`))
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error
    }
  }

  // ── SQLite 内容寻址库 ───────────────────────────────────────────────────

  private readonly sqliteDbs = new Map<string, DatabaseSync>()

  /** 打开（或复用）工作区的快照内容库：单文件 SQLite（WAL + FULL），内容寻址。 */
  private async sqliteDb(workspace: string): Promise<DatabaseSync> {
    const dir = await this.workspaceDir(workspace)
    let db = this.sqliteDbs.get(dir)
    if (db === undefined) {
      // 构造器经惰性 require 获取：node:sqlite 缺失时本模块仍可加载，
      // 由 sqliteAvailable() 在启动期给出明确的降级信号。
      db = new (sqliteConstructor())(join(dir, 'content.db'))
      db.exec('PRAGMA journal_mode = WAL')
      // FULL：每次提交都 fsync，与旧 blob 存储逐文件 fsync 的持久性同级。
      db.exec('PRAGMA synchronous = FULL')
      db.exec('CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, content BLOB NOT NULL)')
      this.sqliteDbs.set(dir, db)
    }
    return db
  }

  /**
   * 批量写入内容寻址 blob（单事务）。
   * ponytail: 整库单文件 + 内容寻址表；天花板是「跨工作区全局去重」与
   * 「增量压缩」，需要时再加全局库或 VACUUM 策略，当前单工作区去重已够。
   */
  async putSqliteBlobs(workspace: string, items: readonly {
    readonly hash: string
    readonly content: Buffer
  }[]): Promise<void> {
    if (items.length === 0) return
    const db = await this.sqliteDb(workspace)
    const insert = db.prepare('INSERT INTO blobs (hash, size, content) VALUES (?, ?, ?) ON CONFLICT (hash) DO NOTHING')
    const select = db.prepare('SELECT content FROM blobs WHERE hash = ?')
    db.exec('BEGIN IMMEDIATE')
    let committed = false
    try {
      for (const item of items) {
        if (!/^[0-9a-f]{64}$/.test(item.hash)) throw new ShadowRewindError('STATE_CORRUPT', `非法 blob 哈希 ${JSON.stringify(item.hash)}`)
        if (sha256Hex(item.content) !== item.hash) {
          throw new ShadowRewindError('BLOB_HASH_MISMATCH', '内容与声明哈希不一致，拒绝写入')
        }
        // 已存在时读回比对（内容寻址下等价即安全）。
        if (insert.run(item.hash, item.content.length, item.content).changes === 0) {
          const row = select.get(item.hash) as { content: Uint8Array } | undefined
          if (row === undefined || sha256Hex(Buffer.from(row.content)) !== item.hash) {
            throw new ShadowRewindError('BLOB_COLLISION', `已存在的 blob ${item.hash} 与内容不符`)
          }
        }
      }
      db.exec('COMMIT')
      committed = true
    } finally {
      if (!committed) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // 事务已自动回滚（如 BEGIN 后连接异常）：忽略。
        }
      }
    }
  }

  /** 缓存命中校验用：内容行是否确实存在于库（不读内容）。 */
  async sqliteBlobExists(workspace: string, hash: string): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return false
    const db = await this.sqliteDb(workspace)
    return db.prepare('SELECT 1 AS x FROM blobs WHERE hash = ?').get(hash) !== undefined
  }

  /** 读取并校验一个 blob。 */
  async readSqliteBlob(workspace: string, hash: string): Promise<Buffer> {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new ShadowRewindError('STATE_CORRUPT', `非法 blob 哈希 ${JSON.stringify(hash)}`)
    const db = await this.sqliteDb(workspace)
    const row = db.prepare('SELECT content FROM blobs WHERE hash = ?').get(hash) as { content: Uint8Array } | undefined
    if (row === undefined) {
      throw new ShadowRewindError('BLOB_CORRUPT', `blob ${hash} 不存在于内容库`)
    }
    const content = Buffer.from(row.content)
    if (sha256Hex(content) !== hash) {
      throw new ShadowRewindError('BLOB_CORRUPT', `blob ${hash} 校验失败`)
    }
    return content
  }

  /** 删除未被任何 manifest 引用的内容行（只统计 sqlite 后端的引用）。 */
  async collectGarbage(workspace: string): Promise<{ deletedBlobs: number; retainedBlobs: number }> {
    const referenced = new Set<string>()
    for (const manifest of await this.listManifests(workspace)) {
      for (const entry of Object.values(manifest.entries)) {
        if (entry.kind === 'file' && manifest.storage === 'sqlite') referenced.add(entry.blob)
      }
    }
    const db = await this.sqliteDb(workspace)
    const rows = db.prepare('SELECT hash FROM blobs').all() as unknown as readonly { hash: string }[]
    const remove = db.prepare('DELETE FROM blobs WHERE hash = ?')
    let deletedBlobs = 0
    let retainedBlobs = 0
    for (const row of rows) {
      if (referenced.has(row.hash)) {
        retainedBlobs += 1
        continue
      }
      remove.run(row.hash)
      deletedBlobs += 1
    }
    return { deletedBlobs, retainedBlobs }
  }

  /** 关闭全部打开的 SQLite 句柄（受控关闭/测试清理用；幂等）。 */
  async closeAll(): Promise<void> {
    for (const [dir, db] of this.sqliteDbs) {
      this.sqliteDbs.delete(dir)
      try {
        db.close()
      } catch {
        // 已关闭或连接异常：句柄回收尽力而为。
      }
    }
  }

  /** 状态根必须不在被管理工作区内（防自吞）。 */
  async assertStorageSeparated(workspace: string): Promise<void> {
    const storageReal = await realpathOf(this.config.storageDir)
    const workspaceReal = await realpathOf(workspace)
    if (workspaceReal === storageReal
      || workspaceReal.startsWith(storageReal + sepOf())
      || storageReal.startsWith(workspaceReal + sepOf())) {
      throw new ShadowRewindError('STORAGE_INSIDE_WORKSPACE',
        `存储目录与工作区重叠：storage=${JSON.stringify(storageReal)} workspace=${JSON.stringify(workspaceReal)}`)
    }
  }
}

// ── 内部工具 ─────────────────────────────────────────────────────────────

function sepOf(): string {
  return process.platform === 'win32' ? '\\' : '/'
}

async function realpathOf(path: string): Promise<string> {
  return realpath(path)
}

function isMissingStateRead(error: unknown): boolean {
  return error instanceof ShadowRewindError
    && error.code === 'STATE_READ_FAILED'
    && error.cause instanceof Error
    && isNodeError(error.cause, 'ENOENT')
}

let sqliteModule: typeof import('node:sqlite') | 'missing' | undefined

/** 探测宿主机 `node:sqlite` 是否可用（一次性开销；Node ≥22.19 自带）。 */
export function sqliteAvailable(): boolean {
  if (sqliteModule === undefined) {
    try {
      sqliteModule = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite')
    } catch {
      sqliteModule = 'missing'
    }
  }
  return sqliteModule !== 'missing'
}

/** 取 DatabaseSync 构造器；仅在 sqliteAvailable() 为真后调用。 */
function sqliteConstructor(): typeof import('node:sqlite').DatabaseSync {
  if (sqliteModule === undefined) sqliteAvailable()
  if (sqliteModule === undefined || sqliteModule === 'missing') {
    throw new ShadowRewindError('STATE_CORRUPT', 'node:sqlite 不可用，无法打开 SQLite 内容库')
  }
  return sqliteModule.DatabaseSync
}