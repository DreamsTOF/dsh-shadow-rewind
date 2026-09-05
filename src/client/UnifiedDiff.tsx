/**
 * 统一的单栏 diff 视图内核 —— 轮尾卡片、live 条浮层、侧边栏三个面共用的
 * 渲染组件，也是「视图端 hunk 数学」的唯一实现。
 *
 * 设计要点：
 *  - **行数统计与渲染同源**：`summarizeDiffs` 用与渲染完全相同的行级 diff
 *    算法计 +/−，徽标数字和画出来的行永远一致；
 *  - **复制与所见即所得**：`unifiedDiffText` 直接复用同一套 `hunkLines`，
 *    复制出来的纯文本就是视图上那一段；
 *  - **渲染预算**：超过 `MAX_RENDER_LINES` 的行折叠成按钮，大 diff 不拖垮
 *    列表；
 *  - **块级选择 / 导航**：提供可选的 hunk 勾选（参与撤销子集）与 ↑/↓ 修改点
 *    跳转，选择由宿主组件经 `selectedHunks` 受控。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { diffArrays } from 'diff'
import type { ProducedFileDiff as DiffHunk } from '../file-review/change-types.ts'
import { lineHighlight } from '../char-highlight.ts'
import { diffContentLines } from './diff-text.ts'
import css from './UnifiedDiff.module.css'

/** 审查 diff 需要的本地化标签（由宿主从字典注入）。 */
export interface UnifiedDiffLabels {
  readonly copy: string
  readonly copied: string
  readonly showUnchanged: (count: number) => string
  readonly hideUnchanged: (count: number) => string
  /** 显示在勾选框旁的 hunk 序数（「块 {n}」）。 */
  readonly hunkN: (n: number) => string
  /** 勾选框的提示：被勾选的 hunk 才参与撤销/重新应用。 */
  readonly hunkInclude: string
}

/** 与视图渲染同一 hunk 源推导出的增/删行数合计。 */
export interface UnifiedDiffStats {
  readonly added: number
  readonly removed: number
}

/** 渲染行类别：上下文 / 删除 / 新增。 */
type UnifiedLineKind = 'context' | 'del' | 'add'

/** 一行渲染单元：两侧行号 + 文本 + 可选的行内高亮。 */
interface UnifiedLine {
  readonly kind: UnifiedLineKind
  readonly oldNumber: number | null
  readonly newNumber: number | null
  readonly text: string
  /** 行内字符级高亮区间（[start, end)）：仅替换对（删/增行数相等）的行携带。 */
  readonly hl?: readonly (readonly [number, number])[]
}

/** 被折叠起来的上下文 gap（点击可展开）。 */
interface UnifiedGap {
  readonly kind: 'gap'
  readonly id: string
  readonly lines: readonly UnifiedLine[]
}

type UnifiedRow = UnifiedLine | UnifiedGap

/** 渲染层里的一个 hunk 单元：展开后的行序列 + 汇总数字。 */
interface UnifiedHunk {
  readonly rows: readonly UnifiedRow[]
  readonly added: number
  readonly removed: number
  readonly unchangedBefore: number
}

/** UnifiedDiff 的入参。 */
interface UnifiedDiffProps {
  readonly diffs: readonly DiffHunk[]
  readonly contextLines: number
  readonly labels: UnifiedDiffLabels
  readonly className?: string | undefined
  readonly showCopyButton?: boolean | undefined
  readonly showFileHeaders?: boolean | undefined
  /** 块级选择（可选）：提供后每个 hunk 上方渲染勾选框。 */
  readonly selectable?: boolean | undefined
  /** 选中 hunk 的下标集合；undefined 表示隐式全选。 */
  readonly selectedHunks?: ReadonlySet<number> | undefined
  readonly onSelectedHunksChange?: ((next: ReadonlySet<number>) => void) | undefined
  /** 修改点跳转（可选）：渲染 ↑/↓ 导航 + 挂载时自动定位首个变更块。
   * 长 diff 的滚动刚需（借鉴 dsh-checkpoint-diff 的块级跳转 UX）。 */
  readonly navigation?: boolean | undefined
}

/** 渲染行数上限：超出折叠为「显示其余」按钮（大 diff 的渲染防线）。 */
const MAX_RENDER_LINES = 800

