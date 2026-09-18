/**
 * 文件开关（撤销/重做）·apply 装配与结果分类的**单一实现**。
 *
 * live 条的行内按钮与审查面板的 hunk/文件/轮撤销此前各自内联拼 FileReviewChange
 * （dirKind 判定）、各自扫结果判断成败/冲突；这里收口为三个纯入口，两侧只留
 * 各自的编排（多会话确认、冲突授权弹窗、草稿状态槽）：
 *  - {@link buildFileReviewChange} / {@link buildApplyRequest}：描述符 → 宿主请求；
 *  - {@link applyFileChanges}：执行（经 remote-access 统一解析/自愈/转译）；
 *  - {@link applyOutcome}：成功/失败/冲突分类（供两端提示与授权分流共用）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  FileReviewAction, FileReviewChange, FileReviewFileResult, FileReviewRequest, FileReviewResult,
  ProducedFileDiff,
} from '../file-review/change-types.ts'
import { invokeFileReview } from './remote-access.ts'

/** 待开关的一个文件（两侧已各自完成 diff 裁剪后的最小描述）。 */
export interface ApplyFileDescriptor {
  readonly path: string
  readonly diffs: readonly ProducedFileDiff[]
  /** 条目来源：'fs'（检查点配对，宿主走 fs 语义）；缺省宿主按 diff 形状识别。 */
  readonly origin?: 'fs'
  /** 目录条目（宿主走 mkdir/rmdir 语义）。 */
  readonly dir?: boolean
  /** 恢复语义是删除（工具创建 / fs deleted 行）。 */
  readonly deleted?: boolean
  /** fs 条目的原始 kind（目录 dirKind 用 deleted 判定时参照）。 */
  readonly fsKind?: 'added' | 'modified' | 'deleted'
}

/** 描述符 → FileReviewChange（dirKind 判定唯一实现）。 */
export function buildFileReviewChange(item: ApplyFileDescriptor): FileReviewChange {
  const dirKind = item.dir !== true
    ? undefined
    : (item.deleted === true || item.fsKind === 'deleted' ? 'deleted' : 'added') as 'added' | 'deleted'
  return {
    path: item.path,
    diffs: item.diffs,
    ...(item.origin !== undefined ? { origin: item.origin } : {}),
    ...(dirKind === undefined ? {} : { dirKind }),
  }
}

/** 一批描述符 + 方向 + force → 宿主请求（组装唯一实现）。 */
export function buildApplyRequest(
  items: readonly ApplyFileDescriptor[],
  action: FileReviewAction,
  force?: boolean,
): FileReviewRequest {
  return {
    action,
    files: items.map(buildFileReviewChange),
    ...(force === true ? { force: true } : {}),
  }
}

/** 执行一次 apply（统一经 remote-access：解析会话作用域 + 挂载自愈 + 错误转译）。 */
export async function applyFileChanges(
  ctx: Context,
  sessionId: string,
  request: FileReviewRequest,
): Promise<FileReviewResult> {
  return invokeFileReview(ctx, sessionId, 'apply', request)
}

/** 一次结果的目标态（撤销→undone，重做→applied）。 */
export function targetStateOf(action: FileReviewAction): FileReviewFileStateValue {
  return action === 'undo' ? 'undone' : 'applied'
}

type FileReviewFileStateValue = 'applied' | 'undone'

/** 结果分类：全部达成 / 冲突清单 / 其它失败清单（提示与授权分流共用）。 */
export function applyOutcome(
  result: FileReviewResult,
  action: FileReviewAction,
): { readonly ok: boolean; readonly conflicts: readonly FileReviewFileResult[]; readonly failures: readonly FileReviewFileResult[] } {
  const target = targetStateOf(action)
  const failures = result.files.filter(file => file.state !== target)
  const conflicts = failures.filter(file => file.state === 'conflict')
  return { ok: failures.length === 0, conflicts, failures }
}
