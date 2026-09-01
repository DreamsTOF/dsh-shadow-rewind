/**
 * 对称模式的路径归因（纯函数）：把「目标检查点 vs 当前树」的每条变更归属
 * 到一段检查点窗口。检查点在回合开始时捕获，因此窗口 [S_j, S_{j+1}) 的
 * 写者就是 S_j 的会话——S0 是目标检查点本身（目标会话），S_j(j≥1) 是其后
 * 按时间升序的快照，最后一个窗口延伸到当前树。
 *
 * 归因只是预览里的建议标签：勾选权在用户，标签错了最多误导、不破坏数据
 * （组合 B 的安全性质）。同一窗口写者的裁决全部机器可查，无需工具可见性。
 */
import type { SnapshotEntry, WorkspaceChange } from './types.js'

export type PathOwner =
  | { readonly kind: 'target' }
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'multi' }
  | { readonly kind: 'unknown' }

export interface PathAttribution {
  readonly owner: PathOwner
  /** 对称模式勾选清单的默认值：只属于目标会话的路径。 */
  readonly autoSelect: boolean
}

/** 快照条目的稳定比较键（内容 blob + 类型 + 权限位）；null = 路径不存在。 */
function entryKey(entry: SnapshotEntry | null): string {
  if (entry === null) return '-'
  if (entry.kind === 'file') return `f:${entry.blob}:${entry.mode.toString(36)}`
  if (entry.kind === 'dir') return `d:${entry.mode.toString(36)}`
  return `s:${entry.target}:${entry.mode.toString(36)}`
}

export function attributePaths(options: {
  readonly targetSessionId: string | undefined
  readonly changes: readonly WorkspaceChange[]
  readonly snapshots: readonly {
    readonly sessionId?: string
    readonly entries: Readonly<Record<string, SnapshotEntry | null>>
  }[]
}): Map<string, PathAttribution> {
  const result = new Map<string, PathAttribution>()
  for (const change of options.changes) {
    // 状态序列 S0..S(k+1)：目标清单 → 各快照 → 当前树。
    const states: (SnapshotEntry | null)[] = [change.before ?? null]
    for (const snapshot of options.snapshots) {
      states.push(snapshot.entries[change.path] ?? null)
    }
    states.push(change.after ?? null)
    const owners = new Set<string>()
    for (let j = 0; j + 1 < states.length; j += 1) {
      if (entryKey(states[j] ?? null) === entryKey(states[j + 1] ?? null)) continue
      const owner = j === 0 ? options.targetSessionId : options.snapshots[j - 1]?.sessionId
      owners.add(owner ?? 'unknown')
    }
    const others = [...owners].filter((id) => id !== options.targetSessionId)
    const singleOther = others[0]
    let attribution: PathAttribution
    if (owners.size === 0) {
      // 理论不可达（变更蕴含至少一个边界不同）；保守标未知。
      attribution = { owner: { kind: 'unknown' }, autoSelect: false }
    } else if (others.length === 0) {
      attribution = { owner: { kind: 'target' }, autoSelect: true }
    } else if (owners.size === 1 && singleOther !== undefined && singleOther !== 'unknown') {
      attribution = { owner: { kind: 'session', sessionId: singleOther }, autoSelect: false }
    } else if (owners.size === 1) {
      attribution = { owner: { kind: 'unknown' }, autoSelect: false }
    } else {
      attribution = { owner: { kind: 'multi' }, autoSelect: false }
    }
    result.set(change.path, attribution)
  }
  return result
}

/** HTTP 序列化：'target' | 'multi' | 'unknown' | 具体会话 id。 */
export function serializeOwner(owner: PathOwner): string {
  switch (owner.kind) {
    case 'target': return 'target'
    case 'session': return owner.sessionId
    case 'multi': return 'multi'
    default: return 'unknown'
  }
}

// ── 终端写盘归因（闸关多会话并发）──────────────────────────────────────────
// 工具写有权威归因（调用记录）；终端写用「文件 mtime（=当前内容的写入时间，
// 已随快照落盘）× 命令执行窗口」关联归因；外部编辑器是声明的盲区。归因对象
// 是净值状态：被覆盖的写无效果、无需归因。

/** 终端写归因置信级：
 *  - `command`   —— mtime 恰落 1 条本会话命令窗口（命令级）；
 *  - `ambiguous` —— 多条窗口重叠无法定位，或双方改动无法区分（宁模糊不错）；
 *  - `external`  —— 无命令窗口命中、窗口归属回本会话（外部写入，声明的盲区）；
 *  - `window`    —— 窗口归属到其它会话（无命令信息）；
 *  - `unknown`   —— 无法归属。 */
export type FsAttributionKind = 'command' | 'ambiguous' | 'external' | 'window' | 'unknown'

/** 关联到的命令窗口（序列化进 fs-changes 响应）。 */
export interface FsCommandRef {
  readonly tool: string
  readonly callId?: string
  readonly sessionId: string
  /** 窗口内容（工具参数的截断序列化，如终端命令文本）；可能不存在。 */
  readonly detail?: string
  readonly startedAt: number
  readonly endedAt: number
}

