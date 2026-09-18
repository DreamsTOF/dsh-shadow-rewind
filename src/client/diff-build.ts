/**
 * 从两份完整内容（检查点前后侧）反推行级审查 hunk。
 *
 * 变更事实的唯一来源是检查点 diff：宿主只下发路径、形态与净行数，完整内容
 * 在需要展示/撤销时按检查点懒取；本模块把两侧全文切成带行锚点的
 * `ProducedFileDiff`（与宿主 hunk 数学同一 LF 归一基准），供渲染与撤销共用。
 */
import { diffArrays } from 'diff'
import type { ProducedFileDiff } from '../file-review/change-types.ts'
import { diffContentLines } from './diff-text.ts'

/** 每个改动run 前后保留的未变更行数（对齐 unified diff 的观感）。 */
const CONTEXT_LINES = 3

/** 与宿主 hunk 数学同一基准的换行归一（file-review-service 的 normalizeNewlines
 * 语义）：CRLF 文件不归一会让每一行行尾带 \r 进入 hunk，宿主在 LF 文本上做
 * 锚点匹配永远失配（表现为假「内容冲突」）。 */
function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** 重建中的 hunk：两侧各自的行数组 + 各自的起始行号。 */
interface Hunk {
  readonly oldStart: number
  readonly newStart: number
  readonly old: string[]
  readonly new: string[]
}

/** 数出 hunk 末尾有多少行是两侧相同的上下文。 */
function trailingContext(hunk: Hunk): number {
  let count = 0
  const max = Math.min(hunk.old.length, hunk.new.length)
  for (let offset = 1; offset <= max; offset += 1) {
    if (hunk.old[hunk.old.length - offset] !== hunk.new[hunk.new.length - offset]) break
    count += 1
  }
  return count
}

/**
 * 一次文件变更的行级 hunk；文件是新建的（`before === null`）时返回单条整文件
 * 条目（oldText = null，撤销语义 = 删除文件）。变更没有实际改动文件时返回 []。
 */
export function diffsFromBeforeAfter(
  rawPath: string,
  rawBefore: string | null,
  rawAfter: string,
): readonly ProducedFileDiff[] {
  const path = rawPath
  const before = rawBefore === null ? null : normalizeLf(rawBefore)
  const after = normalizeLf(rawAfter)
  if (before === null) {
    // 空文件也是一次真实变更：与 write 工具的 null + '' 同形（added，
    // 撤销=删除），不得静默丢弃。
    return [{ path, oldText: null, newText: after }]
  }
  const oldLines = diffContentLines(before)
  const newLines = diffContentLines(after)
  if (oldLines.length === 0 && newLines.length === 0) return []
  if (oldLines.join('\n') === newLines.join('\n')) return []

  const hunks: Hunk[] = []
  const changes = diffArrays(oldLines, newLines)
  // 尚未被任何打开中的 hunk 收走的最近 CONTEXT_LINES 行未变更内容；
  // 它们会成为下一个 hunk 的前置上下文。
  let contextBuffer: string[] = []
  let oldCursor = 1
  let newCursor = 1
  let hunk: Hunk | null = null

  for (const change of changes) {
    if (!change.removed && !change.added) {
      const run = change.value
      if (hunk !== null) {
        const beforeLen = hunk.old.length
        hunk.old.push(...run)
        hunk.new.push(...run)
        oldCursor += run.length
        newCursor += run.length
        // 过长的未变更区段会断开 hunk：区段的前 CONTEXT_LINES 行留作本 hunk
        // 的后置上下文，后 CONTEXT_LINES 行留给下一个 hunk 当前置上下文——
        // 两段各自与自己的改动run 保持连续。
        if (run.length > CONTEXT_LINES * 2) {
          const target = beforeLen + CONTEXT_LINES
          hunk.old.length = target
          hunk.new.length = target
          contextBuffer = run.slice(-CONTEXT_LINES)
          hunk = null
        }
      } else {
        contextBuffer.push(...run)
        oldCursor += run.length
        newCursor += run.length
        if (contextBuffer.length > CONTEXT_LINES) {
          contextBuffer = contextBuffer.slice(-CONTEXT_LINES)
        }
      }
      continue
    }
    const removed = change.removed ? change.value : []
    const added = change.added ? change.value : []
    if (hunk === null) {
      const leading = contextBuffer
      hunk = {
        oldStart: oldCursor - leading.length,
        newStart: newCursor - leading.length,
        old: [...leading],
        new: [...leading],
      }
      hunks.push(hunk)
    }
    hunk.old.push(...removed)
    hunk.new.push(...added)
    oldCursor += removed.length
    newCursor += added.length
  }

  // 把每个 hunk 的后置上下文裁到 CONTEXT_LINES（未变更区段要超过
  // 2*CONTEXT_LINES 才会断开 hunk，所以最多只有文件末尾那一段喂多了）。
  for (const current of hunks) {
    const extra = Math.max(0, trailingContext(current) - CONTEXT_LINES)
    if (extra > 0) {
      current.old.length -= extra
      current.new.length -= extra
    }
  }

  return hunks
    .filter(hunkEntry => hunkEntry.old.length > 0 || hunkEntry.new.length > 0)
    .map(hunkEntry => ({
      path,
      // 空的旧侧（把内容写进原本为空的文件）必须保持 '' ——塌缩成 null 会把
      // 这个 hunk 错标成「新建文件」，从而失去可逆性。只有上面 `before === null`
      // 那条才带 null 旧侧。
      oldText: hunkEntry.old.join('\n'),
      newText: hunkEntry.new.join('\n'),
      oldStart: hunkEntry.oldStart,
      newStart: hunkEntry.newStart,
    }))
}