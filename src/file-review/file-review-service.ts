/**
 * 宿主半边的产出文本 diff 撤销 / 重做服务（工作区围栏内）。
 *
 * 三条并行的执行路径，共用同一套 applied / undone / conflict 状态模型：
 *  - **hunk 文本回放**：工具结果视图与 Code Mode 录制的常规改动，逐 hunk
 *    逆序回放 + 行锚点匹配 + 提交前字节级 CAS 复核；
 *  - **fs 整文件形状**：检查点对比派生的终端写盘（新增 / 删除 / 纯权限位），
 *    天然互逆，无需回放；
 *  - **目录条目**：mkdir / rmdir 互逆，删除侧带「必须为空」闸门。
 *
 * 全局不变式：**绝不猜着改**。任何一侧对不上就报 `conflict` 或
 * `unsupported` 并原样不动；所有路径都被工作区围栏（realpath 解析后必须仍在
 * 会话 cwd 内）与符号链接拒绝共同约束。
 */

import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, readFile, realpath, rm, rmdir } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  FileReviewAction, FileReviewChange, FileReviewFileResult, FileReviewRequest, FileReviewResult,
  ProducedFileDiff, RecordedMutation, RecordedRequest, RecordedResult,
} from './change-types.ts'

type InspectState = Exclude<FileReviewFileResult['state'], 'error'>

interface InspectedFile {
  readonly state: InspectState
  readonly text?: string | undefined
  readonly nextText?: string | undefined
  readonly reason?: string | undefined
}

/** 一个已解析并通过全部安全校验的目标文件。 */
interface ResolvedFile {
  readonly filename: string
  readonly mode: number
  readonly bytes: Uint8Array
  /** 磁盘原文（行尾按存储原样保留）。 */
  readonly text: string
  /** 磁盘上的文件是否使用 CRLF 行尾。 */
  readonly crlf: boolean
  /** 归一化到 LF 的磁盘文本——hunk 运算的唯一基准。 */
  readonly lfText: string
}

/**
 * 为什么需要行尾归一化：变更工具录制的 hunk（diff 卡片与 Code Mode 的
 * before / after 都是）走的是文件系统后端的 LF 基准，而磁盘文件可能是
 * CRLF。所有 hunk 匹配因此一律在归一化文本上进行，写回路径再把文件自己的
 * 行尾风格还原回去。
 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** 把归一化文本还原成文件自己的行尾风格（CRLF 文件写回仍是 CRLF）。 */
function restoreNewlines(text: string, crlf: boolean): string {
  return crlf ? text.replace(/\n/g, '\r\n') : text
}

/** 工作区围栏：`candidate` 是否仍在 `root` 之内（含 root 自身）。 */
function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

/**
 * 解析一个会话相对路径为可安全操作的目标文件。
 * 围栏是双重的：解析前后各校验一次（符号链接可能把路径指向工作区外），
 * 且显式拒绝符号链接与非普通文件；非 UTF-8 内容一律拒收（回放会毁掉字节）。
 */
async function resolveFile(cwd: string, requestedPath: string): Promise<ResolvedFile> {
  const root = await realpath(cwd)
  const candidate = resolve(root, requestedPath)
  if (!inside(root, candidate)) throw new Error('path is outside the session workspace')
  const linkStat = await lstat(candidate)
  if (linkStat.isSymbolicLink()) throw new Error('symbolic links are not supported')
  if (!linkStat.isFile()) throw new Error('path is not a regular file')
  const filename = await realpath(candidate)
  if (!inside(root, filename)) throw new Error('resolved path is outside the session workspace')
  const bytes = await readFile(filename)
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('file is not valid UTF-8 text')
  const crlf = text.includes('\r')
  return { filename, mode: linkStat.mode & 0o777, bytes, text, crlf, lfText: normalizeNewlines(text) }
}

/** 第 `line` 行（1-based）在文本中的字节偏移；越界返回 null。 */
function offsetAtLine(text: string, line: number): number | null {
  if (!Number.isInteger(line) || line < 1) return null
  if (line === 1) return 0
  let offset = 0
  for (let current = 1; current < line; current += 1) {
    const next = text.indexOf('\n', offset)
    if (next === -1) return null
    offset = next + 1
  }
  return offset
}

/**
 * 在 `text` 上把 `source` 换成 `replacement`，失败返回 null（绝不猜着改）。
 * 给了行锚点就做**锚点精确匹配**（该行起始处必须整段等于 `source`）；
 * 没给锚点则要求 `source` 全局唯一——出现 0 次或多次都拒绝。
 */
