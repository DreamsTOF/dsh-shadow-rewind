/**
 * 字符级行内高亮内核 —— 自 dsh-edit-diff（同工作区姊妹项目）的
 * lib/client.js 移植（零依赖手写 Myers，语义保持一致）。
 *
 * 用途：UnifiedDiff 渲染替换行时，对「删/增行数相等的替换对」做行内
 * 字符级 diff，把真正变化的字符区间以下划线/加粗标出——整行红绿之外
 * 的第二层精度，一眼看出一行里到底改了哪几个字符。
 *
 * 防线（原实现没有，这里补上）：单行超过 CHAR_HIGHLIGHT_MAX_CHARS 时
 * 直接放弃高亮（Myers 在字符数组上 O((N+M)·D)，超长压缩行不值得）。
 * TODO: 天花板——同长度替换对才做高亮（与 dsh-edit-diff 同策略）；
 * 若要覆盖不等长替换对，升级路径是逐行做带 gap 的对齐。
 */
/** 行内高亮结果：del/add 两侧的字符区间列表，[start, end) 半开区间。 */
export interface CharHighlight {
    readonly del: readonly (readonly [number, number])[];
    readonly add: readonly (readonly [number, number])[];
}
/** 超过此长度的单行放弃字符高亮（防超长压缩行的 Myers 开销）。 */
export declare const CHAR_HIGHLIGHT_MAX_CHARS = 2000;
/**
 * 单行替换对的字符级高亮区间：oldStr/newStr 按字符做 Myers，
 * 真正变化的字符段以 [start, end) 区间返回。
 * 任一侧超长、或任一侧为空串时降级：空串侧全区间、超长侧放弃（空区间）。
 */
export declare function lineHighlight(oldStr: string, newStr: string): CharHighlight;
