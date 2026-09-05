/**
 * 共享 stat 缓存：jj 与 sqlite 两个内容后端共用的增量快照基础。
 *
 * 缓存记录「stat 指纹 → 内容指纹（blob 哈希）」。stat 指纹未变的文件，
 * 内容必然未变（工程假设），因此：
 *   - 无需重新读取文件内容；
 *   - sqlite 后端无需重复 putSqliteBlobs（内容行已在库里）；
 *   - jj 后端无需重写镜像文件（工作副本里已是旧内容）。
 * 快照过程若被中断，缓存未写回即作废——缓存只是加速结构，永不参与正确性。
 */
import { createHash } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { isNodeError, writeJsonAtomic } from './path-utils.js'
import type { ScannedPath } from './scan.js'

/** 缓存中一个路径的记录：stat 指纹 + 上次的内容哈希（符号链接为 target）。 */
export interface CacheEntry {
  readonly kind: 'file' | 'symlink'
  readonly size: number
  readonly mode: number
  readonly mtimeNs: string
  readonly ctimeNs: string
  readonly dev: string
  readonly ino: string
  /** 上次捕获的内容 SHA-256（kind === 'file' 时有值）。 */
  readonly blob?: string
  /** 上次捕获的链接目标（kind === 'symlink' 时有值）。 */
  readonly target?: string
}

/** 缓存持久化包装：校验和防篡改，损坏即整体作废（回落空缓存）。 */
export interface CaptureCache {
  readonly version: 1
  readonly paths: Record<string, CacheEntry>
  readonly checksum: string
}

/** 读取缓存；缺失/损坏回落空缓存（缓存永不阻塞捕获）。 */
export async function readCaptureCache(path: string): Promise<CaptureCache> {
  try {
    const value = JSON.parse((await readFile(path, 'utf8')).toString()) as unknown
    if (isCache(value)) return value
  } catch (error) {
    if (!isNodeError(error, 'ENOENT') && !(error instanceof SyntaxError)) throw error
  }
  return makeCache({})
}

/** 原子写回缓存。 */
export async function writeCaptureCache(path: string, cache: CaptureCache): Promise<void> {
  await writeJsonAtomic(path, cache)
}

/**
 * 清空缓存（直接删除文件）。
 * 在「目标存储可能已失去缓存所引用内容」之后调用——例如 GC 删除 blob、
 * 影子仓库被外部清理。缺失即无操作。
 */
export async function clearCaptureCache(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) throw error
  }
}

function makeCache(paths: Record<string, CacheEntry>): CaptureCache {
  return { version: 1, paths, checksum: checksumOf(paths) }
}

function checksumOf(paths: Record<string, CacheEntry>): string {
  return createHash('sha256').update(JSON.stringify(paths)).digest('hex')
}

function isCache(value: unknown): value is CaptureCache {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.version === 1
    && typeof record.checksum === 'string'
    && typeof record.paths === 'object'
    && record.paths !== null
    && !Array.isArray(record.paths)
    && record.checksum === checksumOf(record.paths as Record<string, CacheEntry>)
}

/** 从扫描事实生成缓存记录（blob 由调用方在实际读到内容后补充）。 */
export function cacheEntryOf(file: ScannedPath, blob?: string, target?: string): CacheEntry {
  return {
    kind: file.kind,
    size: file.size,
    mode: file.mode,
    mtimeNs: file.mtimeNs.toString(),
    ctimeNs: file.ctimeNs.toString(),
    dev: file.dev.toString(),
    ino: file.ino.toString(),
    ...(blob === undefined ? {} : { blob }),
    ...(target === undefined ? {} : { target }),
  }
}

/** stat 指纹比对：缓存记录 vs 扫描事实。 */
export function cacheMatches(cached: CacheEntry, file: ScannedPath): boolean {
  return cached.kind === file.kind
    && cached.size === file.size
    && cached.mode === file.mode
    && cached.mtimeNs === file.mtimeNs.toString()
    && cached.ctimeNs === file.ctimeNs.toString()
    && cached.dev === file.dev.toString()
    && cached.ino === file.ino.toString()
}