function replaceHunk(
  text: string,
  source: string,
  replacement: string,
  line: number | undefined,
): string | null {
  let offset: number
  if (line !== undefined) {
    const located = offsetAtLine(text, line)
    if (located === null || text.slice(located, located + source.length) !== source) return null
    offset = located
  } else {
    if (source === '') return null
    offset = text.indexOf(source)
    if (offset === -1 || text.indexOf(source, offset + 1) !== -1) return null
  }
  return text.slice(0, offset) + replacement + text.slice(offset + source.length)
}

/**
 * 这个 hunk 是否具备「可逆回放」所需的全部信息。
 * 空侧必须有行锚点兜底：空字符串在任何位置都平凡匹配，没有锚点就无法定位
 * 插入点，回放会退化成猜测——直接判不支持。
 */
function hunkSupported(diff: ProducedFileDiff, path: string): boolean {
  if (diff.path !== path || diff.oldText === null || diff.oldText === diff.newText) return false
  if (diff.oldText === '' && diff.oldStart === undefined) return false
  if (diff.newText === '' && diff.newStart === undefined) return false
  return true
}

/**
 * 检查点对比（终端 / PowerShell 写盘）产出的整文件形状：'added' 没有旧侧
 * （`oldText === null`），'deleted' 的新侧为空。两者天然互逆、无需 hunk
 * 回放——新增的撤销是删除文件，删除的撤销是写回旧内容——因此绕过
 * `transformFile`，但共用同一套 applied / undone 状态模型。
 *
 * 「改到空」曾经与 'deleted' 同形（当年走的是无锚点的整文件形状，操作完全
 * 相同：还原旧内容）。现在 hunk 路径已经用行锚点把「修改过的文件」拆开，
 * 一个**带锚点的**「改成空」hunk 绝不能再被当成整文件删除——下面那个
 * `oldStart` 守卫就是用来把两者分开的。
 *
 * 另有两类 fs 形状挂在同一模型上：
 *  - mode-only：两侧内容相同、仅权限位不同——开关动作是一次裸 chmod，由
 *    内容 CAS 把关；
 *  - 空目录（`dir: true`）：完全没有内容——开关动作是 mkdir / rmdir，删除
 *    侧带「必须为空」闸门。
 *
 * `FileReviewChange.origin === 'fs'` 是客户端对文件类条目的显式标记；缺省时
 * 形状识别仍生效（兼容旧 bundle——write 工具创建的文件与之同形，撤销同为
 * 删除，行为刻意保持一致）。目录条目靠显式 `dirKind` 识别（无形状可猜）。
 */
type FsChangeShape =
  | { readonly kind: 'added' | 'deleted'; readonly dir: boolean }
  | { readonly kind: 'mode' }

/** 识别一个条目是否属于 fs 整文件形状；不是则返回 null（走 hunk 回放路径）。 */
function fsChangeShape(file: FileReviewChange): FsChangeShape | null {
  if (file.dirKind !== undefined) return { kind: file.dirKind, dir: true }
  if (file.diffs.length !== 1) return null
  const diff = file.diffs[0]
  if (diff === undefined || diff.path !== file.path) return null
  if (file.origin === 'fs' && diff.oldText !== null
    && normalizeNewlines(diff.oldText) === normalizeNewlines(diff.newText)
    && diff.oldMode !== undefined && diff.newMode !== undefined
    && diff.oldMode !== diff.newMode) {
    return { kind: 'mode' }
  }
  if (diff.oldText === null) return { kind: 'added', dir: false }
  // oldStart 锚点区分「改到空的行级 hunk」与「整文件删除」：前者走通用
  // hunk 路径（要求文件在场），后者要求文件已不在——识别错了必冲突。
  if (diff.newText === '' && diff.oldText !== '' && diff.oldStart === undefined) return { kind: 'deleted', dir: false }
  return null
}

