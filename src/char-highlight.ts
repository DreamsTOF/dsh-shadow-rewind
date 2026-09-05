/**
 * 字符级行内高亮内核 —— 自 dsh-edit-diff（同工作区姊妹项目）的
 * lib/client.js 移植（零依赖手写 Myers，语义保持一致）。
 *
 * 用途：UnifiedDiff 渲染替换行时，对「删/增行数相等的替换对」做行内
 * 字符级 diff，把真正变化的字符区间以下划线/加粗标出——整行红绿之外
 * 的第二层精度，一眼看出一行里到底改了哪几个字符。
 *
 * 防线（原实现没有，这里补上）：单行超过 CHAR_HIGHLIGHT_MAX_CHARS 时
 * 直接放弃高亮（Myers 在字符数组上 O((N+M)·D)，超长压缩行不值得）。
 * TODO: 天花板——同长度替换对才做高亮（与 dsh-edit-diff 同策略）；
 * 若要覆盖不等长替换对，升级路径是逐行做带 gap 的对齐。
 */

/** 单个编辑操作：same（公共）、del（删 a[a]）、add（增 b[b]）。 */
interface CharOp {
  readonly type: 'same' | 'del' | 'add'
  readonly a: number
  readonly b: number
}

/** 行内高亮结果：del/add 两侧的字符区间列表，[start, end) 半开区间。 */
export interface CharHighlight {
  readonly del: readonly (readonly [number, number])[]
  readonly add: readonly (readonly [number, number])[]
}

/** 超过此长度的单行放弃字符高亮（防超长压缩行的 Myers 开销）。 */
export const CHAR_HIGHLIGHT_MAX_CHARS = 2000

/** 行级（此处用于字符数组）Myers 最短编辑脚本。 */
function myersDiff(aList: readonly string[], bList: readonly string[]): CharOp[] {
  const N = aList.length
  const M = bList.length
  const max = N + M
  let prev: Record<number, number> = { 1: 0 }
  const trace: Record<number, number>[] = []
  let dMax = 0
  let found = false
  for (let d = 0; d <= max; d++) {
    trace.push({ ...prev })
    const cur: Record<number, number> = {}
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (prev[k - 1] ?? Number.NEGATIVE_INFINITY) < (prev[k + 1] ?? Number.NEGATIVE_INFINITY))) {
        x = prev[k + 1] ?? 0
      } else {
        x = (prev[k - 1] ?? -1) + 1
      }
      let y = x - k
      while (x < N && y < M && aList[x] === bList[y]) { x++; y++ }
      cur[k] = x
      if (x >= N && y >= M) { dMax = d; found = true; break }
    }
    prev = cur
    if (found) break
  }
  if (!found) {
    // 兜底：全删全加（理论不可达，防御性保留，与原实现一致）。
    const ops: CharOp[] = []
    for (let i = 0; i < N; i++) ops.push({ type: 'del', a: i, b: -1 })
    for (let j = 0; j < M; j++) ops.push({ type: 'add', a: -1, b: j })
    return ops
  }
  const ops: CharOp[] = []
  let x = N
  let y = M
  for (let d = dMax; d > 0; d--) {
    const t = trace[d]!
    const k = x - y
    let prevK: number
    if (k === -d || (k !== d && (t[k - 1] ?? Number.NEGATIVE_INFINITY) < (t[k + 1] ?? Number.NEGATIVE_INFINITY))) {
      prevK = k + 1
    } else {
      prevK = k - 1
    }
    const prevX = t[prevK] ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) { ops.push({ type: 'same', a: x - 1, b: y - 1 }); x--; y-- }
    if (x === prevX) { ops.push({ type: 'add', a: -1, b: y - 1 }); y-- }
    else { ops.push({ type: 'del', a: x - 1, b: -1 }); x-- }
  }
  while (x > 0 && y > 0) { ops.push({ type: 'same', a: x - 1, b: y - 1 }); x--; y-- }
  ops.reverse()
  return ops
}

/** 把字符级 op 的 del/add 下标汇总为连续区间 [start, end)。 */
function charRanges(ops: readonly CharOp[]): CharHighlight {
  const delIdx: number[] = []
  const addIdx: number[] = []
  for (const op of ops) {
    if (op.type === 'del') delIdx.push(op.a)
    else if (op.type === 'add') addIdx.push(op.b)
  }
  const mk = (indexes: number[]): [number, number][] => {
    if (indexes.length === 0) return []
    indexes.sort((a, b) => a - b)
    const out: [number, number][] = []
    let start = indexes[0]!
    let end = indexes[0]!
    for (let i = 1; i < indexes.length; i++) {
      if (indexes[i] === end + 1) {
        end = indexes[i]!
      } else {
        out.push([start, end + 1])
        start = indexes[i]!
        end = indexes[i]!
      }
    }
    out.push([start, end + 1])
    return out
  }
  return { del: mk(delIdx), add: mk(addIdx) }
}

/**
 * 单行替换对的字符级高亮区间：oldStr/newStr 按字符做 Myers，
 * 真正变化的字符段以 [start, end) 区间返回。
 * 任一侧超长、或任一侧为空串时降级：空串侧全区间、超长侧放弃（空区间）。
 */
export function lineHighlight(oldStr: string, newStr: string): CharHighlight {
  if (oldStr === '' && newStr === '') return { del: [], add: [] }
  if (oldStr === '') return { del: [], add: [[0, newStr.length]] }
  if (newStr === '') return { del: [[0, oldStr.length]], add: [] }
  if (oldStr.length > CHAR_HIGHLIGHT_MAX_CHARS || newStr.length > CHAR_HIGHLIGHT_MAX_CHARS) {
    return { del: [], add: [] }
  }
  return charRanges(myersDiff([...oldStr], [...newStr]))
}
