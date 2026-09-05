/**
 * 持久化存储层：工作区目录映射、互斥锁、恢复点清单、操作日志、
 * 自动检查点跳过记录与 SQLite 内容寻址库（jj 缺失时的降级目标）。
 *
 * 工作区 key = SHA-256(规范化绝对路径)。工作区改名/移动后得到全新 key，
 * 旧数据原样保留（不迁移、不删除）——全新插件没有历史包袱，隔离即正确。
 */
import { createHash, randomUUID } from 'node:crypto'
import { hostname, platform, arch } from 'node:os'
import { createRequire } from 'node:module'
import { mkdir, open, realpath, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { ShadowRewindError, errorMessage } from './errors.js'
import {
  isNodeError,
  pathExists,
  processExists,
  readJson,
  safeDirectoryNames,
  safeFileNames,
  syncDirectory,
  writeJsonAtomic,
} from './path-utils.js'
import { parseManifest, parseOperation, sha256Hex } from './manifest.js'
import type { RestoreOperation, ResolvedShadowRewindConfig } from './types.js'

const ID_PATTERN = /^rp_[0-9a-z]+_[0-9a-f]{12}$/

/** 每个工作区的全部持久化状态。 */
export class WorkspaceStore {
  private readonly config: ResolvedShadowRewindConfig

  constructor(config: ResolvedShadowRewindConfig) {
    this.config = config
  }

  /** 启动恢复：把遗留的 running 操作标记为 interrupted，返回处理条数。 */
  async initialize(): Promise<number> {
    await mkdir(join(this.config.storageDir, 'workspaces'), { recursive: true, mode: 0o700 })
    let reconciled = 0
    for (const key of await safeDirectoryNames(join(this.config.storageDir, 'workspaces'))) {
      const workspaceDir = join(this.config.storageDir, 'workspaces', key)
      for (const filename of await safeFileNames(join(workspaceDir, 'operations'))) {
        const path = join(workspaceDir, 'operations', filename)
        let operation: RestoreOperation
        try {
          operation = parseOperation(await readJson(path))
        } catch {
          // 无法解析的日志留给人工处理；启动恢复绝不因单条损坏而拒启。
          continue
        }
        if (operation.state !== 'running' && operation.state !== 'rollback-running') continue
        await writeJsonAtomic(path, {
          ...operation,
          state: 'interrupted',
          error: operation.error ?? 'DSH 在恢复操作完成前停止',
        })
        reconciled += 1
      }
    }
    return reconciled
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

  // ── 互斥锁 ──────────────────────────────────────────────────────────────

  /**
   * 获取工作区互斥锁（单机自用简化版）：
   * O_EXCL 独占创建 lock.json；持有者进程已死且超过 staleLockMs 才允许回收。
   * 同机多实例靠 pid 判活；跨机共享存储不在设计范围内。
   */
  async acquire(workspace: string, signal?: AbortSignal): Promise<() => Promise<void>> {
    const dir = await this.workspaceDir(workspace)
    const lockPath = join(dir, 'lock.json')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const nonce = randomUUID()
    const record = { pid: process.pid, hostId: hostIdentity(), createdAt: Date.now(), nonce }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      signal?.throwIfAborted()
      if (await writeLockExclusive(lockPath, `${JSON.stringify(record)}\n`)) {
        await syncDirectory(dir)
        return async () => {
          // nonce 校验：只有仍持有锁的实例才能释放（防止误删后来者的锁）。
          try {
            const current = await readJson(lockPath) as { nonce?: unknown }
            if (current.nonce !== nonce) return
            await unlink(lockPath)
            await syncDirectory(dir)
          } catch (error) {
            if (!isNodeError(error, 'ENOENT')) throw error
          }
        }
      }
      let lock: { pid?: unknown; createdAt?: unknown }
      try {
        lock = await readJson(lockPath) as typeof lock
      } catch (error) {
        if (isMissingStateRead(error)) continue
        if (error instanceof ShadowRewindError && error.code === 'STATE_CORRUPT') {
          // 锁文件损坏：超过 stale 窗口就直接回收，否则等下一次尝试。
          throw new ShadowRewindError('WORKSPACE_LOCKED', `工作区锁损坏且无法立即回收：${errorMessage(error)}`)
        }
        throw error
      }
      const pid = typeof lock.pid === 'number' ? lock.pid : 0
      const createdAt = typeof lock.createdAt === 'number' ? lock.createdAt : 0
      const ownerAlive = pid > 0 && processExists(pid)
      const staleFor = Date.now() - createdAt
      if (!ownerAlive && staleFor >= this.config.staleLockMs) {
        await unlink(lockPath).catch(() => undefined)
        await syncDirectory(dir)
        continue
      }
      throw new ShadowRewindError('WORKSPACE_LOCKED', `另一个影子回退操作正在处理 ${JSON.stringify(workspace)}`)
    }
    throw new ShadowRewindError('WORKSPACE_LOCKED', `无法获取 ${JSON.stringify(workspace)} 的工作区锁`)
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

  // ── 操作日志 ────────────────────────────────────────────────────────────

  async writeOperation(operation: RestoreOperation): Promise<void> {
    const dir = await this.workspaceDir(operation.workspace)
    await writeJsonAtomic(join(dir, 'operations', `${operation.id}.json`), parseOperation(operation))
  }

  async listOperations(workspace: string): Promise<readonly RestoreOperation[]> {
    const dir = await this.workspaceDir(workspace)
    const result = []
    for (const filename of await safeFileNames(join(dir, 'operations'))) {
      const operation = parseOperation(await readJson(join(dir, 'operations', filename)))
      result.push(operation)
    }
    return result.sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id))
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

  /** 启动恢复用：列出全部工作区状态目录（key 形式）。 */
  async listWorkspaceKeys(): Promise<readonly string[]> {
    return safeDirectoryNames(join(this.config.storageDir, 'workspaces'))
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

/** O_EXCL 独占创建并写入锁文件；已存在返回 false。 */
async function writeLockExclusive(path: string, body: string): Promise<boolean> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  try {
    const handle = await open(path, 'wx', 0o600)
    try {
      await handle.writeFile(body)
      await handle.sync()
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    if (isNodeError(error, 'EEXIST')) return false
    throw error
  }
}

function isMissingStateRead(error: unknown): boolean {
  return error instanceof ShadowRewindError
    && error.code === 'STATE_READ_FAILED'
    && error.cause instanceof Error
    && isNodeError(error.cause, 'ENOENT')
}

let hostId: string | undefined

/** 主机身份（锁判活用）：hostname/platform/arch 派生；可用环境变量覆盖。 */
function hostIdentity(): string {
  if (hostId !== undefined) return hostId
  const configured = process.env.DSH_SHADOW_REWIND_HOST_ID
  if (configured !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(configured)) {
      throw new ShadowRewindError('HOST_ID_UNAVAILABLE', 'DSH_SHADOW_REWIND_HOST_ID 必须是 64 位小写 hex')
    }
    hostId = configured
    return configured
  }
  hostId = sha256Hex(Buffer.from(JSON.stringify({ host: hostname(), platform: platform(), arch: arch() })))
  return hostId
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