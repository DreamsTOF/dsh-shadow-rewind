/**
 * Minimal zh/en copy for the file-review sidebar tab. Follows the DSH i18n
 * system: the client apply attaches the locale service (`ctx.locale`,
 * provided by `@deepseek-ai/dsh-client-locale`) through {@link attachLocale},
 * and `t()` resolves the active locale from it. Without an attached service
 * (standalone/test compositions) the browser language is used. Mirrors the
 * dsh-better-sidebar locales pattern.
 */

/** The dictionary namespace this plugin owns in the DSH locale registry. */
export const LOCALE_NS = 'fileReviewTab'

/** The zh dictionary (the key-set source of truth). */
export const zh = {
  tabTitle: '文件审查',
  empty: '本会话暂无文件改动',
  sessionUnavailable: '会话不可用',
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
  deletedHint: '该文件在本轮中被终端命令删除，内容已不存在，无法查看差异或撤销。',
  undoSuccess: '已成功撤销更改',
  redoSuccess: '已成功重新应用更改',
  undoPartial: '部分文件未能撤销',
  redoPartial: '部分文件未能重新应用',
  toggleError: '操作失败',
  openInEditor: '在编辑器中打开',
  open: '打开 {name}',
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
  snapshotDialogTitle: '从快照恢复此轮',
  snapshotDialogWarn: '整树恢复会把工作区全部文件恢复到第 {n} 轮开始之前，影响范围不止下面列出的文件；已记录的块级撤销状态可能随之失效（显示为冲突）。',
  snapshotLoading: '正在检查这一轮开始前的快照…',
  snapshotMissing: '没有找到这一轮开始前的快照：可能当时未启用自动快照、记录已清理，或该轮快照失败/跳过。',
  snapshotTotal: '将恢复 {count} 个文件',
  snapshotNoChanges: '工作区已经是这一轮开始前的状态，无需恢复。',
  snapshotBlocked: '这个项目目录还有别的对话正在运行。恢复文件会影响到它们，因此本次操作已被阻止。',
  snapshotGatedRunning: '另有 {n} 个会话正在运行；其文件写入已被写入闸拒绝，不会影响本次恢复。',
  gateOn: '闸：开',
  gateOff: '闸：关',
  gateUnknown: '闸：—',
  gateTitleOn: '当前为准模式（写入闸开启）：同一工作区只有「当前」会话可写，恢复为整树；点击切换到对称模式（重启后回到配置初值）',
  gateTitleOff: '对称模式（写入闸关闭）：所有会话都可并行写入，恢复时按归属勾选要还原的路径，运行中的会话会阻塞恢复；点击切换到当前为准模式（重启后回到配置初值）',
  gateToggleFailed: '切换写入闸失败',
  modeSymmetricHint: '对称模式：默认只勾选本会话改动的文件；勾选其它文件会把它们一并恢复到该时点。',
  ownerMulti: '双方都改过',
  ownerSession: '会话 {id}',
  ownerUnknown: '来源不明',
  selectAll: '全部选中（整树恢复）',
  snapshotTotalSelected: '将恢复 {count} / {total} 个文件',
  pathsTooLong: '勾选的文件过多，无法构造恢复请求；请减少勾选',
  snapshotStale: '项目文件在检查后又发生了变化。为避免覆盖新修改，请重新检查。',
  snapshotSkipped: '以下文件未纳入快照，恢复不会改动它们：',
  snapshotRetry: '重新检查',
  snapshotApply: '恢复文件',
  snapshotApplying: '正在恢复…',
  snapshotDone: '项目文件已恢复到该轮开始之前；对话保持不变。恢复前的文件已自动备份。',
  snapshotFailed: '快照恢复失败',
  kindAdded: '移除后来新增的文件',
  kindDeleted: '找回文件',
  kindModified: '恢复之前的版本',
  kindModeChanged: '恢复文件权限',
  kindTypeChanged: '恢复之前的文件类型',
  skipTooLarge: '超过大小上限',
  skipUnsupportedType: '文件类型不支持',
  skipReadFailed: '读取失败',
  timeline: '时间线',
  timelineTitle: '修改时间线',
  timelineHint: '这是本会话中改动过这个文件的每一轮；点击行末的 +/− 统计可跳到那一轮的差异。',
  timelineEmpty: '本会话没有这个文件的改动记录',
  timelineNoDiff: '无差异文本',
  viewDiff: '查看第 {n} 轮的差异',
  close: '关闭',
  cancel: '取消',
} as const

