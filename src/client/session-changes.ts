/**
 * 会话变更的**共享形状与可逆判定**（单一实现）。
 *
 * 变更事实的唯一来源是宿主的检查点 diff（`/shadow-rewind/fs-changes`）：
 * 逐轮清单供审查面板、累计净变化清单供 live 条。本模块只保留两侧共用的
 * 类型、路径原语与「这条 fs 变更能否被宿主安全回放」的判定，不再有任何
 * 客户端推导（工具 hunks / 录制合并 / 跨轮合流均已退役）。
 */
import type { ProducedFileDiff } from '../file-review/change-types.ts'
// 路径/文本原语统一来自叶子模块（本文件保留同名导出，历史导入面不变）。
import { basename, canonicalKey, pathKey } from './path-keys.ts'
export { basename, canonicalKey, pathKey }

/** 窗口归属字段（检查点网格推导，**信息徽标**：不影响任何默认行为）。 */
export interface FsAttributionFields {
  /** 'target' = 本会话，'multi' = 多会话，'unknown' = 不可知，其它 = 会话 id。 */
  readonly owner?: string
}

/** 一个文件在某一轮/某一净变化里的变更条目。 */
export interface SessionFileChange extends FsAttributionFields {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  /** fs 删除条目（检查点对比 kind='deleted'）：展示为全红，撤销=写回旧内容。 */
  readonly deleted?: true
  /** 条目来源：'fs' = 检查点对比派生（恒为 'fs'；字段保留以兼容旧调用面）。 */
  readonly origin?: 'fs'
  /** 空目录条目（撤销语义是 mkdir/rmdir，不涉内容）。 */
  readonly dir?: true
  /** 服务端预算的净行数（全文未补齐时的显示用；缺省按 diffs 汇总）。 */
  readonly counts?: { readonly added: number; readonly removed: number }
  /** 服务端预算的净行数（累计条目直出形态）。 */
  readonly added?: number
  readonly removed?: number
}

/** 一轮的产出文件，按首次出现顺序。 */
export interface TurnFileChanges {
  readonly turn: number
  /** 所属轮是否仍在运行（它的变更集还可能增长）。 */
  readonly live: boolean
  readonly files: readonly SessionFileChange[]
}

/** 绝对路径判定：POSIX 根、盘符根或 UNC 前缀，分隔符无关。 */
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[A-Za-z]:[\\/]/.test(path)
}

/** 把（可能相对的）检查点路径按会话工作区目录解析成展示路径。 */
export function resolveSessionPath(cwd: string | undefined, path: string): string {
  if (isAbsolutePath(path)) return path
  const base = cwd ?? ''
  if (base === '') return path
  const separator = base.includes('\\') ? '\\' : '/'
  return `${base.replace(/[\\/]+$/, '')}${separator}${path}`
}

/**
 * 一条检查点 fs 变更能否被宿主安全回放（形状判定；真值仍由宿主巡检给出）。
 * 四种可逆形态只在这里写一遍：目录条目、mode-only 条目、整文件新增/删除、
 * 完整可回放的 hunk 序列。
 */
export function reversibleOf(file: {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  readonly origin?: 'fs'
  readonly dir?: boolean
}): boolean {
  // 目录条目天生可逆（mkdir/rmdir 互逆），占位形态即可判定。
  if (file.dir === true) return true
  // mode-only fs 条目：内容两侧相同、权限位不同——开关动作是一次裸 chmod。
  if (file.diffs.length === 1) {
    const only = file.diffs[0]
    if (only !== undefined && only.path === file.path
      && only.oldText !== null && only.oldText === only.newText
      && only.oldMode !== undefined && only.newMode !== undefined
      && only.oldMode !== only.newMode) {
      return true
    }
  }
  // fs 整文件形状：单条 diff，要么新增（无旧侧），要么删除（新侧为空）。
  if (file.diffs.length === 1) {
    const only = file.diffs[0]
    if (only !== undefined && only.path === file.path
      && (only.oldText === null || (only.newText === '' && only.oldText !== ''))) {
      return true
    }
  }
  // 通用：hunks 完整可逆（宿主按行锚点回放）。
  return file.diffs.length > 0 && file.diffs.every(diff =>
    diff.path === file.path
    && diff.oldText !== null
    && diff.oldText !== diff.newText
    && (diff.oldText !== '' || diff.oldStart !== undefined)
    && (diff.newText !== '' || diff.newStart !== undefined))
}