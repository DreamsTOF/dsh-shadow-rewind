//#region src/client/path-keys.ts
/**
* 路径键/文本原语叶子模块（无依赖）——供 session-changes / turn-deliverables /
* rewound-changes / review-state 等共享，消除「反斜杠归一 + `./` 折叠 + basename」
* 在多个文件各自复制导致的遮蔽键/合并键不一致。
*/
/** 反斜杠统一成正斜杠（Windows 工具路径 vs 服务端正斜杠是同一文件）。 */
function pathKey(path) {
	return path.replace(/\\/g, "/");
}
/**
* 行合并键：归一斜杠、去 `./` 前缀、绝对路径若落在会话工作区目录下折成相对
* 路径。同一文件在「工具 meta 绝对路径 / fs 端点相对路径 / ./x 拼写」之间
* 摆动时收成一行；目录不同的同名文件不会误并。live 条与审查面板共用。
*/
function canonicalKey(path, cwd) {
	let key = pathKey(path);
	if (key.startsWith("./")) key = key.slice(2);
	if (cwd !== void 0 && cwd !== "") {
		const base = pathKey(cwd).replace(/[\\/]+$/, "");
		if (key === base) return ".";
		if (key.startsWith(`${base}/`)) key = key.slice(base.length + 1);
	}
	return key;
}
/** 路径末段——一眼就能认出文件的那一部分。 */
function basename(path) {
	const at = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
	return at === -1 ? path : path.slice(at + 1);
}
//#endregion
export { basename, canonicalKey, pathKey };
