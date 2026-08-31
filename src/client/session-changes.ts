/**
 * Session-wide produced-file derivation from a finalized ConversationSnapshot.
 * Client-only and model-free: the vocabulary is the mutation tools' own
 * follow-along `locations` and diff views, never the closing prose. This is
 * the sidebar-tab analogue of dsh-file-review's turn-deliverables.ts: instead
 * of a ConversationNodeDefinition accumulating one turn's data for the
 * turn-tail slot, it derives EVERY in-window turn's changes from the session
 * snapshot's finalized nodes, attributing each tool result to its owning
 * turn through `turnEnds` (completed turns) or the live turn counters.
 */
import type {
  ConversationSnapshot, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ProducedFileDiff, RecordedMutation } from '../file-review/change-types.ts'
import { deletedPaths } from './deleted-paths.ts'
import { diffsFromBeforeAfter } from './recorded-diffs.ts'

/** 写盘归因关联到的命令执行窗口（闸关归因命令级时附带）。 */
export interface FsCommandRef {
  readonly tool: string
  readonly callId?: string
  readonly sessionId: string
  readonly startedAt: number
  readonly endedAt: number
}

/** 写盘归因字段（仅闸关时宿主提供；开闸/旧宿主全部缺省）：
 * 'target' = 本会话，'multi' = 多会话，'unknown' = 不可知，其它 = 会话 id。 */
export interface FsAttributionFields {
  readonly owner?: string
  /** 归属本会话 → true（默认勾选）；其它/歧义 → false（须显式勾选）。 */
  readonly autoSelect?: boolean
  /** 归因置信层级：命令级 / 歧义 / 外部写入 / 窗口级 / 不可知。 */
  readonly attribution?: 'command' | 'ambiguous' | 'external' | 'window' | 'unknown'
  /** 归因到的命令执行窗口（仅 attribution === 'command' 时附带）。 */
  readonly command?: FsCommandRef
  /** 当前内容的写入时间（快照 mtime，ms epoch；旧清单无此字段则缺省）。 */
  readonly writtenAt?: number
}

/** One changed file inside one turn, hunks appended in settlement order. */
export interface SessionFileChange extends FsAttributionFields {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  /** Terminal commands deleted this path in this turn (display-only). */
  readonly deleted?: true
  /** 条目来源：'fs' = 检查点对比派生（终端写盘）；缺省 = 工具结果视图。 */
  readonly origin?: 'fs'
  /** 空目录条目（撤销语义是 mkdir/rmdir，不涉内容）。 */
  readonly dir?: true
  /** 服务端预算的行数（fs 条目懒加载全文前的显示用；缺省按 diffs 汇总）。 */
  readonly counts?: { readonly added: number; readonly removed: number }
}

/** One turn's produced files, in first-seen order. */
export interface TurnFileChanges {
  readonly turn: number
  /** Whether the owning turn is still running (its change set may grow). */
  readonly live: boolean
  readonly files: readonly SessionFileChange[]
}

/** Internal per-path accumulator: hunk list plus the last deletion state. */
interface FileAccumulator {
  diffs: ProducedFileDiff[]
  deleted?: true
}

/**
 * Paths a call view reports having created or changed, by render intent
 * rather than tool name: a diff card, or a generic card whose kind is `edit`.
 * Mirrors dsh-file-review's producedPaths exactly (unknown-safe).
 */
export function producedPaths(view: unknown): readonly string[] {
  if (typeof view !== 'object' || view === null || Array.isArray(view)) return []
  const record = view as Record<string, unknown>
  if (record.card !== 'diff' && !(record.card === 'generic' && record.kind === 'edit')) return []
  const locations = record.locations
  if (!Array.isArray(locations)) return []
  const paths: string[] = []
  const seen = new Set<string>()
  for (const location of locations) {
    if (typeof location !== 'object' || location === null || Array.isArray(location)) continue
    const path = (location as Record<string, unknown>).path
    if (typeof path !== 'string' || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
  }
  return paths
}

/** Validate diff hunks crossing the Host/browser transport (unknown-safe). */
export function producedDiffs(view: unknown): readonly ProducedFileDiff[] {
  if (typeof view !== 'object' || view === null || Array.isArray(view)) return []
  const record = view as Record<string, unknown>
  if (record.card !== 'diff' || !Array.isArray(record.diffs)) return []
  const diffs: ProducedFileDiff[] = []
  for (const value of record.diffs) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return rejectDiffs(record.diffs.length)
    const { path, oldText, newText, oldStart, newStart } = value as Record<string, unknown>
    if (typeof path !== 'string'
      || (oldText !== null && typeof oldText !== 'string')
      || typeof newText !== 'string'
      || (oldStart !== undefined
        && (typeof oldStart !== 'number' || !Number.isInteger(oldStart) || oldStart < 1))
      || (newStart !== undefined
        && (typeof newStart !== 'number' || !Number.isInteger(newStart) || newStart < 1))) {
      return rejectDiffs(record.diffs.length)
    }
    diffs.push({
      path,
      oldText,
      newText,
      ...(typeof oldStart === 'number' ? { oldStart } : {}),
      ...(typeof newStart === 'number' ? { newStart } : {}),
    })
  }
  return diffs
}

