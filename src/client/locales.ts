/**
 * 文件审查面（侧边栏/审计抽屉）的最小 zh / en 文案层。
 *
 * 走 DSH 的 i18n 体系：客户端 apply 通过 `attachLocale` 挂上语言服务
 * （`ctx.locale`，由 `@deepseek-ai/dsh-client-locale` 提供），`t()` 从它
 * 读取当前语言；没有挂载服务时（独立 / 测试装配）退回浏览器语言。整体沿用
 * dsh-better-sidebar 的 locales 模式。
 *
 * 与聊天面（`chat-locales.ts`）的键集来源相反：这一份以 `zh` 为真相来源。
 */

/** 本插件在 DSH 语言注册表里拥有的字典命名空间。 */
export const LOCALE_NS = 'fileReviewTab'

/** 中文字典（键集的唯一真相来源）。 */
export const zh = {
  tabTitle: '文件审查',
  empty: '本会话暂无文件改动',
  remoteUnavailable: '文件审查服务不可用',
  turn: '第 {n} 轮',
  turnLive: '进行中',
  files: '{count} 个文件',
  filesOne: '1 个文件',
  undo: '撤销',
  redo: '重新应用',
  undoing: '正在撤销…',
  redoing: '正在重新应用…',
  undoTurn: '撤销本轮',
  redoTurn: '重新应用本轮',
  toggleUnavailable: '没有可安全还原的文件',
  stateUndone: '已撤销',
  stateConflict: '内容冲突',
  stateUnsupported: '不可还原',
  stateError: '错误',
  deleted: '已删除',
  deletedHint: '该文件已被删除，内容已不存在，无法查看差异或撤销。',
  dirBadge: '目录',
  dirHint: '这是一个空目录的增删记录，没有文件内容可展示；撤销/重新应用将重建或移除该目录。',
  undoSuccess: '已成功撤销更改',
  redoSuccess: '已成功重新应用更改',
  undoPartial: '部分文件未能撤销',
  redoPartial: '部分文件未能重新应用',
  conflictTitle: '部分文件无法正常回滚',
  conflictHint: '以下文件在本次变更之后又被修改过（可能与你的手动修改有关）。「全部回滚」会覆盖这些修改；「只回滚正常部分」会跳过它们，之后可对剩余文件再次操作。',
  conflictAbort: '拒绝',
  conflictForce: '全部回滚',
  conflictPartial: '只回滚正常部分',
  toggleError: '操作失败',
  openInEditor: '在编辑器中打开',
  copy: '复制差异',
  copied: '已复制',
  showUnchanged: '显示 {count} 行未更改内容',
  hideUnchanged: '隐藏 {count} 行未更改内容',
  stats: '新增 {added} 行，删除 {removed} 行',
  unavailable: '无法为此更改还原可审查的差异。',
  refresh: '刷新状态',
  hunkN: '块 {n}',
  hunkInclude: '勾选：参与下一次撤销/重新应用；取消勾选：保留该块不动',
  hunkNoneSelected: '未选中任何改动块',
  snapshotRestore: '快照恢复',
  snapshotRestoreTitle: '把整个工作区恢复到这一轮开始之前（jj 影子快照）',
  ownerMulti: '双方都改过',
  ownerSession: '会话 {id}',
  ownerUnknown: '来源不明',
  turnOtherSessions: '含其它会话写入 {count}',
  timeline: '时间线',
  timelineTitle: '修改时间线',
  timelineHint: '这是本会话中改动过这个文件的每一轮；点击行末的 +/− 统计可跳到那一轮的差异。',
  timelineEmpty: '本会话没有这个文件的改动记录',
  timelineNoDiff: '无差异文本',
  viewDiff: '查看第 {n} 轮的差异',
  close: '关闭',
} as const

/** 本命名空间全部字典键的联合类型。 */
export type CopyKey = keyof typeof zh

