/**
 * 捕获层：把「扫描结果 + 上一轮缓存」变成「快照条目 + 新读内容 + 下一轮缓存」。
 *
 * 职责边界（对引擎与内容后端保持中立）：
 *   - fast 模式下 stat 指纹命中缓存的文件直接复用上次结果，不读内容——
 *     这是两个后端（blob / jj 镜像）共用的增量核心；
 *   - 命中前经 `verifyContent` 校验「上次的内容确实还在目标存储/镜像里」，
 *     防止 GC 或影子仓库丢失后缓存命中出死引用（见 engine 的接线）；
 *   - 未命中的文件执行「打开前后 stat 一致」的稳定读取，重试 3 次；
 *     读取以「打开时 stat 对」为指纹事实（扫描后文件已变化的路径按新事实
 *     入缓存，绝不把旧指纹配新内容写进缓存）；
 *   - 读取耗尽失败的路径记录为 skipped('read-failed')，绝不拖垮整个检查点；
 *   - 本模块不落任何内容：新读内容在 newContent/newLinks 里由 engine 按后端处置。
 */
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { ShadowRewindError } from './errors.js'
import { isNodeError, resolveWorkspacePath } from './path-utils.js'
import { cacheEntryOf, cacheMatches, type CacheEntry, type CaptureCache } from './capture-cache.js'
import type { ScannedPath } from './scan.js'
import type { SkippedPath, SnapshotEntry } from './types.js'

/** 一次捕获的完整产物。 */
export interface CaptureOutput {
  readonly entries: Readonly<Record<string, SnapshotEntry>>
  readonly skipped: readonly SkippedPath[]
  readonly treeHash: string
  readonly fileCount: number
  readonly totalBytes: number
  /** 本轮真正新读的文件内容（路径 → Buffer），由引擎按后端写入。 */
  readonly newContent: ReadonlyMap<string, Buffer>
  /** 本轮 target 发生变化的符号链接（路径 → target），镜像类后端必须重建。 */
  readonly newLinks: ReadonlyMap<string, string>
  /** 本轮结束后应写回的缓存（含命中复用的条目）。 */
  readonly nextCache: CaptureCache
}

/** 捕获选项。 */
export interface CaptureOptions {
  readonly root: string
  readonly paths: readonly ScannedPath[]
  /** 扫描阶段已产生的跳过项（too-large / unsupported-type）。 */
  readonly skippedAtScan: readonly SkippedPath[]
  readonly maxFiles: number
  readonly maxSnapshotBytes: number
  readonly strict: boolean
  readonly cache: CaptureCache
  /**
   * 缓存命中时的存在性校验：上次的内容（blob / 镜像文件）是否真的还在。
   * 返回 false 则按未命中处理（重读 + 重写）。省略时跳过校验（信任缓存）。
   */
  readonly verifyContent?: (path: string, blob: string) => Promise<boolean>
  readonly signal?: AbortSignal
}

