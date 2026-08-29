import { ShadowRewindError } from "./errors.js";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, rmdir, stat, symlink, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
//#region src/path-utils.ts
/** 路径与文件系统的底层工具：规范化、 containment 校验、原子替换与目录 fsync。 */
/** `candidate` 是否等于或位于 `root` 之下（两者都应是规范绝对路径）。 */
function isWithin(root, candidate) {
	const rel = relative(root, candidate);
	return rel === "" || !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
}
/**
* 校验并规范化一个工作区相对路径（纯字符串检查，不碰文件系统）。
* 绝对路径、`.`/`..`/空段、NUL、Windows 反斜杠一律拒绝——持久化的每一条
* 路径都必须先过这道闸，防止畸形数据在恢复时被 normalize 成合法路径逃逸。
*/
function validateRelativePath(path) {
	if (path === "" || path.includes("\0")) throw new ShadowRewindError("INVALID_PATH", "快照路径必须非空且不含 NUL");
	if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) throw new ShadowRewindError("INVALID_PATH", `路径逃逸出工作区：${JSON.stringify(path)}`);
	if (sep === "\\" && path.includes("\\")) throw new ShadowRewindError("INVALID_PATH", `路径必须使用正斜杠：${JSON.stringify(path)}`);
	if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) throw new ShadowRewindError("INVALID_PATH", `路径不是规范形式：${JSON.stringify(path)}`);
	return path;
}
/** 把已校验的相对路径解析到 `root` 之下；再次断言 containment。 */
function resolveWorkspacePath(root, path) {
	const normalized = validateRelativePath(path);
	const target = resolve(root, ...normalized.split("/"));
	if (!isWithin(root, target)) throw new ShadowRewindError("INVALID_PATH", `路径逃逸出工作区：${JSON.stringify(path)}`);
	return target;
}
/** 把已存在的目录 realpath 规范化；非目录或不存在则报错。 */
async function canonicalDirectory(path) {
	let canonical;
	try {
		canonical = await realpath(path);
	} catch (error) {
		throw new ShadowRewindError("WORKSPACE_NOT_FOUND", `无法解析目录 ${JSON.stringify(path)}`, { cause: error });
	}
	if (!(await stat(canonical)).isDirectory()) throw new ShadowRewindError("WORKSPACE_NOT_DIRECTORY", `${JSON.stringify(path)} 不是目录`);
	return canonical;
}
/** 原子写 JSON（临时文件 + rename），目录权限 0700、文件 0600。 */
async function writeJsonAtomic(path, value) {
	await mkdir(dirname(path), {
		recursive: true,
		mode: 448
	});
	const temporary = join(dirname(path), `.${randomUUID()}.tmp`);
	const body = `${JSON.stringify(value, null, 2)}\n`;
	try {
		const handle = await open(temporary, "wx", 384);
		try {
			await handle.writeFile(body, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await renameReplacing(temporary, path);
		await syncDirectory(dirname(path));
	} finally {
		await rm(temporary, { force: true });
	}
}
/** 读取并解析一个 JSON 文件。 */
async function readJson(path) {
	let body;
	try {
		body = await readFile(path, "utf8");
	} catch (error) {
		throw new ShadowRewindError("STATE_READ_FAILED", `无法读取 ${JSON.stringify(path)}`, { cause: error });
	}
	try {
		return JSON.parse(body);
	} catch (error) {
		throw new ShadowRewindError("STATE_CORRUPT", `${JSON.stringify(path)} 中的 JSON 无效`, { cause: error });
	}
}
/** 路径是否存在（不跟随末级符号链接）。 */
async function pathExists(path) {
	try {
		await lstat(path);
		return true;
	} catch (error) {
		if (isNodeError(error, "ENOENT")) return false;
		throw error;
	}
}
/**
* 确保目标的每一段已存在父目录都是真实目录、绝无符号链接。
* 恢复路径的父链若被符号链接劫持，写回就会逃逸出工作区——这是安全硬闸。
*/
async function ensureSafeParents(root, target) {
	await walkSafeParents(root, target, true);
}
/** 校验已有父目录（不创建缺失目录），apply 前的计划复核用。 */
async function assertSafeParents(root, target) {
	await walkSafeParents(root, target, false);
}
async function walkSafeParents(root, target, createMissing) {
	if (!isWithin(root, target) || target === root) throw new ShadowRewindError("UNSAFE_TARGET", `恢复目标在工作区之外：${JSON.stringify(target)}`);
	const rel = relative(root, dirname(target));
	let current = root;
	if (rel === "") return;
	for (const segment of rel.split(sep)) {
		current = join(current, segment);
		try {
			const info = await lstat(current);
			if (info.isSymbolicLink()) throw new ShadowRewindError("SYMLINK_PARENT", `恢复路径经过符号链接父目录 ${JSON.stringify(current)}`);
			if (!info.isDirectory()) throw new ShadowRewindError("PARENT_NOT_DIRECTORY", `恢复父路径不是目录：${JSON.stringify(current)}`);
		} catch (error) {
			if (!(error instanceof ShadowRewindError) && isNodeError(error, "ENOENT")) {
				if (!createMissing) return;
				await mkdir(current, { mode: 493 });
				continue;
			}
			throw error;
		}
	}
}
/** 用同级临时文件把一个路径替换为普通文件（写 → fsync → rename → chmod）。 */
async function replaceRegularFile(path, content, mode) {
	const temporary = join(dirname(path), `.${randomUUID()}.shadow-rewind.tmp`);
	try {
		const handle = await open(temporary, "wx", mode & 511);
		try {
			await handle.writeFile(content);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await chmod(temporary, mode & 511);
		await renameReplacing(temporary, path);
		await syncDirectory(dirname(path));
	} finally {
		await rm(temporary, { force: true });
	}
}
/** 用同级临时名把一个路径替换为符号链接。 */
async function replaceSymbolicLink(path, target) {
	const temporary = join(dirname(path), `.${randomUUID()}.shadow-rewind.tmp`);
	try {
		await symlink(target, temporary);
		await renameReplacing(temporary, path);
		await syncDirectory(dirname(path));
	} finally {
		await rm(temporary, { force: true });
	}
}
/**
* 删除一个文件/符号链接，或一个「空」目录。
* 拒绝删除非空目录——目录内容的清空只能由逐文件恢复完成，这里绝不递归。
*/
async function removeRestoreTarget(path) {
	let info;
	try {
		info = await lstat(path);
	} catch (error) {
		if (isNodeError(error, "ENOENT")) return;
		throw error;
	}
	if (info.isDirectory() && !info.isSymbolicLink()) {
		try {
			await rmdir(path);
		} catch (error) {
			if (isNodeError(error, "ENOTEMPTY") || isNodeError(error, "EEXIST")) throw new ShadowRewindError("DIRECTORY_NOT_EMPTY", `拒绝删除非空目录 ${JSON.stringify(path)}`);
			throw error;
		}
		return;
	}
	await unlink(path);
}
/** 从 `start` 向上尽力删除空目录，直到（不含）`root`。 */
async function pruneEmptyParents(root, start) {
	let current = dirname(start);
	while (current !== root && isWithin(root, current)) {
		try {
			await rmdir(current);
		} catch (error) {
			if (isNodeError(error, "ENOENT")) {
				current = dirname(current);
				continue;
			}
			if (isNodeError(error, "ENOTEMPTY") || isNodeError(error, "EEXIST")) return;
			throw error;
		}
		current = dirname(current);
	}
}
/** 测试进程 id 是否仍然存在（lock 回收判定用）。 */
function processExists(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return isNodeError(error, "EPERM");
	}
}
/** Node 错误的类型守卫：带指定 `code`。 */
function isNodeError(error, code) {
	return error instanceof Error && "code" in error && error.code === code;
}
/** 平台支持时 flush 目录项变更（Windows/部分 FS 不支持则静默跳过）。 */
async function syncDirectory(path) {
	let handle;
	try {
		handle = await open(path, "r");
		await handle.sync();
	} catch (error) {
		if (isNodeError(error, "EINVAL") || isNodeError(error, "ENOTSUP") || isNodeError(error, "EISDIR") || isNodeError(error, "EPERM") || isNodeError(error, "EACCES")) return;
		throw error;
	} finally {
		await handle?.close();
	}
}
/** 列出一层目录里的普通文件名（不存在 → 空数组）。 */
async function safeFileNames(path) {
	try {
		return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
	} catch (error) {
		if (isNodeError(error, "ENOENT")) return [];
		throw error;
	}
}
/** 列出一层目录里的子目录名（不存在 → 空数组）。 */
async function safeDirectoryNames(path) {
	try {
		return (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
	} catch (error) {
		if (isNodeError(error, "ENOENT")) return [];
		throw error;
	}
}
/** rename 覆盖已有目标：Windows 上对已存在目标 rename 会失败，先移除再换。 */
async function renameReplacing(source, destination) {
	try {
		await rename(source, destination);
		return;
	} catch (error) {
		if (!isNodeError(error, "EEXIST") && !isNodeError(error, "EPERM") && !isNodeError(error, "ENOTEMPTY")) throw error;
	}
	await removeRestoreTarget(destination);
	await rename(source, destination);
}
//#endregion
export { assertSafeParents, canonicalDirectory, ensureSafeParents, isNodeError, isWithin, pathExists, processExists, pruneEmptyParents, readJson, removeRestoreTarget, replaceRegularFile, replaceSymbolicLink, resolveWorkspacePath, safeDirectoryNames, safeFileNames, syncDirectory, validateRelativePath, writeJsonAtomic };
