import { isWithin } from "../path-utils.js";
import { contentMatches, crlfStyle, normalizeNewlines, restoreNewlines } from "./cas.js";
import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region src/file-review/file-review-service.ts
/**
* 宿主半边的产出文本 diff 撤销 / 重做服务（工作区围栏内）。
*
* 三条并行的执行路径，共用同一套 applied / undone / conflict 状态模型：
*  - **hunk 文本回放**：检查点 diff 派生的常规改动（含 Code Mode 嵌套写盘），
*    逐 hunk 逆序回放 + 行锚点匹配 + 提交前 CAS 复核；
*  - **fs 整文件形状**：检查点对比派生的终端写盘（新增 / 删除 / 纯权限位），
*    天然互逆，无需回放；
*  - **目录条目**：mkdir / rmdir 互逆，删除侧带「必须为空」闸门。
*
* 全局不变式：**绝不猜着改**。任何一侧对不上就报 `conflict` 或
* `unsupported` 并原样不动；所有路径都被工作区围栏（realpath 解析后必须仍在
* 会话 cwd 内）与符号链接拒绝共同约束。
*/
/**
* 行尾归一化与统一 CAS 规则收敛在 ./cas.ts（H3 归一）：hunk 匹配、fs 形状
* 比较、提交前复核共用同一套「未被改动」定义，写回一律还原文件自己的行尾。
*/
/**
* 解析一个会话相对路径为可安全操作的目标文件。
* 围栏是双重的：解析前后各校验一次（符号链接可能把路径指向工作区外），
* 且显式拒绝符号链接与非普通文件；非 UTF-8 内容一律拒收（回放会毁掉字节）。
*/
async function resolveFile(cwd, requestedPath) {
	const root = await realpath(cwd);
	const candidate = resolve(root, requestedPath);
	if (!isWithin(root, candidate)) throw new Error("path is outside the session workspace");
	const linkStat = await lstat(candidate);
	if (linkStat.isSymbolicLink()) throw new Error("symbolic links are not supported");
	if (!linkStat.isFile()) throw new Error("path is not a regular file");
	const filename = await realpath(candidate);
	if (!isWithin(root, filename)) throw new Error("resolved path is outside the session workspace");
	const bytes = await readFile(filename);
	const text = bytes.toString("utf8");
	if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("file is not valid UTF-8 text");
	const crlf = text.includes("\r");
	return {
		filename,
		mode: linkStat.mode & 511,
		bytes,
		text,
		crlf,
		lfText: normalizeNewlines(text)
	};
}
/** 第 `line` 行（1-based）在文本中的字节偏移；越界返回 null。 */
function offsetAtLine(text, line) {
	if (!Number.isInteger(line) || line < 1) return null;
	if (line === 1) return 0;
	let offset = 0;
	for (let current = 1; current < line; current += 1) {
		const next = text.indexOf("\n", offset);
		if (next === -1) return null;
		offset = next + 1;
	}
	return offset;
}
/**
* 在 `text` 上把 `source` 换成 `replacement`，失败返回 null（绝不猜着改）。
* 给了行锚点就做**锚点精确匹配**（该行起始处必须整段等于 `source`）；
* 没给锚点则要求 `source` 全局唯一——出现 0 次或多次都拒绝。
*/
function replaceHunk(text, source, replacement, line) {
	let offset;
	if (line !== void 0) {
		const located = offsetAtLine(text, line);
		if (located === null || text.slice(located, located + source.length) !== source) return null;
		offset = located;
	} else {
		if (source === "") return null;
		offset = text.indexOf(source);
		if (offset === -1 || text.indexOf(source, offset + 1) !== -1) return null;
	}
	return text.slice(0, offset) + replacement + text.slice(offset + source.length);
}
/**
* 这个 hunk 是否具备「可逆回放」所需的全部信息。
* 空侧必须有行锚点兜底：空字符串在任何位置都平凡匹配，没有锚点就无法定位
* 插入点，回放会退化成猜测——直接判不支持。
*/
function hunkSupported(diff, path) {
	if (diff.path !== path || diff.oldText === null || diff.oldText === diff.newText) return false;
	if (diff.oldText === "" && diff.oldStart === void 0) return false;
	if (diff.newText === "" && diff.newStart === void 0) return false;
	return true;
}
/** 识别一个条目是否属于 fs 整文件形状；不是则返回 null（走 hunk 回放路径）。 */
function fsChangeShape(file) {
	if (file.dirKind !== void 0) return {
		kind: file.dirKind,
		dir: true
	};
	if (file.diffs.length !== 1) return null;
	const diff = file.diffs[0];
	if (diff === void 0 || diff.path !== file.path) return null;
	if (file.origin === "fs" && diff.oldText !== null && normalizeNewlines(diff.oldText) === normalizeNewlines(diff.newText) && diff.oldMode !== void 0 && diff.newMode !== void 0 && diff.oldMode !== diff.newMode) return { kind: "mode" };
	if (diff.oldText === null) return {
		kind: "added",
		dir: false
	};
	if (diff.newText === "" && diff.oldText !== "" && diff.oldStart === void 0) return {
		kind: "deleted",
		dir: false
	};
	return null;
}
/** 一个会话相对路径在磁盘上的当前存在性 / 内容 / 权限位。 */
async function fsFileState(cwd, requestedPath) {
	const root = await realpath(cwd);
	const candidate = resolve(root, requestedPath);
	if (!isWithin(root, candidate)) throw new Error("path is outside the session workspace");
	let stat;
	try {
		stat = await lstat(candidate);
	} catch (error) {
		if (error.code === "ENOENT") return { exists: false };
		throw error;
	}
	if (stat.isSymbolicLink()) throw new Error("symbolic links are not supported");
	if (!stat.isFile()) throw new Error("path is not a regular file");
	const filename = await realpath(candidate);
	if (!isWithin(root, filename)) throw new Error("resolved path is outside the session workspace");
	const bytes = await readFile(filename);
	const text = bytes.toString("utf8");
	if (!Buffer.from(text, "utf8").equals(bytes)) throw new Error("file is not valid UTF-8 text");
	return {
		exists: true,
		filename,
		text,
		mode: stat.mode & 511
	};
}
/** 一个会话相对路径在磁盘上作为「目录」的当前存在性。 */
async function fsDirState(cwd, requestedPath) {
	const root = await realpath(cwd);
	const candidate = resolve(root, requestedPath);
	if (!isWithin(root, candidate)) throw new Error("path is outside the session workspace");
	let stat;
	try {
		stat = await lstat(candidate);
	} catch (error) {
		if (error.code === "ENOENT") return { exists: false };
		throw error;
	}
	if (stat.isSymbolicLink() || !stat.isDirectory()) return { other: true };
	return {
		dir: true,
		mode: stat.mode & 511
	};
}
/** 对「当前磁盘状态」判定一条 fs 变更的 applied / undone / conflict。
* 行尾归一化比较：fs 条目两侧内容分别来自检查点 blob 与磁盘，行尾风格可能
* 不一致（LF 快照 vs CRLF 磁盘），不归一化会误报「冲突」。
* ponytail: 混合行尾的文件仍可能被判冲突——天花板是行级行尾映射；
* 升级路径是逐行带行尾比较（hunk 路径的 restoreNewlines 同此边界）。 */
function inspectFsChange(cwd, file, shape) {
	const diff = file.diffs[0];
	return (async () => {
		try {
			if (shape.kind === "mode") {
				if (diff === void 0 || diff.oldMode === void 0 || diff.newMode === void 0) return {
					path: file.path,
					state: "error",
					changed: false,
					reason: "recorded change carries no mode pair"
				};
				const state = await fsFileState(cwd, file.path);
				if (!state.exists) return {
					path: file.path,
					state: "conflict",
					changed: false,
					reason: "file is missing"
				};
				if (normalizeNewlines(state.text) !== normalizeNewlines(diff.newText)) return {
					path: file.path,
					state: "conflict",
					changed: false,
					reason: "file content differs from the recorded change"
				};
				if (state.mode === diff.newMode) return {
					path: file.path,
					state: "applied",
					changed: false
				};
				if (state.mode === diff.oldMode) return {
					path: file.path,
					state: "undone",
					changed: false
				};
				return {
					path: file.path,
					state: "conflict",
					changed: false,
					reason: "file mode matches neither recorded side"
				};
			}
			if (shape.dir) {
				const state = await fsDirState(cwd, file.path);
				if ("other" in state) return {
					path: file.path,
					state: "conflict",
					changed: false,
					reason: "path is not a directory"
				};
				const present = "dir" in state;
				if (shape.kind === "added") return present ? {
					path: file.path,
					state: "applied",
					changed: false
				} : {
					path: file.path,
					state: "undone",
					changed: false
				};
				return present ? {
					path: file.path,
					state: "undone",
					changed: false
				} : {
					path: file.path,
					state: "applied",
					changed: false
				};
			}
			if (diff === void 0) return {
				path: file.path,
				state: "error",
				changed: false,
				reason: "recorded change carries no diff"
			};
			const state = await fsFileState(cwd, file.path);
			if (shape.kind === "added") {
				if (!state.exists) return {
					path: file.path,
					state: "undone",
					changed: false
				};
				if (normalizeNewlines(state.text) === normalizeNewlines(diff.newText)) return {
					path: file.path,
					state: "applied",
					changed: false
				};
				return {
					path: file.path,
					state: "conflict",
					changed: false,
					reason: "file content differs from the recorded change"
				};
			}
			if (!state.exists) return {
				path: file.path,
				state: "applied",
				changed: false
			};
			if (diff.oldText !== null && normalizeNewlines(state.text) === normalizeNewlines(diff.oldText)) return {
				path: file.path,
				state: "undone",
				changed: false
			};
			return {
				path: file.path,
				state: "conflict",
				changed: false,
				reason: "file content differs from the recorded change"
			};
		} catch (error) {
			return {
				path: file.path,
				state: "error",
				changed: false,
				reason: error instanceof Error ? error.message : String(error)
			};
		}
	})();
}
/** rescue 副本保留上限：超出即淘汰最旧（按文件名的 ms 时间戳排序）。
* 这条轻量删除路径不在引擎安全闸内，副本目录若无限增长会拖垮存储盘。 */
const RESCUE_COPY_CAP = 50;
/** 删除前的可找回副本：<rescueDir>/<时间戳>-<rand>-<净化文件名>。
* content 为 string（fs 条目删除，走原子写）或 Buffer（force 递归删目录的
* 逐文件副本，普通写即可——副本本身是尽力而为的兜底，不需要原子语义）。 */
async function writeRescueCopy(rescueDir, path, content) {
	try {
		await mkdir(rescueDir, { recursive: true });
		const safe = path.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80);
		const name = `${String(Date.now())}-${randomUUID().slice(0, 8)}-${safe === "" ? "file" : safe}.txt`;
		const target = join(rescueDir, name);
		if (typeof content === "string") await writeFileAtomic(target, content, { mode: 384 });
		else await writeFile(target, content, { mode: 384 });
		const existing = (await readdir(rescueDir)).filter((name) => name.endsWith(".txt")).sort();
		for (const stale of existing.slice(0, Math.max(0, existing.length - RESCUE_COPY_CAP))) await rm(join(rescueDir, stale), { force: true }).catch(() => void 0);
		return true;
	} catch {
		return false;
	}
}
/**
* force 递归删目录前的逐文件可找回副本（尽力而为）：子树里每个普通文件
* 都落一份副本再删。目录本身不备份（结构可由路径重建）；单个文件副本
* 失败不阻止删除——force 是用户的显式授权，副本只是最后的善意。
*/
async function rescueCopyTree(rescueDir, absDir, relDir) {
	let entries;
	try {
		entries = await readdir(absDir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const absChild = join(absDir, entry.name);
		const relChild = `${relDir}/${entry.name}`;
		if (entry.isDirectory()) {
			await rescueCopyTree(rescueDir, absChild, relChild);
			continue;
		}
		if (!entry.isFile()) continue;
		try {
			await writeRescueCopy(rescueDir, relChild, await readFile(absChild));
		} catch {}
	}
}
/**
* 执行一次 fs 变更的开关动作，提交前一刻重查 CAS 闸门。
* rescueDir 提供时，任何删除分支（fs-added 撤销 / fs-deleted 重做）先把即将
* 删除的内容落一份可找回的副本——这条轻量路径不在引擎的恢复安全闸之内，
* 副本是唯一的服务端兜底；落盘失败则拒绝删除（宁可不删，不可删了找不回）。
* 目录条目没有内容可备份（rmdir 只删空目录），不走 rescue；force 递归删
* 非空目录前改为逐文件落副本（rescueCopyTree）。
*
* force（EXPECTED-DESIGN 1.2）：用户在冲突弹窗授权「全部回滚」——内容漂移
* （conflict）不再拒绝，覆盖用户的二次修改；结构性 error（磁盘读不出等）
* 仍如实上报。「非空拒删」闸随 force 放开为递归删除。
*/
async function applyFsChange(cwd, file, action, shape, rescueDir, force) {
	const diff = file.diffs[0];
	try {
		const inspected = await inspectFsChange(cwd, file, shape);
		const sourceState = action === "undo" ? "applied" : "undone";
		const targetState = action === "undo" ? "undone" : "applied";
		if (inspected.state === targetState) return {
			path: file.path,
			state: targetState,
			changed: false
		};
		if (inspected.state === "error") return {
			path: file.path,
			state: inspected.state,
			changed: false,
			reason: inspected.reason
		};
		if (inspected.state !== sourceState && force !== true) return {
			path: file.path,
			state: inspected.state,
			changed: false,
			reason: inspected.reason
		};
		if (shape.kind === "mode") {
			if (diff === void 0 || diff.oldMode === void 0 || diff.newMode === void 0) return {
				path: file.path,
				state: "error",
				changed: false,
				reason: "recorded change carries no mode pair"
			};
			const state = await fsFileState(cwd, file.path);
			if (!state.exists || force !== true && normalizeNewlines(state.text) !== normalizeNewlines(diff.newText)) return {
				path: file.path,
				state: "conflict",
				changed: false,
				reason: "file changed while the operation was being prepared"
			};
			const root = await realpath(cwd);
			await chmod(resolve(root, file.path), action === "undo" ? diff.oldMode : diff.newMode);
			return {
				path: file.path,
				state: targetState,
				changed: true
			};
		}
		if (shape.dir) {
			const removes = shape.kind === "added" === (action === "undo");
			const root = await realpath(cwd);
			const target = resolve(root, file.path);
			if (removes) {
				try {
					await rmdir(target);
				} catch (error) {
					if (error.code === "ENOTEMPTY") {
						if (force !== true) return {
							path: file.path,
							state: "conflict",
							changed: false,
							reason: "directory is not empty"
						};
						if (rescueDir !== void 0) await rescueCopyTree(rescueDir, target, file.path);
						await rm(target, {
							recursive: true,
							force: true
						});
						return {
							path: file.path,
							state: targetState,
							changed: true
						};
					}
					if (error.code === "ENOENT") return {
						path: file.path,
						state: "conflict",
						changed: false,
						reason: "directory changed while the operation was being prepared"
					};
					throw error;
				}
				return {
					path: file.path,
					state: targetState,
					changed: true
				};
			}
			const state = await fsDirState(cwd, file.path);
			if ("dir" in state || "other" in state) return {
				path: file.path,
				state: "conflict",
				changed: false,
				reason: "directory changed while the operation was being prepared"
			};
			await mkdir(target);
			if (process.platform !== "win32" && diff !== void 0) {
				const mode = action === "undo" ? diff.oldMode : diff.newMode;
				if (mode !== void 0) await chmod(target, mode);
			}
			return {
				path: file.path,
				state: targetState,
				changed: true
			};
		}
		if (diff === void 0) return {
			path: file.path,
			state: "error",
			changed: false,
			reason: "recorded change carries no diff"
		};
		const removes = shape.kind === "added" === (action === "undo");
		const state = await fsFileState(cwd, file.path);
		if (removes) {
			const expected = shape.kind === "added" ? diff.newText : diff.oldText;
			const matches = state.exists && expected !== null && normalizeNewlines(state.text) === normalizeNewlines(expected);
			if (!state.exists) return {
				path: file.path,
				state: "conflict",
				changed: false,
				reason: "file changed while the operation was being prepared"
			};
			if (!matches && force !== true) return {
				path: file.path,
				state: "conflict",
				changed: false,
				reason: "file changed while the operation was being prepared"
			};
			if (rescueDir !== void 0) {
				if (!await writeRescueCopy(rescueDir, file.path, state.text)) return {
					path: file.path,
					state: "error",
					changed: false,
					reason: "rescue backup failed; deletion refused"
				};
			}
			await rm(state.filename);
			return {
				path: file.path,
				state: targetState,
				changed: true
			};
		}
		if (state.exists && force !== true) return {
			path: file.path,
			state: "conflict",
			changed: false,
			reason: "file changed while the operation was being prepared"
		};
		const content = shape.kind === "added" ? diff.newText : diff.oldText;
		if (content === null) return {
			path: file.path,
			state: "error",
			changed: false,
			reason: "recorded change carries no restorable content"
		};
		const root = await realpath(cwd);
		const mode = action === "undo" ? diff.oldMode : diff.newMode;
		await writeFileAtomic(resolve(root, file.path), content, { mode: mode ?? 420 });
		return {
			path: file.path,
			state: targetState,
			changed: true
		};
	} catch (error) {
		return {
			path: file.path,
			state: "error",
			changed: false,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
/**
* 在内存里回放一个文件的完整 hunk 序列；任一 hunk 对不上就返回 null。
* 导出是为了让单测直接断言「纯变换」这一段，不必走 IO。
*/
function transformFile(text, file, action) {
	if (file.diffs.length === 0 || !file.diffs.every((diff) => hunkSupported(diff, file.path))) return null;
	const diffs = action === "undo" ? [...file.diffs].reverse() : file.diffs;
	let next = text;
	for (const diff of diffs) {
		const source = action === "undo" ? diff.newText : diff.oldText;
		const replacement = action === "undo" ? diff.oldText : diff.newText;
		if (source === null || replacement === null) return null;
		const changed = replaceHunk(next, source, replacement, action === "undo" ? diff.newStart : diff.oldStart);
		if (changed === null) return null;
		next = changed;
	}
	return next;
}
/** 某一侧（old / new）的全部非空 hunk 是否都在 `text` 里在场。 */
function hunkSidePresent(text, file, side) {
	for (const diff of file.diffs) {
		const source = side === "old" ? diff.oldText : diff.newText;
		if (source === null || source === "") continue;
		const line = side === "old" ? diff.oldStart : diff.newStart;
		if (line !== void 0) {
			const located = offsetAtLine(text, line);
			if (located === null || text.slice(located, located + source.length) !== source) return false;
		} else if (text.indexOf(source) === -1) return false;
	}
	return true;
}
/** 纯文本侧的状态判定：当前文本相对录制变更处于 applied / undone / conflict。 */
function inspectText(text, file) {
	if (file.diffs.length === 0 || !file.diffs.every((diff) => hunkSupported(diff, file.path))) return {
		state: "unsupported",
		reason: "change has no complete reversible diff"
	};
	const undone = transformFile(text, file, "undo");
	const redone = transformFile(text, file, "redo");
	if (undone !== null && redone !== null) {
		const newEvidence = file.diffs.filter((diff) => diff.newText !== null && diff.newText !== "");
		return newEvidence.length > 0 && hunkSidePresent(text, {
			...file,
			diffs: newEvidence
		}, "new") ? {
			state: "applied",
			text,
			nextText: undone
		} : {
			state: "undone",
			text,
			nextText: redone
		};
	}
	if (undone !== null) return {
		state: "applied",
		text,
		nextText: undone
	};
	if (redone !== null) return {
		state: "undone",
		text,
		nextText: redone
	};
	return {
		state: "conflict",
		reason: "current content does not match the recorded change"
	};
}
/** 巡检一个条目（先判 fs 形状，否则走 hunk 文本路径）。 */
async function inspectOne(cwd, file) {
	const fsShape = fsChangeShape(file);
	if (fsShape !== null) return inspectFsChange(cwd, file, fsShape);
	if (file.diffs.length === 0 || !file.diffs.every((diff) => hunkSupported(diff, file.path))) return {
		path: file.path,
		state: "unsupported",
		changed: false,
		reason: "change has no complete reversible diff"
	};
	try {
		const inspected = inspectText((await resolveFile(cwd, file.path)).lfText, file);
		return {
			path: file.path,
			state: inspected.state,
			changed: false,
			reason: inspected.reason
		};
	} catch (error) {
		return {
			path: file.path,
			state: "error",
			changed: false,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
/** 执行一个条目的开关动作（fs 形状直接落盘，否则走 hunk 回放 + CAS 复核）。
* force（EXPECTED-DESIGN 1.2）：冲突弹窗授权「全部回滚」后的强制开关。 */
async function applyOne(cwd, file, action, rescueDir, force) {
	const fsShape = fsChangeShape(file);
	if (fsShape !== null) return applyFsChange(cwd, file, action, fsShape, rescueDir, force);
	if (file.diffs.length === 0 || !file.diffs.every((diff) => hunkSupported(diff, file.path))) return {
		path: file.path,
		state: "unsupported",
		changed: false,
		reason: "change has no complete reversible diff"
	};
	try {
		const resolved = await resolveFile(cwd, file.path);
		const inspected = inspectText(resolved.lfText, file);
		const sourceState = action === "undo" ? "applied" : "undone";
		const targetState = action === "undo" ? "undone" : "applied";
		if (inspected.state === targetState) return {
			path: file.path,
			state: targetState,
			changed: false
		};
		if (force === true) {
			const nextText = transformFile(resolved.lfText, file, action);
			if (nextText === null) return {
				path: file.path,
				state: "conflict",
				changed: false,
				reason: "forced replay could not locate the recorded hunks in the current content"
			};
			await writeFileAtomic(resolved.filename, restoreNewlines(nextText, crlfStyle(resolved.bytes)), { mode: resolved.mode });
			return {
				path: file.path,
				state: targetState,
				changed: true
			};
		}
		if (inspected.state !== sourceState || inspected.nextText === void 0) return {
			path: file.path,
			state: inspected.state,
			changed: false,
			reason: inspected.reason
		};
		const current = await readFile(resolved.filename);
		if (!contentMatches(current, resolved.bytes)) return {
			path: file.path,
			state: "conflict",
			changed: false,
			reason: "file changed while the operation was being prepared"
		};
		await writeFileAtomic(resolved.filename, restoreNewlines(inspected.nextText, crlfStyle(current)), { mode: resolved.mode });
		return {
			path: file.path,
			state: targetState,
			changed: true
		};
	} catch (error) {
		return {
			path: file.path,
			state: "error",
			changed: false,
			reason: error instanceof Error ? error.message : String(error)
		};
	}
}
/** 取会话工作区目录；缺失即抛错——没有围栏基准就绝不动任何文件。 */
function sessionCwd(agent) {
	const cwd = agent.session.header.cwd;
	if (cwd === void 0 || cwd.trim() === "") throw new Error("session has no workspace directory");
	return cwd;
}
/**
* 以 `fileReview` 远端命名空间发布的宿主服务。
*
* 方法粒度刻意保持「一次请求 = 一批文件」：`status` 只读巡检，`apply` 在
* 会话空闲窗口（`agent.runMaintenance`）里逐文件执行——绝不打断正在跑的
* 回合，也绝不在请求内部并行（避免同一文件被两个动作交错）。
*/
var FileReviewService = class extends TypertRemoteService {
	/** 删除类 fs 撤销的安全网目录：<storageDir>/file-review/rescue/。 */
	rescueDir;
	constructor(ctx, options = {}) {
		super(ctx, "fileReview");
		this.rescueDir = options.storageDir !== void 0 && options.storageDir.trim() !== "" ? join(options.storageDir, "file-review", "rescue") : void 0;
	}
	/** 只巡检当前磁盘状态，不动任何文件（可并发）。 */
	async status(agent, request) {
		const cwd = sessionCwd(agent);
		return { files: await Promise.all(request.files.map((file) => inspectOne(cwd, file))) };
	}
	/**
	* 在接收方 Agent 空闲时逐个开关「各自独立安全」的文件。
	* 逐文件串行而非并行：同一路径的两个动作交错会让 CAS 闸门失去意义。
	* 单个文件失败不影响其余文件——结果里逐条如实报告。
	* force（EXPECTED-DESIGN 1.2）：冲突弹窗授权「全部回滚」后为 true——
	* CAS 失配的条目强制覆盖（详见 applyOne / applyFsChange）。
	*/
	async apply(agent, request) {
		const cwd = sessionCwd(agent);
		return agent.runMaintenance(async () => {
			const files = [];
			for (const file of request.files) files.push(await applyOne(cwd, file, request.action, this.rescueDir, request.force === true));
			return { files };
		});
	}
};
//#endregion
export { FileReviewService, transformFile };
