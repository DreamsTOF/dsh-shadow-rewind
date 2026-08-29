/** Host-side, workspace-contained undo / redo service for produced text diffs. */

import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
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

interface ResolvedFile {
  readonly filename: string
  readonly mode: number
  readonly bytes: Uint8Array
  /** Raw disk text (line endings as stored). */
  readonly text: string
  /** Whether the file uses CRLF line endings on disk. */
  readonly crlf: boolean
  /** Disk text normalized to the backend diff basis (LF), used for hunk math. */
  readonly lfText: string
}

/**
 * The mutation tools' recorded hunks (both diff cards and Code Mode
 * before/after values) ride the filesystem backend's LF-normalized basis,
 * while files on disk may use CRLF. All hunk matching therefore runs on the
 * normalized text; the write path restores the file's own line-ending style.
 */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function restoreNewlines(text: string, crlf: boolean): string {
  return crlf ? text.replace(/\n/g, '\r\n') : text
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

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

function hunkSupported(diff: ProducedFileDiff, path: string): boolean {
  if (diff.path !== path || diff.oldText === null || diff.oldText === diff.newText) return false
  if (diff.oldText === '' && diff.oldStart === undefined) return false
  if (diff.newText === '' && diff.newStart === undefined) return false
  return true
}

/** Apply a complete file's hunk sequence in memory, or report a strict mismatch. */
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

function hunkSidePresent(text: string, file: FileReviewChange, side: 'old' | 'new'): boolean {
  for (const diff of file.diffs) {
    const source = side === 'old' ? diff.oldText : diff.newText
    if (source === null) continue
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

function inspectText(text: string, file: FileReviewChange): InspectedFile {
  if (file.diffs.length === 0 || !file.diffs.every(diff => hunkSupported(diff, file.path))) {
    return { state: 'unsupported', reason: 'change has no complete reversible diff' }
  }
  const undone = transformFile(text, file, 'undo')
  const redone = transformFile(text, file, 'redo')
  if (undone !== null && redone !== null) {
    // Both directions textually succeed. This is the classic pure-append
    // shape: the before hunks are a lead-in prefix of the after hunks, so
    // they are contained in the after state too. Decide by what the CURRENT
    // text actually contains: the after hunks are present => applied (undo
    // strips them); otherwise the change is undone and only before hunks
    // remain.
    return hunkSidePresent(text, file, 'new')
      ? { state: 'applied', text, nextText: undone }
      : { state: 'undone', text, nextText: redone }
  }
  if (undone !== null) return { state: 'applied', text, nextText: undone }
  if (redone !== null) return { state: 'undone', text, nextText: redone }
  return { state: 'conflict', reason: 'current content does not match the recorded change' }
}

async function inspectOne(cwd: string, file: FileReviewChange): Promise<FileReviewFileResult> {
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

async function applyOne(
  cwd: string,
  file: FileReviewChange,
  action: FileReviewAction,
): Promise<FileReviewFileResult> {
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

    // Re-read immediately before commit. This is the closest available CAS fence for
    // external editors that do not participate in the package's writer lock.
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

function sessionCwd(agent: Agent): string {
  const cwd = agent.session.header.cwd
  if (cwd === undefined || cwd.trim() === '') throw new Error('session has no workspace directory')
  return cwd
}

/** Per-agent cap on recorded Code Mode mutations (oldest evicted first). */
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

function isRecordedMutation(value: unknown): value is RecordedMutation {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.rootCallId === 'string'
    && typeof candidate.name === 'string'
    && typeof candidate.path === 'string'
    && (candidate.before === null || typeof candidate.before === 'string')
    && typeof candidate.after === 'string'
}

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

function agentKey(agent: Agent): string {
  return String(agent.id)
}

/** 录制持久化选项。 */
export interface FileReviewServiceOptions {
  /** 记录目录根（shadow-rewind 存储根）；缺省/空串时保持纯内存（不落盘）。 */
  readonly storageDir?: string
}

/** Host service published as the `fileReview` Remote namespace. */
export class FileReviewService extends TypertRemoteService {
  /** Per-agent record of Code Mode (`run_code`) file mutations, dispatch order. */
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
  private readonly recordsDir: string | undefined

  constructor(ctx: Context, options: FileReviewServiceOptions = {}) {
    super(ctx, 'fileReview')
    this.recordsDir = options.storageDir !== undefined && options.storageDir.trim() !== ''
      ? join(options.storageDir, 'file-review', 'recorded')
      : undefined
  }

  /** Append one nested (Code Mode) file mutation for the receiving agent. */
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

  /** Return the recorded mutations for the requested `run_code` roots. */
  async recorded(agent: Agent, request: RecordedRequest): Promise<RecordedResult> {
    const key = agentKey(agent)
    await this.ensureLoaded(key)
    const list = this.recordLog.get(key)
    if (list === undefined || request.rootCallIds.length === 0) return { mutations: [] }
    const wanted = new Set(request.rootCallIds)
    return { mutations: list.filter(mutation => wanted.has(mutation.rootCallId)) }
  }

  // ── 录制记录持久化（懒加载 + 防抖原子写；任何失败都退化为纯内存） ─────────

  private ensureLoaded(key: string): Promise<void> {
    if (this.loadedAgents.has(key)) return Promise.resolve()
    const existing = this.loadingAgents.get(key)
    if (existing !== undefined) return existing
    const task = this.loadFromDisk(key).finally(() => { this.loadingAgents.delete(key) })
    this.loadingAgents.set(key, task)
    return task
  }

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

  private flushNow(key: string): Promise<void> {
    const previous = this.flushChains.get(key) ?? Promise.resolve()
    const next = previous.then(() => this.writeRecords(key))
    this.flushChains.set(key, next)
    return next
  }

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


  /** Inspect current disk state without changing files. */
  async status(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult> {
    const cwd = sessionCwd(agent)
    const files = await Promise.all(request.files.map(file => inspectOne(cwd, file)))
    return { files }
  }

  /** Toggle every independently safe file while the receiving Agent is idle. */
  async apply(agent: Agent, request: FileReviewRequest): Promise<FileReviewResult> {
    const cwd = sessionCwd(agent)
    return agent.runMaintenance(async () => {
      const files: FileReviewFileResult[] = []
      for (const file of request.files) files.push(await applyOne(cwd, file, request.action))
      return { files }
    })
  }
}
