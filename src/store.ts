/**
 * 持久化存储层：工作区目录映射、互斥锁、恢复点清单、操作日志、
 * 自动检查点跳过记录与 legacy 内容寻址 blob。
 *
 * 工作区 key = SHA-256(规范化绝对路径)。工作区改名/移动后得到全新 key，
 * 旧数据原样保留（不迁移、不删除）——全新插件没有历史包袱，隔离即正确。
 */
import { createHash, randomUUID } from 'node:crypto'
import { hostname, platform, arch } from 'node:os'
import { link, mkdir, open, readFile, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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

  // ── legacy 内容寻址 blob ────────────────────────────────────────────────

  /** 写入并校验一个 blob；已存在时读回比对（内容寻址下等价即安全）。 */
  async putBlob(workspace: string, hash: string, content: Buffer): Promise<void> {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new ShadowRewindError('STATE_CORRUPT', `非法 blob 哈希 ${JSON.stringify(hash)}`)
    if (sha256Hex(content) !== hash) {
      throw new ShadowRewindError('BLOB_HASH_MISMATCH', '内容与声明哈希不一致，拒绝写入')
    }
    const dir = await this.workspaceDir(workspace)
    const prefixDir = join(dir, 'blobs', hash.slice(0, 2))
    await mkdir(prefixDir, { recursive: true, mode: 0o700 })
    const target = join(prefixDir, hash)
    if (await pathExists(target)) {
      const existing = await readFile(target)
      if (sha256Hex(existing) !== hash) {
        throw new ShadowRewindError('BLOB_COLLISION', `已存在的 blob ${hash} 与内容不符`)
      }
      return
    }
    const temporary = join(prefixDir, `.${randomUUID()}.tmp`)
    const handle = await open(temporary, 'wx', 0o600)
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await link(temporary, target)
      await syncDirectory(prefixDir)
    } catch (error) {
      if (!isNodeError(error, 'EEXIST')) throw error
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }

  /** 缓存命中校验用：blob 是否确实存在于存储（不读内容，仅 stat）。 */
  async blobExists(workspace: string, hash: string): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(hash)) return false
    const dir = await this.workspaceDir(workspace)
    return pathExists(join(dir, 'blobs', hash.slice(0, 2), hash))
  }

  /** 读取并校验一个 blob。 */
  async readBlob(workspace: string, hash: string): Promise<Buffer> {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new ShadowRewindError('STATE_CORRUPT', `非法 blob 哈希 ${JSON.stringify(hash)}`)
    const dir = await this.workspaceDir(workspace)
    const content = await readFile(join(dir, 'blobs', hash.slice(0, 2), hash))
    if (sha256Hex(content) !== hash) {
      throw new ShadowRewindError('BLOB_CORRUPT', `blob ${hash} 校验失败`)
    }
    return content
  }

  /** 删除未被任何 manifest 引用的 blob（只统计 blob 后端的引用）。 */
  async collectGarbage(workspace: string): Promise<{ deletedBlobs: number; retainedBlobs: number }> {
    const referenced = new Set<string>()
    for (const manifest of await this.listManifests(workspace)) {
      for (const entry of Object.values(manifest.entries)) {
        if (entry.kind === 'file' && manifest.storage === 'blob') referenced.add(entry.blob)
      }
    }
    const dir = await this.workspaceDir(workspace)
    const blobsRoot = join(dir, 'blobs')
    let deletedBlobs = 0
    let retainedBlobs = 0
    for (const prefix of await safeDirectoryNames(blobsRoot)) {
      const prefixPath = join(blobsRoot, prefix)
      for (const filename of await safeFileNames(prefixPath)) {
        if (filename.startsWith('.') && filename.endsWith('.tmp')) {
          await unlink(join(prefixPath, filename))
          deletedBlobs += 1
          continue
        }
        if (referenced.has(filename) && filename.slice(0, 2) === prefix) {
          retainedBlobs += 1
          continue
        }
        await unlink(join(prefixPath, filename))
        deletedBlobs += 1
      }
      // 前缀目录空了就顺手收掉。
      try {
        await rmdir(prefixPath)
      } catch (error) {
        if (!isNodeError(error, 'ENOTEMPTY') && !isNodeError(error, 'EEXIST')) throw error
      }
    }
    return { deletedBlobs, retainedBlobs }
  }

  /** 启动恢复用：列出全部工作区状态目录（key 形式）。 */
  async listWorkspaceKeys(): Promise<readonly string[]> {
    return safeDirectoryNames(join(this.config.storageDir, 'workspaces'))
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