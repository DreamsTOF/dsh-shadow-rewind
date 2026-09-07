//#region src/client/rewound-changes.ts
/** 一个工具条目是否被遮蔽：lastSeq ≤ 屏障且路径被恢复。 */
function isToolEntryRewound(marks, pathKey, lastSeq) {
	return marks.some((mark) => mark.paths?.has(pathKey) === true && lastSeq <= mark.barrier);
}
//#endregion
export { isToolEntryRewound };
