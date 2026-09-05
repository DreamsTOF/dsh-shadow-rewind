/**
 * 轨迹重放（Trace Replay）——从会话事件流重放 write / edit / str_replace_editor
 * 的内容参数，把每个工具调用边界当作时间节点做区间 diff。
 *
 * 借鉴 dsh-checkpoint-diff 0.5.0 的轨迹重放（lib/trace/*，Apache-2.0）思路，
 * 按本插件的宿主事实（dsh 0.1.2）重新实现：
 *  - 数据源是统一的 readSession（live 优先、sessionQuery 冷读兜底），不需要
 *    zstd 直读兜底（那是旧宿主时代的 workaround）；
 *  - `tool/call` 的 `arguments` 是原始 JSON 字符串；`tool/result` 没有顶层
 *    isError——错误在 `data.error` 与 `message.content[].isError`；
 *  - 只重放成功的调用；结果缺失（回合进行中）按成功处理并在 notes 计数。
 *
 * 固有盲区（与 checkpoint-diff 相同，诚实标注而非掩盖）：终端命令与外部进程
 * 的写盘不经过工具参数，轨迹不可见——那正是影子快照与终端写盘审计的领地。
 * 快照优先、轨迹兜底，两者并存不互相覆盖。
 *
 * TODO: 天花板——只覆盖会话内首次 write 之后的内容状态；文件在会话开始前
 * 就存在但从未被内容型工具写过时，重放图里没有它的基线，区间 diff 会把它
 * 标成 added。升级路径：用最近的轮起检查点条目补齐基线。
 */
import { diffLines } from 'diff'
import type { TurnIntent } from './types.js'

/** 会话事件的最小结构面（与 rewind-host 的 SessionLogEvent / 本地 SessionEvent
 * 同形；data 收成 object 保证宿主各事件形态都可直接传入，内部再按字段取值）。 */
export interface TraceEvent {
  readonly type: string
  readonly seq: number
  readonly data: object
}

/** 事件 data 的实际消费字段（宽松读取，缺字段按缺失处理）。 */
interface TraceEventData {
  readonly turn?: number
  readonly step?: number
  readonly callId?: string
  readonly name?: string
  readonly arguments?: string
  readonly message?: { readonly content?: readonly unknown[] }
  readonly error?: unknown
}

function eventFields(event: TraceEvent): TraceEventData {
  return event.data as TraceEventData
}

/** 内容型变更工具名单（与宿主内置工具一致）。 */
export const MUTATING_CONTENT_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'str_replace_editor'])

/** 轨迹节点：一个 tool/call 边界（寻址单位 trace:<seq>）。 */
export interface TraceNode {
  readonly seq: number
  readonly turn?: number
  readonly step?: number
  readonly callId?: string
  readonly name: string
  /** 目标路径（可解析出路径时）。 */
  readonly path?: string
  /** 是否内容型变更工具。 */
  readonly mutating: boolean
  /** 对应 tool/result 报告了失败。 */
  readonly error?: boolean
}

/** 一条可重放的内容操作。 */
export interface TraceContentOp {
  readonly seq: number
  readonly callId?: string
  readonly tool: string
  readonly path: string
  readonly kind: 'write' | 'str-replace' | 'insert'
  readonly content?: string
  readonly oldString?: string
  readonly newString?: string
  readonly replaceAll?: boolean
  readonly insertLine?: number
}

/** 区间 diff 的单个文件变更（before/after 为重放态全文）。 */
export interface TraceChange {
  readonly path: string
  readonly kind: 'added' | 'modified' | 'deleted'
  readonly before: string | null
  readonly after: string | null
  readonly added?: number
  readonly removed?: number
}

export interface TraceRangeResult {
  readonly changes: readonly TraceChange[]
  readonly notes: readonly string[]
}

/** 单次区间 diff 的文件数上限（超出截断并记 note；防失控响应）。 */
const MAX_CHANGES = 200
/** 单侧全文进入响应的字节上限（超出则全文置 null，行数仍保留）。 */
const MAX_TEXT_BYTES = 512 * 1024

/** 安全解析 tool/call 的原始 JSON 参数串。 */
export function parseToolArguments(raw: string | undefined): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** 从参数中提取目标路径（工具间字段名不同：write/edit 用 file_path，str_replace_editor 用 path）。 */
export function toolTargetPath(name: string, args: Record<string, unknown> | null): string | null {
  if (args === null) return null
  const key = name === 'str_replace_editor' ? 'path' : 'file_path'
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : null
}