/** 一条 hunk 形状不完整就整组丢弃是刻意设计（宿主撤销要求全量可逆）；
 * 但静默丢弃曾让「文件在列、撤销永久禁用」无从排查——至少留痕。 */
function rejectDiffs(total: number): readonly ProducedFileDiff[] {
  console.warn(`[dsh-shadow-rewind] diff 视图中存在不可解析的 hunk，整组丢弃（共 ${String(total)} 条）`)
  return []
}

/** Applied result hunks, or call-intent hunks when no result view exists. */
function reviewDiffs(node: ToolResultNode): readonly ProducedFileDiff[] {
  // 与 turn-deliverables 的 reviewDiffs 同一规则：result view 拿不到可用
  // hunks 时回退 call view——只认 result view 会让 hunks 静默丢失。
  const fromResult = node.resultView !== null ? producedDiffs(node.resultView) : []
  if (fromResult.length > 0) return fromResult
  return producedDiffs(node.callView)
}

/**
 * Attribute an event seq to its owning turn. Completed turns own the seq
 * range up to their `turn/end` seq; anything past the last completed end
 * belongs to the live turn (the in-flight `partial` / running call's turn,
 * or the next turn number when nothing live is observable).
 */
function turnAttribution(snapshot: ConversationSnapshot): (seq: number) => { turn: number; live: boolean } {
  const ends = [...snapshot.turnEnds.entries()].sort((a, b) => a[1] - b[1])
  const liveTurn = snapshot.partial?.turn
    ?? snapshot.runningCalls[0]?.turn
    ?? ((ends.at(-1)?.[0] ?? 0) + 1)
  return (seq: number) => {
    for (const [turn, endSeq] of ends) {
      if (endSeq >= seq) return { turn, live: false }
    }
    return { turn: liveTurn, live: true }
  }
}

/** Derive one session's per-turn produced-file changes (uncached core). */
function derive(snapshot: ConversationSnapshot): TurnFileChanges[] {
  const attribute = turnAttribution(snapshot)
  const byTurn = new Map<number, { live: boolean; files: Map<string, FileAccumulator> }>()
  for (const node of snapshot.nodes) {
    if (node.kind !== 'tool-result' || node.isError) continue
    const paths = producedPaths(node.callView)
    // dsh has no delete-file tool: deletions happen in the terminals, and a
    // successful terminal call's literal rm-family arguments are the only
    // record of them. They surface as hunk-less, non-undoable entries.
    const deletions = paths.length === 0 ? deletedPaths(node.callView) : []
    if (paths.length === 0 && deletions.length === 0) continue
    const diffs = reviewDiffs(node)
    const { turn, live } = attribute(node.seq)
    let group = byTurn.get(turn)
    if (group === undefined) {
      group = { live, files: new Map() }
      byTurn.set(turn, group)
    }
    for (const path of paths) {
      const own = diffs.filter(diff => diff.path === path)
      const existing = group.files.get(path)
      if (existing === undefined) group.files.set(path, { diffs: [...own] })
      else {
        existing.diffs.push(...own)
        delete existing.deleted
      }
    }
    for (const path of deletions) {
      const existing = group.files.get(path)
      if (existing === undefined) group.files.set(path, { diffs: [], deleted: true })
      else existing.deleted = true
    }
  }
  return [...byTurn.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => ({
      turn,
      live: group.live,
      files: [...group.files.entries()].map(([path, own]) => ({
        path,
        diffs: own.diffs,
        ...(own.deleted === true ? { deleted: true as const } : {}),
      })),
    }))
}

/**
 * Snapshot-identity cache: the sidebar badge runs this derivation on every
 * tab-bar render, so the result is memoized per immutable snapshot reference
 * (the session publishes a fresh reference only when content changes).
 */
const cache = new WeakMap<ConversationSnapshot, TurnFileChanges[]>()