/** 执行捕获（见模块注释）。 */
export async function captureSnapshot(options: CaptureOptions): Promise<CaptureOutput> {
  if (options.paths.length > options.maxFiles) {
    throw new ShadowRewindError('TOO_MANY_FILES', `工作区入选文件 ${String(options.paths.length)} 个，超出上限 ${String(options.maxFiles)}`)
  }
  const entries: Record<string, SnapshotEntry> = Object.create(null)
  const skipped: SkippedPath[] = [...options.skippedAtScan]
  const nextPaths: Record<string, CacheEntry> = {}
  const newContent = new Map<string, Buffer>()
  const newLinks = new Map<string, string>()
  let totalBytes = 0
  // 限额检查统一走这里：命中与重读两条路径都必须过闸，
  // 否则调低 maxSnapshotBytes 后的纯命中捕获会静默产出超限快照。
  const addBytes = (bytes: number): void => {
    totalBytes += bytes
    if (totalBytes > options.maxSnapshotBytes) {
      throw new ShadowRewindError('SNAPSHOT_TOO_LARGE', `快照总字节 ${String(totalBytes)} 超出上限 ${String(options.maxSnapshotBytes)}`)
    }
  }
  for (const file of options.paths) {
    options.signal?.throwIfAborted()
    const cached = options.cache.paths[file.path]
    if (!options.strict && cached !== undefined && cacheMatches(cached, file)) {
      if (cached.kind === 'file' && cached.blob !== undefined
        && (options.verifyContent === undefined || await options.verifyContent(file.path, cached.blob))) {
        // 缓存命中：stat 指纹未变 + 内容仍在目标存储 → 直接复用。
        entries[file.path] = { kind: 'file', blob: cached.blob, size: cached.size, mode: cached.mode }
        // totalBytes 统计快照全量字节（不只是新读部分），与 manifest 语义一致。
        addBytes(cached.size)
        nextPaths[file.path] = cached
        continue
      }
      if (cached.kind === 'symlink' && cached.target === (file.target ?? '') && cached.mode === file.mode) {
        entries[file.path] = { kind: 'symlink', target: cached.target ?? '', mode: cached.mode }
        nextPaths[file.path] = cached
        continue
      }
      // 校验失败 / 条目形态不符：落到下面的重读路径。
    }
    if (file.kind === 'symlink') {
      // 链接没有「内容读取」成本，直接以扫描事实为准；target 变化必须让
      // 镜像类后端重建链接实体，因此进入 newLinks。
      const target = file.target ?? ''
      entries[file.path] = { kind: 'symlink', target, mode: file.mode }
      newLinks.set(file.path, target)
      nextPaths[file.path] = cacheEntryOf(file, undefined, target)
      continue
    }
    const read = await stableRead(options.root, file, options.signal)
    if (read === undefined) {
      // 重试耗尽：显式跳过而非失败整个检查点；缓存不更新（下轮重试）。
      skipped.push({ path: file.path, reason: 'read-failed' })
      continue
    }
    const blob = createHash('sha256').update(read.content).digest('hex')
    addBytes(read.content.length)
    entries[file.path] = { kind: 'file', blob, size: read.content.length, mode: read.stat.mode }
    newContent.set(file.path, read.content)
    // 以「打开时的 stat 对」为指纹事实：扫描后文件变化的路径按新事实入缓存，
    // 绝不让旧指纹配上新内容污染增量判定。
    nextPaths[file.path] = cacheEntryOf({ ...file, ...read.stat }, blob)
  }
  return {
    entries,
    skipped: skipped.slice().sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    treeHash: hashTree(entries),
    fileCount: Object.keys(entries).length,
    totalBytes,
    newContent,
    newLinks,
    nextCache: { version: 1, paths: nextPaths, checksum: checksumOf(nextPaths) },
  }
}

interface StableRead {
  readonly content: Buffer
  /** 读取时刻的 stat 事实（供缓存指纹），单位与扫描一致。 */
  readonly stat: { readonly size: number; readonly mode: number; readonly mtimeNs: bigint; readonly ctimeNs: bigint; readonly dev: bigint; readonly ino: bigint }
}

/**
 * 稳定读取：打开前后 stat 完全一致才算成功；任何不符重试，3 次耗尽返回
 * undefined（由调用方按 read-failed 记录）。O_NOFOLLOW 防止符号链接偷换。
 */
async function stableRead(root: string, file: ScannedPath, signal?: AbortSignal): Promise<StableRead | undefined> {
  const target = resolveWorkspacePath(root, file.path)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal?.throwIfAborted()
    let handle
    try {
      handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    } catch (error) {
      if (isNodeError(error, 'ENOENT') || isNodeError(error, 'ELOOP')) return undefined
      throw error
    }
    try {
      const openedStat = await handle.stat({ bigint: true })
      if (!openedStat.isFile()) return undefined
      const content = await readBounded(handle, Number(openedStat.size))
      signal?.throwIfAborted()
      const afterStat = await handle.stat({ bigint: true })
      if (!sameStat(openedStat, afterStat) || BigInt(content.length) !== afterStat.size) continue
      return {
        content,
        stat: {
          size: Number(openedStat.size),
          mode: Number(openedStat.mode & 0o7777n),
          mtimeNs: openedStat.mtimeNs,
          ctimeNs: openedStat.ctimeNs,
          dev: openedStat.dev,
          ino: openedStat.ino,
        },
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
  }
  return undefined
}

async function readBounded(handle: import('node:fs/promises').FileHandle, expectedSize: number): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(expectedSize)
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
    if (bytesRead === 0) break
    offset += bytesRead
  }
  return buffer.subarray(0, offset)
}

function sameStat(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
    && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs
}

interface BigIntStats {
  readonly dev: bigint
  readonly ino: bigint
  readonly mode: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
}

/** 全树确定性哈希：路径 + 条目完整签名（与存储后端无关）。 */
export function hashTree(entries: Readonly<Record<string, SnapshotEntry>>): string {
  const hash = createHash('sha256')
  for (const path of Object.keys(entries).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
    const entry = entries[path]
    if (entry === undefined) continue
    hash.update(path)
    hash.update('\0')
    if (entry.kind === 'file') {
      hash.update(`file\0${entry.blob}\0${entry.size}\0${entry.mode}\0`)
    } else {
      hash.update(`symlink\0${entry.target}\0${entry.mode}\0`)
    }
  }
  return hash.digest('hex')
}

function checksumOf(paths: Record<string, CacheEntry>): string {
  return createHash('sha256').update(JSON.stringify(paths)).digest('hex')
}