/** Union of this namespace's dictionary keys. */
export type CopyKey = keyof typeof zh

/** The en dictionary. */
export const en: Record<CopyKey, string> = {
  tabTitle: 'File Review',
  empty: 'No file changes in this session yet',
  sessionUnavailable: 'Session is unavailable',
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
  deletedHint: 'This file was deleted by a terminal command in this turn; its content is gone, so no diff or undo is available.',
  undoSuccess: 'Changes undone',
  redoSuccess: 'Changes reapplied',
  undoPartial: 'Some files could not be undone',
  redoPartial: 'Some files could not be reapplied',
  toggleError: 'Operation failed',
  openInEditor: 'Open in editor',
  open: 'Open {name}',
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
  snapshotDialogTitle: 'Restore turn from snapshot',
  snapshotDialogWarn: 'A whole-tree restore reverts EVERY file in the workspace to its state before turn {n} — not just the files listed below. Recorded per-hunk undo states may show as conflicts afterwards.',
  snapshotLoading: 'Checking the snapshot taken before this turn…',
  snapshotMissing: 'No snapshot from before this turn was found: automatic checkpoints may have been disabled, pruned, or this turn\'s capture failed or was skipped.',
  snapshotTotal: 'Will restore {count} files',
  snapshotNoChanges: 'The workspace already matches the state before this turn; nothing to restore.',
  snapshotBlocked: 'Another conversation is currently running in this project directory. Restoring would affect it, so this operation is blocked.',
  snapshotGatedRunning: '{n} more session(s) are running; their file writes are denied by the write gate and will not affect this restore.',
  gateOn: 'Gate: on',
  gateOff: 'Gate: off',
  gateUnknown: 'Gate: —',
  gateTitleOn: 'Current-wins mode (write gate on): only the current session may write in a workspace; restores revert the whole tree. Click to switch to symmetric mode (reverts to config on restart)',
  gateTitleOff: 'Symmetric mode (write gate off): sessions write in parallel; restores let you pick paths by attribution, and running sessions block restores. Click to switch to current-wins mode (reverts to config on restart)',
  gateToggleFailed: 'Failed to toggle the write gate',
  modeSymmetricHint: 'Symmetric mode: only files changed by this session are checked by default; ticking other files restores them to this point as well.',
  ownerMulti: 'changed by both',
  ownerSession: 'session {id}',
  ownerUnknown: 'unknown source',
  selectAll: 'Select all (whole-tree restore)',
  snapshotTotalSelected: 'Will restore {count} of {total} files',
  pathsTooLong: 'Too many files selected to build the restore request; deselect some',
  snapshotStale: 'The project files changed after the check. To avoid overwriting newer edits, recheck first.',
  snapshotSkipped: 'These files were not captured in the snapshot; restoring will not touch them:',
  snapshotRetry: 'Recheck',
  snapshotApply: 'Restore files',
  snapshotApplying: 'Restoring…',
  snapshotDone: 'Project files were restored to the state before this turn; the conversation is unchanged. The previous state was backed up automatically.',
  snapshotFailed: 'Snapshot restore failed',
  kindAdded: 'remove files added later',
  kindDeleted: 'recover the deleted file',
  kindModified: 'restore the previous version',
  kindModeChanged: 'restore file permissions',
  kindTypeChanged: 'restore the previous file type',
  skipTooLarge: 'over the size limit',
  skipUnsupportedType: 'unsupported file type',
  skipReadFailed: 'read failed',
  timeline: 'Timeline',
  timelineTitle: 'Change timeline',
  timelineHint: 'Every turn in this session that touched this file; click a row\'s +/− stats to jump to that turn\'s diff.',
  timelineEmpty: 'No changes to this file were recorded in this session',
  timelineNoDiff: 'no diff text',
  viewDiff: 'View the turn {n} diff',
  close: 'Close',
  cancel: 'Cancel',
}

/** The DSH locale service attached by the client apply (absent → browser detection). */
let localeService: { getSnapshot(): { active: string } } | undefined

/** Attach (or detach, with undefined) the DSH locale service. */
export function attachLocale(service: { getSnapshot(): { active: string } } | undefined): void {
  localeService = service
}

/** The active locale id ('zh' | 'en'): the DSH locale service's snapshot when attached. */
function activeLocale(): string {
  return localeService?.getSnapshot().active
    ?? (typeof navigator !== 'undefined' ? navigator.language : '')
    ?? 'en'
}

/** Translate a copy key; `{name}` placeholders interpolate from `params`. */
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