/** 一条文件系统变更的完整归因（闸关时随响应透出）。 */
export interface FsAttribution {
  /** serializeOwner 形态：'target' | 'multi' | 'unknown' | <sessionId>。 */
  readonly owner: string
  /** 回滚勾选清单默认值：仅归属本会话为 true。 */
  readonly autoSelect: boolean
  readonly attribution: FsAttributionKind
  readonly command?: FsCommandRef
  /** 当前内容的写入时间（ms epoch，来自快照条目的 mtimeNs）。 */
  readonly writtenAt?: number
}

/** 十进制纳秒字符串 → ms epoch（整除截断；数值远低于 2^53，精度无损）。 */
function mtimeNsToMs(mtimeNs: string): number {
  return Number(BigInt(mtimeNs) / 1000000n)
}

/**
 * 终端写盘归因（纯函数 + 一次注册表查询）：在窗口归属（attributePaths 的
 * ownership）之上，用「文件 mtime ∈ 命令窗口 [startedAt, endedAt]」关联到
 * 具体命令。仅恰 1 条窗口覆盖才给命令级置信——宁模糊不错。
 * 包围轮盲区：完全包住本窗口的其它会话轮在快照网格里没有证据，其写入
 * 会被窗口归属误判为本会话；此时净值内容的 mtime 若落在其它会话的命令
 * 窗口，即为明确的他写者证据——降级 `multi` 交出勾选权（绝不以本会话
 * 名义默认勾选，见函数体注释）。
 *
 * @param windowStartMs/windowEndMs - 轮配对窗口 [current.createdAt, pairEnd.createdAt]，
 * 只做窗口查询剪枝；匹配本身以 mtime 为准（长命令跨轮不漏配）。
 */
export async function attributeFsChanges(options: {
  readonly targetSessionId: string | undefined
  readonly cwd: string
  readonly changes: readonly WorkspaceChange[]
  readonly ownership: ReadonlyMap<string, PathAttribution>
  readonly windowStartMs: number
  readonly windowEndMs: number
  readonly commandWindows?: {
    windowsOverlapping(cwd: string, startMs: number, endMs: number): Promise<readonly {
      readonly sessionId: string
      readonly tool: string
      readonly callId?: string
      readonly detail?: string
      readonly startedAt: number
      readonly endedAt: number
    }[]>
  }
}): Promise<Map<string, FsAttribution>> {
  const windows = options.commandWindows === undefined
    ? []
    : await options.commandWindows.windowsOverlapping(options.cwd, options.windowStartMs, options.windowEndMs)
  const result = new Map<string, FsAttribution>()
  for (const change of options.changes) {
    const pathAttribution = options.ownership.get(change.path)
    const owner = serializeOwner(pathAttribution?.owner ?? { kind: 'unknown' })
    const autoSelect = pathAttribution?.autoSelect ?? false
    // 「何时」= 净值状态（after 侧）的写入时间；删除条目的净值即消失本身，
    // 退而用 before 侧（被删内容的写入时间）兜底展示。
    const entry = change.after ?? change.before
    const mtimeNs = entry?.kind === 'file' ? entry.mtimeNs : undefined
    const writtenAt = mtimeNs === undefined ? undefined : mtimeNsToMs(mtimeNs)
    const tail = writtenAt === undefined ? {} : { writtenAt }
    const covering = writtenAt === undefined
      ? []
      : windows.filter((window) => window.startedAt <= writtenAt && writtenAt <= window.endedAt)
    const only = covering.length === 1 ? covering[0] : undefined
    if (only !== undefined && only.sessionId === options.targetSessionId) {
      result.set(change.path, {
        owner,
        autoSelect,
        attribution: 'command',
        command: {
          tool: only.tool,
          ...(only.callId === undefined ? {} : { callId: only.callId }),
          ...(only.detail === undefined ? {} : { detail: only.detail }),
          sessionId: only.sessionId,
          startedAt: only.startedAt,
          endedAt: only.endedAt,
        },
        ...tail,
      })
      continue
    }
    // 终值证据与窗口归属冲突（包围轮盲区）：完全包住本窗口的其它会话轮
    // 在本窗口内没有检查点，快照网格会把它的写入误判为本会话；此时净值
    // 内容的 mtime 落在其它会话的命令窗口里就是明确的他写者证据——
    // 降级为 multi、交出勾选权（宁模糊不错：同窗口内的外部写入无法排除，
    // 不给单一会话归属；绝不以本会话名义默认勾选）。
    if (owner === 'target' && covering.some((window) => window.sessionId !== options.targetSessionId)) {
      result.set(change.path, { owner: 'multi', autoSelect: false, attribution: 'ambiguous', ...tail })
      continue
    }
    if (covering.length > 1) {
      result.set(change.path, { owner, autoSelect, attribution: 'ambiguous', ...tail })
      continue
    }
    // 无 mtime / 无窗口命中：落回窗口归属语义。
    const kind: FsAttributionKind = owner === 'target' ? 'external'
      : owner === 'multi' ? 'ambiguous'
      : owner === 'unknown' ? 'unknown'
      : 'window'
    result.set(change.path, { owner, autoSelect, attribution: kind, ...tail })
  }
  return result
}
