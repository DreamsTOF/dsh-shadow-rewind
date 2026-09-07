//#region src/host/diagnostics.ts
const ENV_PATTERNS = [
	["jj", [
		/spawn \S*jj\b.*enoent/i,
		/command not found/i,
		/not recognized/i
	]],
	["space", [
		/no space left on device/i,
		/disk quota exceeded/i,
		/enospc/i
	]],
	["permission", [
		/permission denied/i,
		/operation not permitted/i,
		/access is denied/i
	]],
	["lock", [
		/database is locked/i,
		/database is busy/i,
		/unable to create .*\.lock/i,
		/could not lock/i
	]],
	["mkdir", [/cannot create directory/i, /EEXIST: file already exists, mkdir/i]]
];
const ENV_HINTS = {
	jj: "未检测到 jj CLI：请安装或升级 jj，自动检查点将自动恢复（期间已降级为 SQLite 存储）",
	space: "磁盘空间已满，快照写入失败：清理磁盘空间后自动恢复",
	permission: "快照存储目录无写入权限：请检查目录权限后重试",
	lock: "疑似多个 DSH 实例并发使用同一快照库：请确认只启动了一个 DSH 实例后重试",
	mkdir: "快照存储目录被同名文件占用：处理后自动恢复"
};
function classifyEnvError(text) {
	const s = String(text ?? "");
	for (const [kind, patterns] of ENV_PATTERNS) for (const pattern of patterns) if (pattern.test(s)) return kind;
	return null;
}
//#endregion
export { ENV_HINTS, classifyEnvError };
