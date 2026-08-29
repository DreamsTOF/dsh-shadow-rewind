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
  return entry.kind === 'file'
    ? `f:${entry.blob}:${entry.mode.toString(36)}`
    : `s:${entry.target}:${entry.mode.toString(36)}`
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
