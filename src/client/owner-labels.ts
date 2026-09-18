/**
 * 变更条目「归属徽标」判定的**单一实现**（文案由调用方注入，以各自支持 i18n）。
 *
 * 两处展示（审查面板 fsOwnerBadge / 恢复弹窗的 owner 徽标已随弹窗简化移除）
 * 此前的「target 无徽标、multi/unknown/他会话」分支各写一份，
 * 漂移点在：未知来源的文案、他会话是否尝试解析成会话标题、id 截断规则。这里
 * 收敛成一套逻辑：文案多语言各自传 label，标题解析与 12 字符截断都在这一个
 * 判定里完成，语义不再三处维护。
 */

/** 调用方注入的文案（多语言在此收敛差异）。 */
export interface OwnerTextLabels {
  /** owner === 'multi'（双方都改过）。 */
  readonly multi: string
  /** owner === 'unknown'（来源不明）。 */
  readonly unknown: string
  /** 其它会话 id 的回退文案（无标题可解析时用；截断由调用方在此做）。 */
  readonly other: (id: string) => string
}

/**
 * 归属徽标文本：undefined/'target' → null（无徽标）；'multi'/'unknown' → 对应
 * 文案；其它会话 id → 优先 sessionTitle（可解析时），否则回落 labels.other。
 */
export function ownerBadgeOf(
  owner: string | undefined,
  labels: OwnerTextLabels,
  sessionTitle?: (id: string) => string | undefined,
): string | null {
  if (owner === undefined || owner === 'target') return null
  if (owner === 'multi') return labels.multi
  if (owner === 'unknown') return labels.unknown
  return sessionTitle?.(owner) ?? labels.other(owner)
}
