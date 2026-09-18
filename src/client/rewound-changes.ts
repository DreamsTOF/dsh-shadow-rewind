/**
 * 会话恢复记录（restore-records）——回滚遮蔽标记 + 恢复元数据的**单一真相**。
 *
 * 三份审计（live 条 / 审查面板 / 回退弹窗）对「某会话发生过哪些恢复、撤销到
 * 哪一步、磁盘上已被还原的路径」读同一个 store、写同一组动作：
 *  - 写入方：回退弹窗（rewind.ts）、审查面板按轮快照恢复（FileReviewTab）
 *    统一走 {@link commitRestore}（自动带记录 id / 时间 / 检查点 / 模式）；
 *  - 撤销方：任何「撤销本次恢复」统一走 {@link popRewound}（栈式、后进先出，
 *    与宿主引擎的 workspace 级 undo 记录语义对应）；
 *  - 读取方：live 条（过滤被遮蔽条目）、审查面板（收到恢复/撤销广播后刷新
 *    巡检与 fs 清单，避免展示已被恢复的行）等，经 {@link subscribeRewound} 订阅。
 *
 * 遮蔽判别基准（为什么是 seq 屏障）：快照条目只有事件 seq 可与「恢复发生时刻」
 * 比较。恢复成功那一刻取会话快照的**最大节点 seq** 作为屏障——lastSeq ≤ 屏障
 * 且路径被恢复的条目一律遮蔽；屏障之后新产生的条目照常显示。
 *
 * TODO: 天花板——轮中恢复（restore 与编辑交错在同一轮内）无法按条目切分，
 * 按「整条遮蔽」处理；条目级精度需宿主在恢复事件里广播被恢复的 (path, seq)
 * 清单（对应 rewound-changes 的历史 TODO，抽层后仍成立）。
 */

// 路径归一统一走叶子模块 path-keys（历史「本地复制避免模块环」的理由因叶子
// 模块无依赖而不存在）。
import { pathKey as normalizePath } from './path-keys.ts'

/** 一条恢复标记：屏障 seq + 被恢复的路径集合（pathKey；null = 整树恢复）。 */
export interface RewoundMark {
  readonly barrier: number
  readonly paths: ReadonlySet<string> | null
}

/** 带元数据的一次恢复（commitRestore 产出的完整记录；兼容旧 RewoundMark 读法）。 */
export interface RestoreRecord extends RewoundMark {
  /** 会话内恢复记录的自增 id（「撤销最近一次」与弹窗撤销锚定用）。 */
  readonly id: string
  /** 恢复发生的 epoch ms。 */
  readonly at: number
  readonly checkpointId?: string
  /** 恢复模式：'code' | 'both' | 'inplace'（来自引擎/弹窗）。 */
  readonly mode?: string
  /** 恢复所在工作区（预览响应的 workspace/cwd）——恢复是工作区级事实，撤销按
   * workspace 对齐，多会话共享 cwd 时避免 marks 与宿主 undo 槽身份分裂。 */
  readonly workspace?: string
}

/** 会话 → 恢复记录栈（后进先出：「撤销本次恢复」只弹最近一次）。 */
const records = new Map<string, RestoreRecord[]>()

/** 兼容旧读法的窗口：返回与 records 相同对象（调用方只读）。 */
const marksView = records as unknown as Map<string, RewoundMark[]>

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

let recordSeq = 0

// ── 持久化（web 刷新后 live 条仍能遮蔽「已恢复文件」）─────────────────────
// 恢复记录与遮蔽标记此前是纯内存：页面刷新即清空，live 条会把已恢复文件当
// 普通历史重新显示。这里把每会话记录栈序列化进 localStorage，刷新后水合。
const STORAGE_KEY = 'dsh-shadow-rewind:restore-records:v1'
/** 每会话持久化的最大记录数（新记录入栈溢出时丢最旧，只影响遮蔽宽度）。 */
const PERSIST_LIMIT_PER_SESSION = 100

type PersistedRestoreRecord = {
  readonly id: string
  readonly at: number
  readonly barrier: number
  readonly paths: readonly string[] | null
  readonly checkpointId?: string
  readonly mode?: string
  readonly workspace?: string
}

let hydrated = false

function safeStorage(): Storage | undefined {
  try {
    const value = globalThis.localStorage
    if (value === undefined || value === null) return undefined
    return value
  } catch {
    return undefined
  }
}

function persist(): void {
  const storage = safeStorage()
  if (storage === undefined) return
  const payload: Record<string, readonly PersistedRestoreRecord[]> = {}
  for (const [sessionId, list] of records) {
    payload[sessionId] = list.slice(-PERSIST_LIMIT_PER_SESSION).map((record) => ({
      id: record.id,
      at: record.at,
      barrier: record.barrier,
      paths: record.paths === null ? null : [...record.paths],
      ...(record.checkpointId === undefined ? {} : { checkpointId: record.checkpointId }),
      ...(record.mode === undefined ? {} : { mode: record.mode }),
      ...(record.workspace === undefined ? {} : { workspace: record.workspace }),
    }))
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // 配额满 / 隐私模式：持久化失败不影响内存语义。
  }
}

