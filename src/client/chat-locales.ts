/**
 * 聊天面（`file-review` 命名空间）的 zh / en 字典：live 条 + 悬停 diff 浮层。
 *
 * 英文是键集的唯一真相来源：添加文案必须先动 `en`，再补 `zh`——缺键时
 * `t()` 回落到英文，反过来则会裸露键名给用户看。
 */

/** 本插件在 DSH 语言注册表里拥有的字典命名空间。 */
export const NS = 'file-review'

/** 英文字典（键集的唯一真相来源）。 */
export const en = {
  'produced.open': 'Open {name}',
  'produced.dir': 'directory',
  'produced.undoSuccess': 'Changes undone',
  'produced.redoSuccess': 'Changes reapplied',
  'review.copy': 'Copy diff',
  'review.copied': 'Copied',
  'review.showUnchanged': '{count} unchanged lines',
  'review.hideUnchanged': 'Hide {count} unchanged lines',
  'review.hunkN': 'Hunk {n}',
  'review.hunkInclude': 'Include this hunk in undo/reapply',
  'review.stats': '{added} lines added, {removed} lines removed',
  'live.session': '{count} files changed',
  'live.audit': 'Review',
  'live.undoRow': 'Undo this file\'s changes',
  'live.redoRow': 'Reapply this file\'s changes',
  'live.undone': 'undone',
  'live.conflict': 'File was modified after the change; open the review to resolve',
  'live.failed': 'Operation failed',
  'live.unavailable': 'Full content is unavailable for this change',
  'live.deleted': 'deleted',
  'live.ownerMulti': 'changed by both',
  'live.ownerSession': 'session {id}',
  'live.ownerUnknown': 'unknown source',
}

/** 本命名空间全部字典键的联合类型。 */
export type DeliverablesKey = keyof typeof en

/** 简体中文字典（`Record` 约束保证与英文键集一一对应，漏翻即编译报错）。 */
export const zh: Record<DeliverablesKey, string> = {
  'produced.open': '打开 {name}',
  'produced.dir': '目录',
  'produced.undoSuccess': '已成功撤销更改',
  'produced.redoSuccess': '已成功重新应用更改',
  'review.copy': '复制差异',
  'review.copied': '已复制',
  'review.showUnchanged': '显示 {count} 行未更改内容',
  'review.hideUnchanged': '隐藏 {count} 行未更改内容',
  'review.hunkN': '块 {n}',
  'review.hunkInclude': '将此块纳入撤销/重新应用',
  'review.stats': '新增 {added} 行，删除 {removed} 行',
  'live.session': '已更改 {count} 个文件',
  'live.audit': '审查',
  'live.undoRow': '撤销此文件的改动',
  'live.redoRow': '重新应用此文件的改动',
  'live.undone': '已撤销',
  'live.conflict': '改动之后文件又被修改过，请在审查界面确认回滚',
  'live.failed': '操作失败',
  'live.unavailable': '此改动的全文不可得',
  'live.deleted': '已删除',
  'live.ownerMulti': '双方都改过',
  'live.ownerSession': '会话 {id}',
  'live.ownerUnknown': '来源不明',
}