/** tool/result 是否报告失败：顶层 error 或 message.content 首个块的 isError。 */
export function toolResultError(data: object): boolean {
  const fields = data as TraceEventData
  if (fields.error !== undefined && fields.error !== null) return true
  const content = fields.message?.content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block !== null && typeof block === 'object' && (block as { isError?: unknown }).isError === true) return true
    }
  }
  return false
}

/**
 * 采集一个回合窗口 (fromSeq, ∞) 内的内容型工具调用意图（轮末检查点摘要）。
 * 顺序保持 seq 升序；上限 cap 条（防巨型回合撑爆清单）。
 */
/** 时间线 span：会话事件投影为泳道节点（拖选时间线用）。
 * 借鉴 dsh-checkpoint-diff 的 spans 投影（Input/Model/Tools 三泳道）：
 * user→lane 0、assistant→lane 1、tool→lane 2；噪声 chunk 事件天然排除
 * （白名单投影）。 */
export interface TraceSpan {
  readonly seq: number
  readonly kind: 'user' | 'assistant' | 'tool'
  readonly lane: 0 | 1 | 2
  readonly name?: string
  readonly path?: string
  readonly mutating?: boolean
  readonly error?: boolean
}

/** 事件流 → 三泳道 spans（等宽投影的槽位序 = 数组序）。 */
export function traceSpans(events: readonly TraceEvent[]): TraceSpan[] {
  const nodes = traceNodes(events)
  const bySeq = new Map(nodes.map((node) => [node.seq, node]))
  const spans: TraceSpan[] = []
  for (const event of events) {
    if (event.type === 'user/message') {
      spans.push({ seq: event.seq, kind: 'user', lane: 0 })
      continue
    }
    if (event.type === 'assistant/message') {
      spans.push({ seq: event.seq, kind: 'assistant', lane: 1 })
      continue
    }
    const node = bySeq.get(event.seq)
    if (event.type === 'tool/call' && node !== undefined) {
      spans.push({
        seq: event.seq,
        kind: 'tool',
        lane: 2,
        name: node.name,
        ...(node.path === undefined ? {} : { path: node.path }),
        ...(node.mutating ? { mutating: true } : {}),
        ...(node.error === true ? { error: true } : {}),
      })
    }
  }
  return spans
}

/** turn 边界（turn/start 事件 seq 列表）：时间线的刻度线。 */
export function turnBoundaries(events: readonly TraceEvent[]): number[] {
  const seqs: number[] = []
  for (const event of events) {
    if (event.type === 'turn/start' && typeof event.seq === 'number') seqs.push(event.seq)
  }
  return seqs
}

export function collectTurnIntent(events: readonly TraceEvent[], fromSeq: number, cap = 16): TurnIntent[] {
  const intent: TurnIntent[] = []
  for (const event of events) {
    if (event.type !== 'tool/call' || typeof event.seq !== 'number' || event.seq <= fromSeq) continue
    const fields = eventFields(event)
    const name = fields.name
    if (typeof name !== 'string' || !MUTATING_CONTENT_TOOLS.has(name)) continue
    const args = parseToolArguments(fields.arguments)
    // str_replace_editor 的 view 是只读命令，不构成变更意图。
    if (name === 'str_replace_editor') {
      const command = typeof args?.command === 'string' ? args.command : ''
      if (command !== 'create' && command !== 'str_replace' && command !== 'insert') continue
    }
    const path = toolTargetPath(name, args)
    if (path === null) continue
    intent.push({ tool: name, path, seq: event.seq })
    if (intent.length >= cap) break
  }
  return intent
}

/** 全部 tool/call 边界 → 时间线节点（错误标记从配对 result 合并）。 */
export function traceNodes(events: readonly TraceEvent[]): TraceNode[] {
  const failedCalls = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const callId = eventFields(event).callId
    if (typeof callId !== 'string') continue
    if (toolResultError(event.data)) failedCalls.add(callId)
  }
  const nodes: TraceNode[] = []
  for (const event of events) {
    if (event.type !== 'tool/call' || typeof event.seq !== 'number') continue
    const fields = eventFields(event)
    const name = typeof fields.name === 'string' ? fields.name : ''
    if (name === '') continue
    const callId = typeof fields.callId === 'string' ? fields.callId : undefined
    const args = parseToolArguments(fields.arguments)
    const path = toolTargetPath(name, args)
    nodes.push({
      seq: event.seq,
      ...(typeof fields.turn === 'number' ? { turn: fields.turn } : {}),
      ...(typeof fields.step === 'number' ? { step: fields.step } : {}),
      ...(callId === undefined ? {} : { callId }),
      name,
      ...(path === null ? {} : { path }),
      mutating: MUTATING_CONTENT_TOOLS.has(name),
      ...(callId !== undefined && failedCalls.has(callId) ? { error: true } : {}),
    })
  }
  return nodes
}

