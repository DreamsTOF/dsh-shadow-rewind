/**
 * 把 diff 的一侧切成内容行。
 *
 * 刻意不为结尾的行终止符额外造出一个空行——`'\n'.split('\n')` 会得到
 * `['', '']`，凭空多一行「改动」；行数统计与 hunk 起止都会因此偏一位。
 */
/**
 * 切出 `text` 的内容行（不含结尾换行）。
 * 空串返回空数组而不是 `['']`：没有内容就是没有行。
 */
export declare function diffContentLines(text: string): string[];