/** 首次写前把已持久化记录水合回内存（幂等；本地无数据/不可用直接跳过）。 */
function hydrate(): void {
  if (hydrated) return
  hydrated = true
  const storage = safeStorage()
  if (storage === undefined) return
  let raw: string | null = null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return
  }
  if (raw === null) return
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
  const source = parsed as Record<string, unknown>
  for (const sessionId of Object.keys(source)) {
    const list = source[sessionId]
    if (!Array.isArray(list)) continue
    const restored: RestoreRecord[] = []
    for (const entry of list) {
      const item = entry as PersistedRestoreRecord
      if (typeof item !== 'object' || item === null) continue
      if (!Number.isFinite(item.barrier)) continue
      restored.push({
        id: typeof item.id === 'string' ? item.id : '',
        at: typeof item.at === 'number' ? item.at : Date.now(),
        barrier: item.barrier,
        paths: Array.isArray(item.paths)
          ? new Set(item.paths.filter((path): path is string => typeof path === 'string'))
          : null,
        ...(typeof item.checkpointId === 'string' ? { checkpointId: item.checkpointId } : {}),
        ...(typeof item.mode === 'string' ? { mode: item.mode } : {}),
        ...(typeof item.workspace === 'string' ? { workspace: item.workspace } : {}),
      })
    }
    if (restored.length > 0) records.set(sessionId, restored)
  }
}

function push(sessionId: string, record: RestoreRecord): RestoreRecord {
  hydrate()
  const list = records.get(sessionId) ?? []
  list.push(record)
  if (list.length > PERSIST_LIMIT_PER_SESSION) list.splice(0, list.length - PERSIST_LIMIT_PER_SESSION)
  records.set(sessionId, list)
  notify()
  persist()
  return record
}

/**
 * 记录一次成功恢复（三面写恢复的统一入口）。
 * @param paths - 被恢复的路径集合（pathKey 归一）；null 表示整树恢复。
 * @param barrier - 恢复成功那一刻会话快照的最大节点 seq；拿不到时传 -1
 *   （等价于「该会话全部已知条目按路径遮蔽」）。
 */
export function commitRestore(options: {
  readonly sessionId: string
  readonly paths: ReadonlySet<string> | null
  readonly barrier: number
  readonly checkpointId?: string
  readonly mode?: string
  readonly workspace?: string
}): RestoreRecord {
  recordSeq += 1
  return push(options.sessionId, {
    id: `r${String(recordSeq)}`,
    at: Date.now(),
    barrier: options.barrier,
    paths: options.paths,
    ...(options.checkpointId === undefined ? {} : { checkpointId: options.checkpointId }),
    ...(options.mode === undefined ? {} : { mode: options.mode }),
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
  })
}

/** 撤销最近一次恢复：弹出栈顶记录，视图还原。返回被弹出的记录（无则 undefined）。 */
export function popRewound(sessionId: string): RestoreRecord | undefined {
  hydrate()
  const list = records.get(sessionId)
  if (list === undefined || list.length === 0) return undefined
  const popped = list.pop()
  if (list.length === 0) records.delete(sessionId)
  notify()
  persist()
  return popped
}

/** 读某会话的全部恢复记录（只读，调用方不得改动）。 */
export function restoreRecordsOf(sessionId: string): readonly RestoreRecord[] {
  hydrate()
  return records.get(sessionId) ?? []
}

/** 读某会话最近一次恢复记录（无则 undefined）。 */
export function lastRestoreOf(sessionId: string): RestoreRecord | undefined {
  hydrate()
  const list = records.get(sessionId)
  return list === undefined || list.length === 0 ? undefined : list[list.length - 1]
}

/** 读某会话的全部恢复标记（旧 API 只读视图，等同 restoreRecordsOf）。 */
export function rewoundMarksOf(sessionId: string): readonly RewoundMark[] {
  hydrate()
  return marksView.get(sessionId) ?? []
}

/** 订阅恢复/撤销变化（live 条 / 审查面板 / 弹窗据此重推导或刷新）。 */
export function subscribeRewound(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 一个 fs 条目是否被遮蔽（唯一谓词）：最早触碰轮的 turn/start seq ≤ 屏障，
 * 且该次恢复覆盖了这条路径（paths === null = 整树恢复 → 全部遮蔽）。
 * barrier < 0（快照不可得的兜底）短路为「按路径无条件命中」。 */
export function isFsTurnRewound(
  marks: readonly RewoundMark[],
  turnStartSeq: number,
  path: string,
): boolean {
  return marks.some(mark =>
    (mark.barrier < 0 || turnStartSeq <= mark.barrier)
    && (mark.paths === null || mark.paths.has(normalizePath(path))))
}

/**
 * 从会话快照取「恢复屏障」：最大节点 seq。恢复成功那一刻调用；快照形态
 * 不可知（宿主版本差异）时返回 -1，等价于「该会话全部已知条目按路径遮蔽」。
 */
export function snapshotBarrierOf(snapshot: unknown): number {
  if (typeof snapshot !== 'object' || snapshot === null) return -1
  const legacy = (snapshot as { readonly legacy?: { readonly nodes?: Iterable<{ readonly seq?: unknown }> } }).legacy
  let max = -1
  for (const node of legacy?.nodes ?? []) {
    if (typeof node?.seq === 'number' && Number.isSafeInteger(node.seq) && node.seq > max) max = node.seq
  }
  return max
}
