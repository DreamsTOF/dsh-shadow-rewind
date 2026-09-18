import { basename, canonicalKey, pathKey } from "./client/path-keys.js";
//#region src/client/session-changes.ts
/** 绝对路径判定：POSIX 根、盘符根或 UNC 前缀，分隔符无关。 */
function isAbsolutePath(path) {
	return path.startsWith("/") || path.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(path);
}
/** 把（可能相对的）检查点路径按会话工作区目录解析成展示路径。 */
function resolveSessionPath(cwd, path) {
	if (isAbsolutePath(path)) return path;
	const base = cwd ?? "";
	if (base === "") return path;
	const separator = base.includes("\\") ? "\\" : "/";
	return `${base.replace(/[\\/]+$/, "")}${separator}${path}`;
}
/**
* 一条检查点 fs 变更能否被宿主安全回放（形状判定；真值仍由宿主巡检给出）。
* 四种可逆形态只在这里写一遍：目录条目、mode-only 条目、整文件新增/删除、
* 完整可回放的 hunk 序列。
*/
function reversibleOf(file) {
	if (file.dir === true) return true;
	if (file.diffs.length === 1) {
		const only = file.diffs[0];
		if (only !== void 0 && only.path === file.path && only.oldText !== null && only.oldText === only.newText && only.oldMode !== void 0 && only.newMode !== void 0 && only.oldMode !== only.newMode) return true;
	}
	if (file.diffs.length === 1) {
		const only = file.diffs[0];
		if (only !== void 0 && only.path === file.path && (only.oldText === null || only.newText === "" && only.oldText !== "")) return true;
	}
	return file.diffs.length > 0 && file.diffs.every((diff) => diff.path === file.path && diff.oldText !== null && diff.oldText !== diff.newText && (diff.oldText !== "" || diff.oldStart !== void 0) && (diff.newText !== "" || diff.newStart !== void 0));
}
//#endregion
export { basename, canonicalKey, pathKey, resolveSessionPath, reversibleOf };