/** Derive per-turn produced-file changes for one session snapshot. */
export function deriveSessionChanges(snapshot: ConversationSnapshot | null): TurnFileChanges[] {
  if (snapshot === null) return []
  const hit = cache.get(snapshot)
  if (hit !== undefined) return hit
  const derived = derive(snapshot)
  cache.set(snapshot, derived)
  return derived
}

/**
 * One Code Mode (`run_code`) root visible in the snapshot, with the turn it
 * settles into. Children (`subCalls`) carry no reusable views, so the reset of
 * their review data arrives asynchronously from the Host recorder; these roots
 * are the join keys (the `run_code` `callId` is the dispatch `rootCallId`).
 */
export interface SessionRoot {
  readonly turn: number
  readonly live: boolean
  readonly rootCallId: string
}

/** Every `run_code` tool-result node in the window, in node order. */
export function deriveSessionRoots(snapshot: ConversationSnapshot): SessionRoot[] {
  const attribute = turnAttribution(snapshot)
  const roots: SessionRoot[] = []
  for (const node of snapshot.nodes) {
    if (node.kind !== 'tool-result' || node.isError) continue
    if (node.subCalls.length === 0) continue
    const { turn, live } = attribute(node.seq)
    roots.push({ turn, live, rootCallId: node.callId })
  }
  return roots
}

/**
 * Merge Host-recorded Code Mode mutations into the snapshot-derived turns:
 * hunks rebuilt from the full before/after are appended to the owning turn's
 * file groups (same-path entries stay one row, hunks appended in dispatch
 * order), so the tab's diff rendering, status inspection and undo all work on
 * programmatic edits exactly like model-direct ones. All inputs are immutable;
 * the result is a fresh array only when a recorded mutation matched a visible
 * root.
 */
export function mergeRecordedTurns(
  turns: readonly TurnFileChanges[],
  roots: readonly SessionRoot[],
  recorded: readonly RecordedMutation[],
): readonly TurnFileChanges[] {
  if (recorded.length === 0 || roots.length === 0) return turns
  const rootTurns = new Map<string, { turn: number; live: boolean }>()
  for (const root of roots) rootTurns.set(root.rootCallId, { turn: root.turn, live: root.live })
  const byRoot = new Map<string, RecordedMutation[]>()
  for (const mutation of recorded) {
    const list = byRoot.get(mutation.rootCallId)
    if (list === undefined) byRoot.set(mutation.rootCallId, [mutation])
    else list.push(mutation)
  }
  let matched = false
  for (const root of roots) {
    if (byRoot.has(root.rootCallId)) { matched = true; break }
  }
  if (!matched) return turns

  const groups = new Map<number, { live: boolean; files: Map<string, FileAccumulator> }>()
  for (const turn of turns) {
    const files = new Map<string, FileAccumulator>()
    for (const file of turn.files) {
      files.set(file.path, {
        diffs: [...file.diffs],
        ...(file.deleted === true ? { deleted: true as const } : {}),
      })
    }
    groups.set(turn.turn, { live: turn.live, files })
  }
  for (const [rootCallId, mutations] of byRoot) {
    const owner = rootTurns.get(rootCallId)
    if (owner === undefined) continue
    let group = groups.get(owner.turn)
    if (group === undefined) {
      group = { live: owner.live, files: new Map() }
      groups.set(owner.turn, group)
    }
    for (const mutation of mutations) {
      const diffs = diffsFromBeforeAfter(mutation.path, mutation.before, mutation.after)
      if (diffs.length === 0) continue
      const existing = group.files.get(mutation.path)
      if (existing === undefined) group.files.set(mutation.path, { diffs: [...diffs] })
      else existing.diffs.push(...diffs)
    }
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([turn, group]) => ({
      turn,
      live: group.live,
      files: [...group.files.entries()].map(([path, own]) => ({
        path,
        diffs: own.diffs,
        ...(own.deleted === true ? { deleted: true as const } : {}),
      })),
    }))
}

/** Count distinct changed paths across every turn (the sidebar badge count). */
export function countChangedFiles(turns: readonly TurnFileChanges[]): number {
  const paths = new Set<string>()
  for (const turn of turns) {
    for (const file of turn.files) paths.add(file.path)
  }
  return paths.size
}

/** Trailing path segment, the part that identifies the file at a glance. */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** POSIX root, drive-letter, or UNC absolute-path test (separator-agnostic). */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

/** Resolve a (possibly relative) tool path against the session cwd. */
export function resolveSessionPath(cwd: string | undefined, path: string): string {
  if (isAbsolutePath(path)) return path
  const base = cwd ?? ''
  if (base === '') return path
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${path}`
}