/** 把单个 hunk 的行级 diff 展开为带行号的渲染行序列。 */
function hunkLines(diff: DiffHunk): UnifiedLine[] {
  const oldLines = diff.oldText === null ? [] : diffContentLines(diff.oldText)
  const newLines = diffContentLines(diff.newText)
  const changes = diffArrays(oldLines, newLines)
  const lines: UnifiedLine[] = []
  let oldNumber = diff.oldStart ?? 1
  let newNumber = diff.newStart ?? 1
  // 记录每组（连续 del / add / context）在 lines 中的下标区间，供替换对配对。
  const groups: { readonly kind: 'del' | 'add' | 'context'; readonly start: number; readonly count: number }[] = []

  for (const change of changes) {
    const start = lines.length
    if (change.removed) {
      for (const text of change.value) {
        lines.push({ kind: 'del', oldNumber, newNumber: null, text })
        oldNumber++
      }
      groups.push({ kind: 'del', start, count: change.value.length })
    } else if (change.added) {
      for (const text of change.value) {
        lines.push({ kind: 'add', oldNumber: null, newNumber, text })
        newNumber++
      }
      groups.push({ kind: 'add', start, count: change.value.length })
    } else {
      for (const text of change.value) {
        lines.push({ kind: 'context', oldNumber, newNumber, text })
        oldNumber++
        newNumber++
      }
      groups.push({ kind: 'context', start, count: change.value.length })
    }
  }

  // 行内字符级高亮（移植自 dsh-edit-diff）：相邻删/增组且行数相等 = 替换对，
  // 逐行做字符级 diff，把真正变化的字符段标出；其余形状（纯增/纯删）不高亮。
  for (let i = 0; i < groups.length - 1; i++) {
    const del = groups[i]!
    const add = groups[i + 1]!
    if (del.kind !== 'del' || add.kind !== 'add' || del.count !== add.count) continue
    for (let k = 0; k < del.count; k++) {
      const delLine = lines[del.start + k]!
      const addLine = lines[add.start + k]!
      const hl = lineHighlight(delLine.text, addLine.text)
      lines[del.start + k] = { ...delLine, hl: hl.del }
      lines[add.start + k] = { ...addLine, hl: hl.add }
    }
  }
  return lines
}

/** 把一列行按上下文折叠：每段连续上下文只留头尾各 contextLines 行，中间折成 gap。 */
function collapsedRows(lines: readonly UnifiedLine[], contextLines: number, hunkIndex: number): UnifiedRow[] {
  const rows: UnifiedRow[] = []
  let cursor = 0
  let gapIndex = 0
  while (cursor < lines.length) {
    const current = lines[cursor]
    if (current?.kind !== 'context') {
      if (current !== undefined) rows.push(current)
      cursor++
      continue
    }

    const start = cursor
    while (cursor < lines.length && lines[cursor]?.kind === 'context') cursor++
    const run = lines.slice(start, cursor)
    const leading = start === 0
    const trailing = cursor === lines.length
    const hiddenStart = leading ? 0 : Math.min(contextLines, run.length)
    const hiddenEnd = trailing
      ? run.length
      : Math.max(hiddenStart, run.length - contextLines)

    rows.push(...run.slice(0, hiddenStart))
    const hidden = run.slice(hiddenStart, hiddenEnd)
    if (hidden.length > 0) {
      rows.push({ kind: 'gap', id: `${hunkIndex}:${gapIndex}`, lines: hidden })
      gapIndex++
    }
    rows.push(...run.slice(hiddenEnd))
  }
  return rows
}

/** 把所有 hunk 展开为渲染单元，并按行锚点推算各 hunk 前被省略的上下文行数。 */
function buildHunks(diffs: readonly DiffHunk[], contextLines: number): UnifiedHunk[] {
  let previousPath: string | undefined
  let previousOldEnd = 1
  let previousNewEnd = 1
  return diffs.map((diff, index) => {
    const lines = hunkLines(diff)
    const oldCount = lines.filter(line => line.oldNumber !== null).length
    const newCount = lines.filter(line => line.newNumber !== null).length
    const oldStart = diff.oldStart ?? 1
    const newStart = diff.newStart ?? 1
    const hasStarts = diff.oldStart !== undefined && diff.newStart !== undefined
    const unchangedBefore = hasStarts
      ? Math.max(0, Math.min(
        oldStart - (diff.path === previousPath ? previousOldEnd : 1),
        newStart - (diff.path === previousPath ? previousNewEnd : 1),
      ))
      : 0
    previousPath = diff.path
    previousOldEnd = oldStart + oldCount
    previousNewEnd = newStart + newCount
    return {
      rows: collapsedRows(lines, contextLines, index),
      added: lines.filter(line => line.kind === 'add').length,
      removed: lines.filter(line => line.kind === 'del').length,
      unchangedBefore,
    }
  })
}

