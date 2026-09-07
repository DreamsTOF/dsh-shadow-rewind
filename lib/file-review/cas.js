//#region src/file-review/cas.ts
/**
* 统一 CAS（比较-交换）规则 —— file-review 内部两条写回路径（hunk 回放 /
* fs 整文件形状）共用的「未被改动」定义与写回原语（H3 归一）。
*
* 统一后的规则：
*  - 比较 = LF 归一后的文本相等。纯行尾漂移不算漂移（CRLF 快照 vs 磁盘
*    行尾风格差异曾让 fs 路径误报冲突）；写回时按文件当前的实际行尾风格
*    还原，行尾差异不会被回滚吞掉。
*  - 写回 = 原子写 + 显式 mode（缺省沿用磁盘现状，绝不回落猜测值）。
*  - 权限位不参与内容 CAS：mode-only 条目自带「内容不动、只翻 mode」的
*    不变量，由 fs 形状路径单独把关（内容漂移即冲突）。
*
* 边界（职责不同，不并入本模块）：引擎 applyRestore 的 planFresh 字节级
* 树哈希复核是「计划新鲜度」——计划与执行之间工作区不得有任何变化，那是
* 恢复安全闸，比条目级 CAS 严格是刻意的。
*/
/** 归一化到 LF：hunk 匹配与内容比较的唯一基准。 */
function normalizeNewlines(text) {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
/** 把归一化文本还原成文件自己的行尾风格（CRLF 文件写回仍是 CRLF）。 */
function restoreNewlines(text, crlf) {
	return crlf ? text.replace(/\n/g, "\r\n") : text;
}
/** 从文件字节判断行尾风格。 */
function crlfStyle(bytes) {
	return Buffer.from(bytes).toString("utf8").includes("\r");
}
/** 统一内容比较：两个文件字节在 LF 归一后是否等价。 */
function contentMatches(currentBytes, expectedBytes) {
	return normalizeNewlines(Buffer.from(currentBytes).toString("utf8")) === normalizeNewlines(Buffer.from(expectedBytes).toString("utf8"));
}
//#endregion
export { contentMatches, crlfStyle, normalizeNewlines, restoreNewlines };