/** 成功调用的内容操作序列（str_replace_editor 的 view 等只读命令不进队列）。 */
export function contentOps(events: readonly TraceEvent[]): { ops: readonly TraceContentOp[]; notes: readonly string[] } {
  const failedCalls = new Set<string>()
  const seenResults = new Set<string>()
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const callId = eventFields(event).callId
    if (typeof callId !== 'string') continue
    seenResults.add(callId)
    if (toolResultError(event.data)) failedCalls.add(callId)
  }
  const ops: TraceContentOp[] = []
  const notes: string[] = []
  for (const event of events) {
    if (event.type !== 'tool/call' || typeof event.seq !== 'number') continue
    const fields = eventFields(event)
    const callId = typeof fields.callId === 'string' ? fields.callId : undefined
    const args = parseToolArguments(fields.arguments)
    const name = typeof fields.name === 'string' ? fields.name : ''
    if (!MUTATING_CONTENT_TOOLS.has(name)) continue
    const path = toolTargetPath(name, args)
    if (path === null) {
      notes.push(`seq ${String(event.seq)}：${name} 参数无法解析（跳过重放）`)
      continue
    }
    if (callId !== undefined && failedCalls.has(callId)) continue
    if (callId !== undefined && !seenResults.has(callId)) {
      notes.push(`seq ${String(event.seq)}：${name} 结果未返回（进行中，按成功重放）`)
    }
    if (name === 'write') {
      const content = args?.content
      if (typeof content !== 'string') {
        notes.push(`seq ${String(event.seq)}：write 缺少 content（跳过重放）`)
        continue
      }
      ops.push({ seq: event.seq, ...(callId === undefined ? {} : { callId }), tool: name, path, kind: 'write', content })
      continue
    }
    if (name === 'edit') {
      const oldString = args?.old_string
      const newString = args?.new_string
      if (typeof oldString !== 'string' || typeof newString !== 'string') {
        notes.push(`seq ${String(event.seq)}：edit 参数不完整（跳过重放）`)
        continue
      }
      ops.push({
        seq: event.seq, ...(callId === undefined ? {} : { callId }), tool: name, path, kind: 'str-replace',
        oldString, newString, ...(args?.replace_all === true ? { replaceAll: true } : {}),
      })
      continue
    }
    // str_replace_editor：按 command 分派；view 只读不进队列。
    const command = typeof args?.command === 'string' ? args.command : ''
    if (command === 'create') {
      const fileText = args?.file_text
      if (typeof fileText !== 'string') {
        notes.push(`seq ${String(event.seq)}：str_replace_editor create 缺少 file_text（跳过重放）`)
        continue
      }
      ops.push({ seq: event.seq, ...(callId === undefined ? {} : { callId }), tool: name, path, kind: 'write', content: fileText })
      continue
    }
    if (command === 'str_replace') {
      const oldString = args?.old_str
      const newString = args?.new_str
      if (typeof oldString !== 'string' || typeof newString !== 'string') {
        notes.push(`seq ${String(event.seq)}：str_replace_editor str_replace 参数不完整（跳过重放）`)
        continue
      }
      ops.push({
        seq: event.seq, ...(callId === undefined ? {} : { callId }), tool: name, path, kind: 'str-replace',
        oldString, newString, ...(args?.replace_all === true ? { replaceAll: true } : {}),
      })
      continue
    }
    if (command === 'insert') {
      const insertLine = args?.insert_line
      const newString = args?.new_str
      if (typeof insertLine !== 'number' || typeof newString !== 'string') {
        notes.push(`seq ${String(event.seq)}：str_replace_editor insert 参数不完整（跳过重放）`)
        continue
      }
      ops.push({
        seq: event.seq, ...(callId === undefined ? {} : { callId }), tool: name, path, kind: 'insert',
        newString, insertLine,
      })
    }
  }
  return { ops, notes }
}

