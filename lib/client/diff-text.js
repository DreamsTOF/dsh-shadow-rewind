//#region src/client/diff-text.ts
/**
* 把 diff 的一侧切成内容行。
*
* 行数统计与渲染共用本函数（J5 归一）：先做 LF 归一再切行——服务端
* lineCounts 按 LF 归一口径统计，客户端不归一会让 CRLF 文件的徽标行数
* （服务端口径）与悬停浮层数字（本函数口径）对不上。
*
* 刻意不为结尾的行终止符额外造出一个空行——`'\n'.split('\n')` 会得到
* `['', '']`，凭空多一行「改动」；行数统计与 hunk 起止都会因此偏一位。
*/
/** 归一化到 LF（与服务端 lineCounts、宿主 CAS 同一基准）。 */
function normalizeLf(text) {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
/**
* 切出 `text` 的内容行（不含结尾换行）。
* 空串返回空数组而不是 `['']`：没有内容就是没有行。
*/
function diffContentLines(text) {
	const normalized = normalizeLf(text);
	if (normalized === "") return [];
	return (normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized).split("\n");
}
//#endregion
export { diffContentLines };