/** 把录制的 hunks 序列化成一段纯文本 unified diff（复制按钮的输出）。 */
export function unifiedDiffText(diffs: readonly DiffHunk[]): string {
  let previousPath: string | undefined
  const output: string[] = []
  for (const diff of diffs) {
    if (diff.path !== previousPath) output.push(diff.path)
    else output.push(`@@ -${diff.oldStart ?? 1} +${diff.newStart ?? 1} @@`)
    previousPath = diff.path
    for (const line of hunkLines(diff)) {
      const prefix = line.kind === 'del' ? '-' : line.kind === 'add' ? '+' : ' '
      output.push(`${prefix} ${line.text}`)
    }
  }
  return output.join('\n')
}

/** 用与视图完全相同的行级 diff 算法统计增/删行数（与渲染零偏差）。 */
export function summarizeDiffs(diffs: readonly DiffHunk[]): UnifiedDiffStats {
  let added = 0
  let removed = 0
  for (const diff of diffs) {
    for (const line of hunkLines(diff)) {
      if (line.kind === 'add') added++
      if (line.kind === 'del') removed++
    }
  }
  return { added, removed }
}

/** 该行的两侧行号串（用于展开 gap 内行的稳定 key）。 */
function lineNumbers(line: UnifiedLine): string {
  const oldNumber = line.oldNumber === null ? '' : String(line.oldNumber)
  const newNumber = line.newNumber === null ? '' : String(line.newNumber)
  return `${oldNumber}, ${newNumber}`
}

/** 该行显示在哪一侧的行号：删除行走旧号，其余行走新号。 */
function lineNumber(line: UnifiedLine): number | null {
  return line.kind === 'del' ? line.oldNumber : line.newNumber
}

/** 行文本渲染：带行内高亮区间时把变化字符段包进下划线 span（dsh-edit-diff 的字符级精度）。 */
function renderLineText(line: UnifiedLine): ReactNode {
  const ranges = line.hl
  if (ranges === undefined || ranges.length === 0) return line.text
  const parts: ReactNode[] = []
  let cursor = 0
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index]!
    const start = range[0]
    const end = Math.min(range[1], line.text.length)
    if (start > cursor) parts.push(line.text.slice(cursor, start))
    if (end > start) parts.push(<span key={index} className={css.unifiedHighlight}>{line.text.slice(start, end)}</span>)
    cursor = Math.max(cursor, end)
  }
  if (cursor < line.text.length) parts.push(line.text.slice(cursor))
  return parts
}

/**
 * 渲染带单一行号槽 + 可展开上下文 gap 的行对齐 hunks。
 * @param props - unified diff 数据、本地化标签与展示选项。
 * @returns 带行号的 unified diff 视图。
 */