/** 一个会话相对路径在磁盘上的当前存在性 / 内容 / 权限位。 */
async function fsFileState(
  cwd: string,
  requestedPath: string,
): Promise<{ exists: false } | { exists: true; filename: string; text: string; mode: number }> {
  const root = await realpath(cwd)
  const candidate = resolve(root, requestedPath)
  if (!inside(root, candidate)) throw new Error('path is outside the session workspace')
  let stat
  try {
    stat = await lstat(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
    throw error
  }
  if (stat.isSymbolicLink()) throw new Error('symbolic links are not supported')
  if (!stat.isFile()) throw new Error('path is not a regular file')
  const filename = await realpath(candidate)
  if (!inside(root, filename)) throw new Error('resolved path is outside the session workspace')
  const bytes = await readFile(filename)
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('file is not valid UTF-8 text')
  return { exists: true, filename, text, mode: stat.mode & 0o777 }
}

/** 一个会话相对路径在磁盘上作为「目录」的当前存在性。 */
async function fsDirState(
  cwd: string,
  requestedPath: string,
): Promise<{ exists: false } | { dir: true; mode: number } | { other: true }> {
  const root = await realpath(cwd)
  const candidate = resolve(root, requestedPath)
  if (!inside(root, candidate)) throw new Error('path is outside the session workspace')
  let stat
  try {
    stat = await lstat(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
    throw error
  }
  // 符号链接指向目录也不算：目录语义只认真实的目录节点。
  if (stat.isSymbolicLink() || !stat.isDirectory()) return { other: true }
  return { dir: true, mode: stat.mode & 0o777 }
}

/** 对「当前磁盘状态」判定一条 fs 变更的 applied / undone / conflict。
 * 行尾归一化比较：fs 条目两侧内容分别来自检查点 blob 与磁盘，行尾风格可能
 * 不一致（LF 快照 vs CRLF 磁盘），不归一化会误报「冲突」。
 * ponytail: 混合行尾的文件仍可能被判冲突——天花板是行级行尾映射；
 * 升级路径是逐行带行尾比较（hunk 路径的 restoreNewlines 同此边界）。 */
function inspectFsChange(cwd: string, file: FileReviewChange, shape: FsChangeShape): Promise<FileReviewFileResult> {
  const diff = file.diffs[0]
  return (async (): Promise<FileReviewFileResult> => {
    try {
      if (shape.kind === 'mode') {
        // mode-only：不变量是「内容不动、只有权限位翻转」——内容漂移同样算
        // 冲突（与 apply 侧 CAS 一致），哪怕权限位恰好落在旧侧。
        if (diff === undefined || diff.oldMode === undefined || diff.newMode === undefined) {
          return { path: file.path, state: 'error', changed: false, reason: 'recorded change carries no mode pair' }
        }
        const state = await fsFileState(cwd, file.path)
        if (!state.exists) {
          return { path: file.path, state: 'conflict', changed: false, reason: 'file is missing' }
        }
        if (normalizeNewlines(state.text) !== normalizeNewlines(diff.newText)) {
          return { path: file.path, state: 'conflict', changed: false, reason: 'file content differs from the recorded change' }
        }
        if (state.mode === diff.newMode) return { path: file.path, state: 'applied', changed: false }
        if (state.mode === diff.oldMode) return { path: file.path, state: 'undone', changed: false }
        return { path: file.path, state: 'conflict', changed: false, reason: 'file mode matches neither recorded side' }
      }
      if (shape.dir) {
        // 目录条目：状态只看「目录在不在」；空不空由执行阶段的 rmdir 把关。
        const state = await fsDirState(cwd, file.path)
        if ('other' in state) {
          return { path: file.path, state: 'conflict', changed: false, reason: 'path is not a directory' }
        }
        const present = 'dir' in state
        if (shape.kind === 'added') {
          return present
            ? { path: file.path, state: 'applied', changed: false }
            : { path: file.path, state: 'undone', changed: false }
        }
        return present
          ? { path: file.path, state: 'undone', changed: false }
          : { path: file.path, state: 'applied', changed: false }
      }
      // fsChangeShape 保证只有一个 diff；这个守卫只是让类型保持诚实。
      if (diff === undefined) {
        return { path: file.path, state: 'error', changed: false, reason: 'recorded change carries no diff' }
      }
      const state = await fsFileState(cwd, file.path)
      if (shape.kind === 'added') {
        // applied = 文件在场且内容等于录制的新侧。
        if (!state.exists) return { path: file.path, state: 'undone', changed: false }
        if (normalizeNewlines(state.text) === normalizeNewlines(diff.newText)) return { path: file.path, state: 'applied', changed: false }
        return { path: file.path, state: 'conflict', changed: false, reason: 'file content differs from the recorded change' }
      }
      // deleted：applied = 文件已不在；undone = 旧内容在场。
      if (!state.exists) return { path: file.path, state: 'applied', changed: false }
      if (diff.oldText !== null && normalizeNewlines(state.text) === normalizeNewlines(diff.oldText)) return { path: file.path, state: 'undone', changed: false }
      return { path: file.path, state: 'conflict', changed: false, reason: 'file content differs from the recorded change' }
    } catch (error) {
      return {
        path: file.path,
        state: 'error',
        changed: false,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
  })()
}

/** 删除前的可找回副本：<rescueDir>/<时间戳>-<rand>-<净化文件名>。 */
async function writeRescueCopy(rescueDir: string, path: string, content: string): Promise<boolean> {
  try {
    await mkdir(rescueDir, { recursive: true })
    const safe = path.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80)
    const name = `${String(Date.now())}-${randomUUID().slice(0, 8)}-${safe === '' ? 'file' : safe}.txt`
    await writeFileAtomic(join(rescueDir, name), content, { mode: 0o600 })
    return true
  } catch {
    return false
  }
}

/**
 * 执行一次 fs 变更的开关动作，提交前一刻重查 CAS 闸门。
 * rescueDir 提供时，任何删除分支（fs-added 撤销 / fs-deleted 重做）先把即将
 * 删除的内容落一份可找回的副本——这条轻量路径不在引擎的恢复安全闸之内，
 * 副本是唯一的服务端兜底；落盘失败则拒绝删除（宁可不删，不可删了找不回）。
 * 目录条目没有内容可备份（rmdir 只删空目录），不走 rescue。
 */
async function applyFsChange(
  cwd: string,
  file: FileReviewChange,
  action: FileReviewAction,
  shape: FsChangeShape,
  rescueDir?: string,
): Promise<FileReviewFileResult> {
  const diff = file.diffs[0]
  try {
    const inspected = await inspectFsChange(cwd, file, shape)
    const sourceState = action === 'undo' ? 'applied' : 'undone'
    const targetState = action === 'undo' ? 'undone' : 'applied'
    if (inspected.state === targetState) return { path: file.path, state: targetState, changed: false }
    if (inspected.state !== sourceState) {
      return { path: file.path, state: inspected.state, changed: false, reason: inspected.reason }
    }

    if (shape.kind === 'mode') {
      // mode-only：提交前复核内容未漂移，然后只改权限位。
      if (diff === undefined || diff.oldMode === undefined || diff.newMode === undefined) {
        return { path: file.path, state: 'error', changed: false, reason: 'recorded change carries no mode pair' }
      }
      const state = await fsFileState(cwd, file.path)
      if (!state.exists || normalizeNewlines(state.text) !== normalizeNewlines(diff.newText)) {
        return { path: file.path, state: 'conflict', changed: false, reason: 'file changed while the operation was being prepared' }
      }
      const root = await realpath(cwd)
      await chmod(resolve(root, file.path), action === 'undo' ? diff.oldMode : diff.newMode)
      return { path: file.path, state: targetState, changed: true }
    }

    if (shape.dir) {
      // added : undo → rmdir（必须仍为空）, redo → mkdir(newMode)
      // deleted: undo → mkdir(oldMode), redo → rmdir（必须仍为空）
      const removes = (shape.kind === 'added') === (action === 'undo')
      const root = await realpath(cwd)
      const target = resolve(root, file.path)
      if (removes) {
        try {
          await rmdir(target)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY') {
            return { path: file.path, state: 'conflict', changed: false, reason: 'directory is not empty' }
          }
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { path: file.path, state: 'conflict', changed: false, reason: 'directory changed while the operation was being prepared' }
          }
          throw error
        }
        return { path: file.path, state: targetState, changed: true }
      }
      const state = await fsDirState(cwd, file.path)
      if ('dir' in state || 'other' in state) {
        return { path: file.path, state: 'conflict', changed: false, reason: 'directory changed while the operation was being prepared' }
      }
      await mkdir(target)
      // Windows 权限位语义与引擎恢复路径一致：仅 POSIX 落 mode。
      if (process.platform !== 'win32' && diff !== undefined) {
        const mode = action === 'undo' ? diff.oldMode : diff.newMode
        if (mode !== undefined) await chmod(target, mode)
      }
      return { path: file.path, state: targetState, changed: true }
    }

    // 这次操作到底是删文件还是写回文件：
    //   added  : undo → 删除（期望 newText 在场），redo → 写入 newText（期望文件缺席）
    //   deleted: undo → 写回 oldText（期望文件缺席），redo → 删除（期望 oldText 在场）
    // fsChangeShape 保证只有一个 diff；这个守卫只是让类型保持诚实。
    if (diff === undefined) {
      return { path: file.path, state: 'error', changed: false, reason: 'recorded change carries no diff' }
    }
    const removes = (shape.kind === 'added') === (action === 'undo')
    const state = await fsFileState(cwd, file.path)
    if (removes) {
      const expected = shape.kind === 'added' ? diff.newText : diff.oldText
      // CAS 复核按 LF 归一化比较（同 inspectFsChange：行尾风格差异不算漂移）。
      const matches = state.exists
        && expected !== null
        && normalizeNewlines(state.text) === normalizeNewlines(expected)
      if (!matches) {
        return { path: file.path, state: 'conflict', changed: false, reason: 'file changed while the operation was being prepared' }
      }
      if (rescueDir !== undefined) {
        const secured = await writeRescueCopy(rescueDir, file.path, state.text)
        if (!secured) {
          return { path: file.path, state: 'error', changed: false, reason: 'rescue backup failed; deletion refused' }
        }
      }
      await rm(state.filename)
      return { path: file.path, state: targetState, changed: true }
    }
    if (state.exists) {
      return { path: file.path, state: 'conflict', changed: false, reason: 'file changed while the operation was being prepared' }
    }
    const content = shape.kind === 'added' ? diff.newText : diff.oldText
    if (content === null) {
      return { path: file.path, state: 'error', changed: false, reason: 'recorded change carries no restorable content' }
    }
    const root = await realpath(cwd)
    // 权限位随 fs 条目透传（检查点记录的旧/新侧 mode）；缺省（旧宿主或
    // 工具条目）回落 0o644——引擎级恢复仍是精确复刻权限的完整路径。
    const mode = action === 'undo' ? diff.oldMode : diff.newMode
    await writeFileAtomic(resolve(root, file.path), content, { mode: mode ?? 0o644 })
    return { path: file.path, state: targetState, changed: true }
  } catch (error) {
    return {
      path: file.path,
      state: 'error',
      changed: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * 在内存里回放一个文件的完整 hunk 序列；任一 hunk 对不上就返回 null。
 * 导出是为了让单测直接断言「纯变换」这一段，不必走 IO。
 */
export function transformFile(
  text: string,
  file: FileReviewChange,
  action: FileReviewAction,
): string | null {
  if (file.diffs.length === 0 || !file.diffs.every(diff => hunkSupported(diff, file.path))) {
    return null
  }
  const diffs = action === 'undo' ? [...file.diffs].reverse() : file.diffs
  let next = text
  for (const diff of diffs) {
    const source = action === 'undo' ? diff.newText : diff.oldText
    const replacement = action === 'undo' ? diff.oldText : diff.newText
    if (source === null || replacement === null) return null
    const changed = replaceHunk(
      next,
      source,
      replacement,
      action === 'undo' ? diff.newStart : diff.oldStart,
    )
    if (changed === null) return null
    next = changed
  }
  return next
}

/** 某一侧（old / new）的全部非空 hunk 是否都在 `text` 里在场。 */
function hunkSidePresent(text: string, file: FileReviewChange, side: 'old' | 'new'): boolean {
  for (const diff of file.diffs) {
    const source = side === 'old' ? diff.oldText : diff.newText
    // 空侧在任何文本里都平凡「在场」，不构成证据（调用方负责全空时的裁决）。
    if (source === null || source === '') continue
    const line = side === 'old' ? diff.oldStart : diff.newStart
    if (line !== undefined) {
      const located = offsetAtLine(text, line)
      if (located === null || text.slice(located, located + source.length) !== source) return false
    } else if (text.indexOf(source) === -1) {
      return false
    }
  }
  return true
}

/** 纯文本侧的状态判定：当前文本相对录制变更处于 applied / undone / conflict。 */
function inspectText(text: string, file: FileReviewChange): InspectedFile {
  if (file.diffs.length === 0 || !file.diffs.every(diff => hunkSupported(diff, file.path))) {
    return { state: 'unsupported', reason: 'change has no complete reversible diff' }
  }
  const undone = transformFile(text, file, 'undo')
  const redone = transformFile(text, file, 'redo')
  if (undone !== null && redone !== null) {
    // 两个方向在文本上都走得通——这就是经典的「纯追加」形状：旧侧 hunk 是新
    // 侧 hunk 的前缀，因此也包含在新状态里。此时只能按「当前文本实际含有什么」
    // 来裁决：新侧 hunk 在场 → applied（撤销会剥掉它们）；否则变更已被撤销，
    // 只剩旧侧 hunk。
    // 在场证据只数非空新侧：空 newText（改到空/纯删除块）平凡在场，若参与
    // 裁决会把撤销后的状态误判为 applied；新侧全无证据时双向可行即意味
    // 旧内容在锚点在场 → undone。
    const newEvidence = file.diffs.filter((diff) => diff.newText !== null && diff.newText !== '')
    const newPresent = newEvidence.length > 0
      && hunkSidePresent(text, { ...file, diffs: newEvidence }, 'new')
    return newPresent
      ? { state: 'applied', text, nextText: undone }
      : { state: 'undone', text, nextText: redone }
  }
  if (undone !== null) return { state: 'applied', text, nextText: undone }
  if (redone !== null) return { state: 'undone', text, nextText: redone }
  return { state: 'conflict', reason: 'current content does not match the recorded change' }
}

/** 巡检一个条目（先判 fs 形状，否则走 hunk 文本路径）。 */
async function inspectOne(cwd: string, file: FileReviewChange): Promise<FileReviewFileResult> {
  const fsShape = fsChangeShape(file)
  if (fsShape !== null) return inspectFsChange(cwd, file, fsShape)
  if (file.diffs.length === 0 || !file.diffs.every(diff => hunkSupported(diff, file.path))) {
    return {
      path: file.path,
      state: 'unsupported',
      changed: false,
      reason: 'change has no complete reversible diff',
    }
  }
  try {
    const resolved = await resolveFile(cwd, file.path)
    const inspected = inspectText(resolved.lfText, file)
    return { path: file.path, state: inspected.state, changed: false, reason: inspected.reason }
  } catch (error) {
    return {
      path: file.path,
      state: 'error',
      changed: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 执行一个条目的开关动作（fs 形状直接落盘，否则走 hunk 回放 + CAS 复核）。 */
async function applyOne(
  cwd: string,
  file: FileReviewChange,
  action: FileReviewAction,
  rescueDir?: string,
): Promise<FileReviewFileResult> {
  const fsShape = fsChangeShape(file)
  if (fsShape !== null) return applyFsChange(cwd, file, action, fsShape, rescueDir)
  if (file.diffs.length === 0 || !file.diffs.every(diff => hunkSupported(diff, file.path))) {
    return {
      path: file.path,
      state: 'unsupported',
      changed: false,
      reason: 'change has no complete reversible diff',
    }
  }
  try {
    const resolved = await resolveFile(cwd, file.path)
    const inspected = inspectText(resolved.lfText, file)
    const sourceState = action === 'undo' ? 'applied' : 'undone'
    const targetState = action === 'undo' ? 'undone' : 'applied'
    if (inspected.state === targetState) {
      return { path: file.path, state: targetState, changed: false }
    }
    if (inspected.state !== sourceState || inspected.nextText === undefined) {
      return { path: file.path, state: inspected.state, changed: false, reason: inspected.reason }
    }

    // 提交前再读一次。对于不参与本包写锁的外部编辑器，这是能拿到的最近的
    // CAS 闸门——字节不等即判冲突，绝不覆盖别人的新修改。
    const current = await readFile(resolved.filename)
    if (!Buffer.from(resolved.bytes).equals(current)) {
      return {
        path: file.path,
        state: 'conflict',
        changed: false,
        reason: 'file changed while the operation was being prepared',
      }
    }
    await writeFileAtomic(
      resolved.filename,
      restoreNewlines(inspected.nextText, resolved.crlf),
      { mode: resolved.mode },
    )
    return { path: file.path, state: targetState, changed: true }
  } catch (error) {
    return {
      path: file.path,
      state: 'error',
      changed: false,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

/** 取会话工作区目录；缺失即抛错——没有围栏基准就绝不动任何文件。 */
function sessionCwd(agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') throw new Error('session has no workspace directory')
  return cwd
}

/** 每 agent 的 Code Mode 录制条数上限（超出淘汰最旧的）。 */
const RECORDED_PER_AGENT_CAP = 4000

/** 持久化记录文件的 JSON 字节上限；超出时丢弃最旧条目（保底保留最后一条）。 */
const RECORDED_BYTES_CAP = 64 * 1024 * 1024

/** 录制记录落盘的防抖窗口（毫秒）；run_code 修改通常成簇到达。 */
const RECORDS_FLUSH_MS = 400

/** 持久化记录格式版本；读取方拒绝其它版本（视为损坏，从空开始）。 */
const RECORDS_VERSION = 1

interface PersistedRecords {
  readonly version: typeof RECORDS_VERSION
  readonly mutations: readonly RecordedMutation[]
}

/** 逐字段收紧的录制条目校验——损坏记录自愈的第一道闸。 */
function isRecordedMutation(value: unknown): value is RecordedMutation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.rootCallId === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.path === 'string'
    && (candidate.before === null || typeof candidate.before === 'string')
    && typeof candidate.after === 'string'
}

/** 按条数上限裁剪（保留最新的）。 */
function capRecords(list: RecordedMutation[]): RecordedMutation[] {
  return list.length > RECORDED_PER_AGENT_CAP
    ? list.slice(list.length - RECORDED_PER_AGENT_CAP)
    : list
}

/** 记录文件名：可读前缀 + agentKey 的 16 位哈希，避免非法路径字符与碰撞。 */
function recordsFilename(agentKey: string): string {
  const hash = createHash('sha256').update(agentKey).digest('hex').slice(0, 16)
  const stem = agentKey.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40)
  return `${stem === '' ? 'agent' : stem}-${hash}.json`
}

/** 录制键：agent id 的字符串形态（同时用作落盘文件名的输入）。 */
function agentKey(agent: Agent): string {
  return String(agent.id)
}

/** 录制持久化选项。 */
export interface FileReviewServiceOptions {
  /** 记录目录根（shadow-rewind 存储根）；缺省/空串时保持纯内存（不落盘）。 */
  readonly storageDir?: string
}

/**
 * 以 `fileReview` 远端命名空间发布的宿主服务。
 *
 * 方法粒度刻意保持「一次请求 = 一批文件」：`status` 只读巡检，`apply` 在
 * 会话空闲窗口（`agent.runMaintenance`）里逐文件执行——绝不打断正在跑的
 * 回合，也绝不在请求内部并行（避免同一文件被两个动作交错）。
 */
export class FileReviewService extends TypertRemoteService {
  /** 每 agent 的 Code Mode（`run_code`）文件变更记录，按派发顺序。 */
  private readonly recordLog = new Map<string, RecordedMutation[]>()
  /** 已完成懒加载的 agent（此后变更直写 recordLog 并调度落盘）。 */
  private readonly loadedAgents = new Set<string>()
  /** 进行中的懒加载任务（recordMutation 与 recorded 共用，保证合并顺序）。 */
  private readonly loadingAgents = new Map<string, Promise<void>>()
  /** 懒加载完成前到达的变更缓冲；加载完成后按「磁盘在前、缓冲在后」合并。 */
  private readonly preLoad = new Map<string, RecordedMutation[]>()
  /** 每 agent 的落盘防抖定时器。 */
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 每 agent 的串行化落盘链（防抖触发可能晚于前一次写入）。 */
  private readonly flushChains = new Map<string, Promise<void>>()
  /** 录制记录落盘目录；undefined = 纯内存模式（不落盘）。 */
  private readonly recordsDir: string | undefined
  /** 删除类 fs 撤销的安全网目录：<storageDir>/file-review/rescue/。 */
  private readonly rescueDir: string | undefined

  constructor(ctx: Context, options: FileReviewServiceOptions = {}) {
    super(ctx, 'fileReview')
    this.recordsDir = options.storageDir !== undefined && options.storageDir.trim() !== ''
      ? join(options.storageDir, 'file-review', 'recorded')
      : undefined
    this.rescueDir = options.storageDir !== undefined && options.storageDir.trim() !== ''
      ? join(options.storageDir, 'file-review', 'rescue')
      : undefined
  }

  /** 为接收方 agent 追加一条嵌套（Code Mode）文件变更。 */
  recordMutation(agent: Agent, mutation: RecordedMutation): void {
    const key = agentKey(agent)
    if (!this.loadedAgents.has(key)) {
      // 懒加载尚未完成：先缓冲，完成后按「磁盘在前、缓冲在后」合并，保证全局
      // dispatch 顺序（磁盘条目全部属于上一个宿主生命周期）。
      const buffered = this.preLoad.get(key) ?? []
      buffered.push(mutation)
      this.preLoad.set(key, buffered)
      void this.ensureLoaded(key)
      return
    }
    const list = this.recordLog.get(key)
    if (list === undefined) {
      this.recordLog.set(key, [mutation])
    } else {
      list.push(mutation)
      if (list.length > RECORDED_PER_AGENT_CAP) {
        list.splice(0, list.length - RECORDED_PER_AGENT_CAP)
      }
    }
    this.scheduleFlush(key)
  }

  /** 返回被请求的那些 `run_code` 根调用所录制的变更（按派发顺序）。 */
  async recorded(agent: Agent, request: RecordedRequest): Promise<RecordedResult> {
    const key = agentKey(agent)
    await this.ensureLoaded(key)
    const list = this.recordLog.get(key)
    if (list === undefined || request.rootCallIds.length === 0) return { mutations: [] }
    const wanted = new Set(request.rootCallIds)
    return { mutations: list.filter(mutation => wanted.has(mutation.rootCallId)) }
  }

  // ── 录制记录持久化（懒加载 + 防抖原子写；任何失败都退化为纯内存） ─────────

  /** 确保该 agent 的磁盘记录已合并进内存；并发调用共享同一个加载任务。 */
  private ensureLoaded(key: string): Promise<void> {
    if (this.loadedAgents.has(key)) return Promise.resolve()
    const existing = this.loadingAgents.get(key)
    if (existing !== undefined) return existing
    const task = this.loadFromDisk(key).finally(() => { this.loadingAgents.delete(key) })
    this.loadingAgents.set(key, task)
    return task
  }

  /** 从磁盘读入并与加载期间缓冲的变更合并（磁盘在前、缓冲在后）。 */
  private async loadFromDisk(key: string): Promise<void> {
    try {
      if (this.recordsDir === undefined) return
      let raw: string
      try {
        raw = await readFile(join(this.recordsDir, recordsFilename(key)), 'utf8')
      } catch {
        return // 不存在或不可读：从空开始（首次使用是常态）。
      }
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
      const record = parsed as { version?: unknown; mutations?: unknown }
      if (record.version !== RECORDS_VERSION || !Array.isArray(record.mutations)) return
      const disk: RecordedMutation[] = []
      for (const entry of record.mutations) if (isRecordedMutation(entry)) disk.push(entry)
      const buffered = this.preLoad.get(key) ?? []
      this.preLoad.delete(key)
      const merged = capRecords([...disk, ...buffered])
      if (merged.length > 0) this.recordLog.set(key, merged)
      if (buffered.length > 0) this.scheduleFlush(key)
    } catch {
      // 损坏的记录文件：静默从空开始，下一次 flush 会用内存态重写。
    } finally {
      // 标志必须在加载完成后才置位：加载期间的变更走 preLoad 缓冲，
      // 这里统一兜底合并（磁盘在前、缓冲在后 = 全局 dispatch 顺序）。
      this.loadedAgents.add(key)
      const remaining = this.preLoad.get(key)
      if (remaining !== undefined) {
        this.preLoad.delete(key)
        const list = this.recordLog.get(key) ?? []
        list.push(...remaining)
        this.recordLog.set(key, capRecords(list))
        this.scheduleFlush(key)
      }
    }
  }

  /** 调度一次防抖落盘；窗口内重复调用只保留一个定时器。 */
  private scheduleFlush(key: string): void {
    if (this.recordsDir === undefined) return
    if (this.flushTimers.has(key)) return
    const timer = setTimeout(() => {
      this.flushTimers.delete(key)
      void this.flushNow(key)
    }, RECORDS_FLUSH_MS)
    timer.unref?.()
    this.flushTimers.set(key, timer)
  }

  /** 接在前一次落盘之后串行执行，避免两次写入交错。 */
  private flushNow(key: string): Promise<void> {
    const previous = this.flushChains.get(key) ?? Promise.resolve()
    const next = previous.then(() => this.writeRecords(key))
    this.flushChains.set(key, next)
    return next
  }

  /** 原子写入该 agent 的录制记录；超限时淘汰最旧条目并把内存态裁剪一致。 */
  private async writeRecords(key: string): Promise<void> {
    const list = this.recordLog.get(key)
    if (list === undefined || this.recordsDir === undefined) return
    let payload: PersistedRecords = { version: RECORDS_VERSION, mutations: [...list] }
    let text: string
    try {
      text = JSON.stringify(payload)
    } catch {
      return
    }
    if (Buffer.byteLength(text, 'utf8') > RECORDED_BYTES_CAP && list.length > 1) {
      // 超出字节上限：丢弃最旧条目直到放得下，并把内存态裁剪到一致。
      const trimmed = [...list]
      do {
        trimmed.shift()
        payload = { version: RECORDS_VERSION, mutations: [...trimmed] }
        try {
          text = JSON.stringify(payload)
        } catch {
          continue
        }
      } while (trimmed.length > 1 && Buffer.byteLength(text, 'utf8') > RECORDED_BYTES_CAP)
      this.recordLog.set(key, [...trimmed])
    }
    try {
      await mkdir(this.recordsDir, { recursive: true })
      await writeFileAtomic(join(this.recordsDir, recordsFilename(key)), text, { mode: 0o600 })
    } catch {
      // 落盘失败不影响内存态；下一次 recordMutation 会再次尝试。
    }
  }


  /** 只巡检当前磁盘状态，不动任何文件（可并发）。 */
  async status(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult> {
    const cwd = sessionCwd(agent)
    const files = await Promise.all(request.files.map(file => inspectOne(cwd, file)))
    return { files }
  }

  /**
   * 在接收方 Agent 空闲时逐个开关「各自独立安全」的文件。
   * 逐文件串行而非并行：同一路径的两个动作交错会让 CAS 闸门失去意义。
   * 单个文件失败不影响其余文件——结果里逐条如实报告。
   */
  async apply(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult> {
    const cwd = sessionCwd(agent)
    return agent.runMaintenance(async () => {
      const files: FileReviewFileResult[] = []
      for (const file of request.files) files.push(await applyOne(cwd, file, request.action, this.rescueDir))
      return { files }
    })
  }
}