/** 英文字典（`Record` 约束保证与中文键集一一对应，漏翻即编译报错）。 */
export const en: Record<CopyKey, string> = {
  tabTitle: 'File Review',
  empty: 'No file changes in this session yet',
  remoteUnavailable: 'File review service is unavailable',
  turn: 'Turn {n}',
  turnLive: 'in progress',
  files: '{count} files',
  filesOne: '1 file',
  undo: 'Undo',
  redo: 'Reapply',
  undoing: 'Undoing…',
  redoing: 'Reapplying…',
  undoTurn: 'Undo turn',
  redoTurn: 'Reapply turn',
  toggleUnavailable: 'No safely reversible files are available',
  stateUndone: 'undone',
  stateConflict: 'conflict',
  stateUnsupported: 'not reversible',
  stateError: 'error',
  deleted: 'deleted',
  deletedHint: 'This file has been deleted; its content is gone, so no diff or undo is available.',
  dirBadge: 'directory',
  dirHint: 'This is an empty-directory addition/removal record; there is no file content to show. Undo/reapply recreates or removes the directory.',
  undoSuccess: 'Changes undone',
  redoSuccess: 'Changes reapplied',
  undoPartial: 'Some files could not be undone',
  redoPartial: 'Some files could not be reapplied',
  conflictTitle: 'Some files cannot be restored cleanly',
  conflictHint: 'These files were modified after the recorded change (possibly by you). "Overwrite all" rolls them back anyway, losing those edits; "Clean files only" skips them so you can confirm them again later.',
  conflictAbort: 'Abort',
  conflictForce: 'Overwrite all',
  conflictPartial: 'Clean files only',
  toggleError: 'Operation failed',
  openInEditor: 'Open in editor',
  copy: 'Copy diff',
  copied: 'Copied',
  showUnchanged: '{count} unchanged lines',
  hideUnchanged: 'Hide {count} unchanged lines',
  stats: '{added} lines added, {removed} lines removed',
  unavailable: 'No reconstructable diff is available for this change.',
  refresh: 'Refresh status',
  hunkN: 'Hunk {n}',
  hunkInclude: 'Checked: included in the next undo/reapply; unchecked: this hunk is kept as-is',
  hunkNoneSelected: 'No hunks selected',
  snapshotRestore: 'Snapshot restore',
  snapshotRestoreTitle: 'Restore the whole workspace to before this turn ran (jj shadow snapshot)',
  ownerMulti: 'changed by both',
  ownerSession: 'session {id}',
  ownerUnknown: 'unknown source',
  turnOtherSessions: '{count} writes from other sessions',
  timeline: 'Timeline',
  timelineTitle: 'Change timeline',
  timelineHint: 'Every turn in this session that touched this file; click a row\'s +/− stats to jump to that turn\'s diff.',
  timelineEmpty: 'No changes to this file were recorded in this session',
  timelineNoDiff: 'no diff text',
  viewDiff: 'View the turn {n} diff',
  close: 'Close',
}

/** 客户端 apply 挂进来的 DSH 语言服务（缺席时退回浏览器语言探测）。 */
let localeService: { getSnapshot(): { active: string } } | undefined

/** 挂上（传 undefined 即摘下）DSH 语言服务。 */
export function attachLocale(service: { getSnapshot(): { active: string } } | undefined): void {
  localeService = service
}

/** 当前语言 id（'zh' | 'en'）：优先取语言服务快照，缺席时退回浏览器语言。 */
function activeLocale(): string {
  return localeService?.getSnapshot().active
    ?? (typeof navigator !== 'undefined' ? navigator.language : '')
    ?? 'en'
}

/** 翻译一个文案键；`{name}` 占位符由 `params` 插值填充。 */
export function t(key: CopyKey, params?: Record<string, string | number>): string {
  const dict = activeLocale().toLowerCase().startsWith('zh') ? zh : en
  let text: string = dict[key]
  if (params !== undefined) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value))
    }
  }
  return text
}