export function UnifiedDiff({
  diffs,
  contextLines,
  labels,
  className,
  showCopyButton = true,
  showFileHeaders = true,
  selectable = false,
  selectedHunks,
  onSelectedHunksChange,
  navigation = false,
}: UnifiedDiffProps) {
  const hunks = useMemo(() => buildHunks(diffs, contextLines), [contextLines, diffs])
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<string>>(() => new Set())
  const [copied, setCopied] = useState(false)
  const [showAllRows, setShowAllRows] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [navIndex, setNavIndex] = useState(0)

  // 渲染预算 + 变更块枚举：块 = 连续的 del/add 行（gap/context 打断）；
  // 超出 MAX_RENDER_LINES 的行折叠，由底部按钮展开。
  const rendered = useMemo(() => {
    let budget = MAX_RENDER_LINES
    let hiddenRows = 0
    const blockKeys: string[] = []
    const blockIndexByRow = new Map<string, number>()
    let blockCounter = -1
    let prevChange = false
    const cutHunks = hunks.map((hunk, hunkIndex) => {
      const rows: UnifiedRow[] = []
      for (const row of hunk.rows) {
        if (row.kind === 'gap') {
          if (budget > 0) {
            rows.push(row)
            prevChange = false
          } else hiddenRows++
          continue
        }
        if (budget <= 0) { hiddenRows++; continue }
        budget -= 1
        const isChange = row.kind !== 'context'
        if (isChange) {
          if (!prevChange) {
            blockCounter += 1
            blockKeys.push(`${String(hunkIndex)}:${row.kind}:${String(row.oldNumber ?? '')}:${String(row.newNumber ?? '')}`)
          }
          blockIndexByRow.set(`${String(hunkIndex)}:${row.kind}:${String(row.oldNumber ?? '')}:${String(row.newNumber ?? '')}`, blockCounter)
        }
        prevChange = isChange
        rows.push(row)
      }
      return { ...hunk, rows }
    })
    return { hunks: cutHunks, blockKeys, blockIndexByRow, hiddenRows, truncated: hiddenRows > 0 }
  }, [hunks])

  // diffs 变化时重置折叠与导航（新内容从头看）。
  useEffect(() => {
    setShowAllRows(false)
    setNavIndex(0)
  }, [diffs])

  const scrollToBlock = useCallback((index: number) => {
    const root = containerRef.current
    if (root === null) return
    const key = rendered.blockKeys[index]
    if (key === undefined) return
    root.querySelector(`[data-block="${key}"]`)?.scrollIntoView({ block: 'center' })
    setNavIndex(index)
  }, [rendered.blockKeys])

  // 挂载时自动定位首个变更块（navigation 面的默认行为）。
  useEffect(() => {
    if (navigation) scrollToBlock(0)
    // 仅挂载与导航开关变化时执行。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation])

  const onCopy = useCallback(() => {
    if (copied) return
    void navigator.clipboard?.writeText(unifiedDiffText(diffs)).then(() => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    }).catch(() => {})
  }, [copied, diffs])

  if (diffs.length === 0) return null

  const totals = new Map<string, { added: number; removed: number }>()
  for (const [index, diff] of diffs.entries()) {
    const hunk = rendered.hunks[index]
    const previous = totals.get(diff.path) ?? { added: 0, removed: 0 }
    totals.set(diff.path, {
      added: previous.added + (hunk?.added ?? 0),
      removed: previous.removed + (hunk?.removed ?? 0),
    })
  }

  let previousPath: string | undefined
  return (
    <div
      ref={containerRef}
      className={`${css.unifiedBlock} ${showFileHeaders ? '' : css.unifiedEmbedded} ${className ?? ''}`}
      data-diff=""
      data-diff-layout="unified"
    >
      {showCopyButton && (
        <button type="button" className={css.unifiedCopyButton} onClick={onCopy}>
          {copied ? labels.copied : labels.copy}
        </button>
      )}
      {navigation && rendered.blockKeys.length > 0 && (
        <div className={css.unifiedNav}>
          <button
            type="button"
            aria-label="上一个修改点"
            disabled={navIndex <= 0}
            onClick={() => { scrollToBlock(navIndex - 1) }}
          >↑</button>
          <span>{String(navIndex + 1)}/{String(rendered.blockKeys.length)}</span>
          <button
            type="button"
            aria-label="下一个修改点"
            disabled={navIndex >= rendered.blockKeys.length - 1}
            onClick={() => { scrollToBlock(navIndex + 1) }}
          >↓</button>
        </div>
      )}
      {diffs.map((diff, hunkIndex) => {
        const firstForPath = diff.path !== previousPath
        previousPath = diff.path
        const total = totals.get(diff.path) ?? { added: 0, removed: 0 }
        const hunk = rendered.hunks[hunkIndex]
        return (
          <section key={`${diff.path}:${hunkIndex}`} className={css.unifiedFile}>
            {selectable && (
              <div className={css.unifiedHunkBar}>
                <label className={css.unifiedHunkSelect} title={labels.hunkInclude}>
                  <input
                    type="checkbox"
                    checked={selectedHunks === undefined || selectedHunks.has(hunkIndex)}
                    onChange={(event) => {
                      const next = new Set(selectedHunks ?? diffs.map((_, index) => index))
                      if (event.target.checked) next.add(hunkIndex)
                      else next.delete(hunkIndex)
                      onSelectedHunksChange?.(next)
                    }}
                  />
                  <span>{labels.hunkN(hunkIndex + 1)}</span>
                </label>
              </div>
            )}
            {showFileHeaders && firstForPath
              ? (
                <header className={css.unifiedHeader}>
                  <span className={css.unifiedStatus}>M</span>
                  <span className={css.unifiedPath}>{diff.path}</span>
                  <span className={css.unifiedAdded}>+{total.added}</span>
                  <span className={css.unifiedRemoved}>-{total.removed}</span>
                </header>
              )
              : !firstForPath && (hunk?.unchangedBefore ?? 0) === 0
                ? <div className={css.unifiedHunkHeader}>@@ -{diff.oldStart ?? 1} +{diff.newStart ?? 1} @@</div>
                : null}
            <div className={css.unifiedBody}>
              {(hunk?.unchangedBefore ?? 0) > 0 && (
                <div className={css.unifiedOmitted}>
                  <span aria-hidden="true">↕</span>
                  {labels.showUnchanged(hunk?.unchangedBefore ?? 0)}
                </div>
              )}
              {(hunk?.rows ?? []).flatMap((row) => {
                if (row.kind !== 'gap') {
                  const sign = row.kind === 'del' ? '-' : row.kind === 'add' ? '+' : ' '
                  const blockIndex = rendered.blockIndexByRow.get(`${String(hunkIndex)}:${row.kind}:${String(row.oldNumber ?? '')}:${String(row.newNumber ?? '')}`)
                  return [(
                    <div
                      key={`${row.kind}:${row.oldNumber ?? ''}:${row.newNumber ?? ''}`}
                      className={`${css.unifiedLine} ${css[`unified_${row.kind}`] ?? ''}`}
                      data-line-kind={row.kind}
                      data-old-line={row.oldNumber ?? undefined}
                      data-new-line={row.newNumber ?? undefined}
                      data-block={blockIndex === undefined ? undefined : `${String(hunkIndex)}:${row.kind}:${String(row.oldNumber ?? '')}:${String(row.newNumber ?? '')}`}
                    >
                      <span className={css.unifiedLineNumber}>{lineNumber(row)}</span>
                      <span className={css.unifiedSign}>{sign}</span>
                      <span className={css.unifiedText}>{renderLineText(row)}</span>
                    </div>
                  )]
                }

                const expanded = expandedGaps.has(row.id)
                if (expanded) {
                  return [
                    <button
                      key={`${row.id}:control`}
                      type="button"
                      className={css.unifiedGap}
                      aria-expanded="true"
                      onClick={() => {
                        setExpandedGaps((current) => {
                          const next = new Set(current)
                          next.delete(row.id)
                          return next
                        })
                      }}
                    >
                      {labels.hideUnchanged(row.lines.length)}
                    </button>,
                    ...row.lines.map(line => (
                      <div
                        key={`${row.id}:${lineNumbers(line)}`}
                        className={`${css.unifiedLine} ${css.unified_context}`}
                        data-line-kind="context"
                        data-old-line={line.oldNumber ?? undefined}
                        data-new-line={line.newNumber ?? undefined}
                      >
                        <span className={css.unifiedLineNumber}>{lineNumber(line)}</span>
                        <span className={css.unifiedSign}> </span>
                        <span className={css.unifiedText}>{line.text}</span>
                      </div>
                    )),
                  ]
                }
                return [(
                  <button
                    key={row.id}
                    type="button"
                    className={css.unifiedGap}
                    aria-expanded="false"
                    onClick={() => {
                      setExpandedGaps(current => new Set([...current, row.id]))
                    }}
                  >
                    {labels.showUnchanged(row.lines.length)}
                  </button>
                )]
              })}
            </div>
          </section>
        )
      })}
      {rendered.truncated && !showAllRows && (
        <button type="button" className={css.unifiedGap} onClick={() => { setShowAllRows(true) }}>
          大 diff 已折叠：显示其余 {String(rendered.hiddenRows)} 行
        </button>
      )}
    </div>
  )
}
