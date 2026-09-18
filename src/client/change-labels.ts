/**
 * 恢复预览「快照差异类别 / 跳过原因」标签的 zh 单源（回退弹窗等无 locale
 * 绑定的界面用）；有 locale 的界面（按轮恢复对话框）保留 t() 绑定，但本模块
 * 保证两处文案同义（与 locales 词典的 zh 值逐字一致），避免各自维护漂移。
 */

/** 快照差异类别 → 用户文案（rewind 硬编码旧文本原样收敛于此）。 */
export function kindLabel(kind: string): string {
  switch (kind) {
    case 'added': return '移除后来新增的文件'
    case 'deleted': return '找回文件'
    case 'modified': return '恢复之前的版本'
    case 'mode-changed': return '恢复文件权限'
    case 'type-changed': return '恢复之前的文件类型'
    default: return kind
  }
}

/** 快照跳过原因 → 用户文案。 */
export function skipReasonLabel(reason: string): string {
  switch (reason) {
    case 'too-large': return '超过大小上限'
    case 'unsupported-type': return '文件类型不支持'
    case 'read-failed': return '读取失败'
    default: return reason
  }
}