/** LF 归一：与宿主行数统计同一基准（CRLF 不产生幽灵差异）。 */
function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function countLines(text: string): number {
  if (text === '') return 0
  let count = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count += 1
  return text.endsWith('\n') ? count : count + 1
}

function lineCounts(before: string, after: string): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const part of diffLines(normalizeLf(before), normalizeLf(after))) {
    if (part.added === true) added += part.count ?? 0
    else if (part.removed === true) removed += part.count ?? 0
  }
  return { added, removed }
}

/**
 * 把操作序列重放到 `untilSeqExcl`（不含）为止，返回 (状态图, 漂移 notes)。
 * state 值 null 不存在——删除不进重放（内容型工具不删文件）。
 */
function replayUntil(
  ops: readonly TraceContentOp[],
  untilSeqExcl: number,
  notes: string[],
): Map<string, string> {
  const state = new Map<string, string>()
  for (const op of ops) {
    if (op.seq >= untilSeqExcl) break
    if (op.kind === 'write') {
      state.set(op.path, op.content ?? '')
      continue
    }
    const current = state.get(op.path)
    if (current === undefined) {
      notes.push(`seq ${String(op.seq)}：${op.tool} 目标 ${op.path} 不在重放状态中（会话内未先写入；漂移跳过）`)
      continue
    }
    if (op.kind === 'str-replace') {
      const oldString = op.oldString ?? ''
      if (!current.includes(oldString)) {
        notes.push(`seq ${String(op.seq)}：${op.tool} 的 old_string 在 ${op.path} 中未找到（重放漂移，跳过）`)
        continue
      }
      state.set(op.path, op.replaceAll === true
        ? current.split(oldString).join(op.newString ?? '')
        : current.replace(oldString, op.newString ?? ''))
      continue
    }
    // insert：insert_line 行后插入（0 = 文件开头）。
    const lines = normalizeLf(current).split('\n')
    const at = Math.max(0, Math.min(op.insertLine ?? 0, lines.length))
    const inserted = normalizeLf(op.newString ?? '').replace(/\n$/, '').split('\n')
    lines.splice(at, 0, ...inserted)
    state.set(op.path, lines.join('\n'))
  }
  return state
}

/**
 * 任意两个轨迹节点 (fromSeq, toSeq] 的内容区间 diff（同一 LCS 引擎语义：
 * chronologically from → to，del = 会被带走的行，add = 会出现的行）。
 */
export function traceRangeDiff(events: readonly TraceEvent[], fromSeq: number, toSeq: number): TraceRangeResult {
  const { ops } = contentOps(events)
  // 漂移只记一遍：to 侧重放覆盖 (0, toSeq) 全部操作，from 侧是其前缀子集。
  const beforeState = replayUntil(ops, fromSeq, [])
  const drift: string[] = []
  const afterState = replayUntil(ops, toSeq, drift)
  const paths = [...new Set([...beforeState.keys(), ...afterState.keys()])].sort()
  const changes: TraceChange[] = []
  let truncated = false
  for (const path of paths) {
    if (changes.length >= MAX_CHANGES) {
      truncated = true
      break
    }
    const before = beforeState.get(path) ?? null
    const after = afterState.get(path) ?? null
    if (before === after) continue
    const kind = before === null ? 'added' : after === null ? 'deleted' : 'modified'
    const counts = before === null
      ? { added: countLines(after ?? ''), removed: 0 }
      : after === null
        ? { added: 0, removed: countLines(before) }
        : lineCounts(before, after)
    changes.push({
      path,
      kind,
      // 超限侧全文置 null：行数仍可信，全文不进入响应。
      ...(before !== null && Buffer.byteLength(before, 'utf8') <= MAX_TEXT_BYTES ? { before } : { before: null }),
      ...(after !== null && Buffer.byteLength(after, 'utf8') <= MAX_TEXT_BYTES ? { after } : { after: null }),
      added: counts.added,
      removed: counts.removed,
    })
  }
  const allNotes = [...drift]
  if (truncated) allNotes.push(`变更文件数超过 ${String(MAX_CHANGES)}，仅返回前 ${String(MAX_CHANGES)} 个`)
  allNotes.push('轨迹重放只覆盖会话内的内容型工具（write/edit/str_replace_editor）；终端命令与外部进程的写盘不可见——请用快照检查点对比。')
  return { changes, notes: allNotes }
}
