/**
 * 恢复预览「快照差异类别 / 跳过原因」标签的 zh 单源（回退弹窗等无 locale
 * 绑定的界面用）；有 locale 的界面（按轮恢复对话框）保留 t() 绑定，但本模块
 * 保证两处文案同义（与 locales 词典的 zh 值逐字一致），避免各自维护漂移。
 */
/** 快照差异类别 → 用户文案（rewind 硬编码旧文本原样收敛于此）。 */
export declare function kindLabel(kind: string): string;
/** 快照跳过原因 → 用户文案。 */
export declare function skipReasonLabel(reason: string): string;
