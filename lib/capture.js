import { ShadowRewindError } from "./errors.js";
import { isNodeError, resolveWorkspacePath } from "./path-utils.js";
import { cacheEntryOf, cacheMatches } from "./capture-cache.js";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
//#region src/capture.ts
/**
* 捕获层：把「扫描结果 + 上一轮缓存」变成「快照条目 + 新读内容 + 下一轮缓存」。
*
* 职责边界（对引擎与内容后端保持中立）：
*   - fast 模式下 stat 指纹命中缓存的文件直接复用上次结果，不读内容——
*     这是两个后端（blob / jj 镜像）共用的增量核心；
*   - 命中前经 `verifyContent` 校验「上次的内容确实还在目标存储/镜像里」，
*     防止 GC 或影子仓库丢失后缓存命中出死引用（见 engine 的接线）；
*   - 未命中的文件执行「打开前后 stat 一致」的稳定读取，重试 3 次；
*     读取以「打开时 stat 对」为指纹事实（扫描后文件已变化的路径按新事实
*     入缓存，绝不把旧指纹配新内容写进缓存）；
*   - 读取耗尽失败的路径记录为 skipped('read-failed')，绝不拖垮整个检查点；
*   - 本模块不落任何内容：新读内容在 newContent/newLinks 里由 engine 按后端处置。
*/
/** 执行捕获（见模块注释）。 */
async function captureSnapshot(options) {
	if (options.paths.length > options.maxFiles) throw new ShadowRewindError("TOO_MANY_FILES", `工作区入选文件 ${String(options.paths.length)} 个，超出上限 ${String(options.maxFiles)}`);
	const entries = Object.create(null);
	const skipped = [...options.skippedAtScan];
	const nextPaths = {};
	const newContent = /* @__PURE__ */ new Map();
	const newLinks = /* @__PURE__ */ new Map();
	let totalBytes = 0;
	const addBytes = (bytes) => {
		totalBytes += bytes;
		if (totalBytes > options.maxSnapshotBytes) throw new ShadowRewindError("SNAPSHOT_TOO_LARGE", `快照总字节 ${String(totalBytes)} 超出上限 ${String(options.maxSnapshotBytes)}`);
	};
	for (const file of options.paths) {
		options.signal?.throwIfAborted();
		const cached = options.cache.paths[file.path];
		if (!options.strict && cached !== void 0 && cacheMatches(cached, file)) {
			if (cached.kind === "file" && cached.blob !== void 0 && (options.verifyContent === void 0 || await options.verifyContent(file.path, cached.blob))) {
				entries[file.path] = {
					kind: "file",
					blob: cached.blob,
					size: cached.size,
					mode: cached.mode
				};
				addBytes(cached.size);
				nextPaths[file.path] = cached;
				continue;
			}
			if (cached.kind === "symlink" && cached.target === (file.target ?? "") && cached.mode === file.mode) {
				entries[file.path] = {
					kind: "symlink",
					target: cached.target ?? "",
					mode: cached.mode
				};
				nextPaths[file.path] = cached;
				continue;
			}
		}
		if (file.kind === "symlink") {
			const target = file.target ?? "";
			entries[file.path] = {
				kind: "symlink",
				target,
				mode: file.mode
			};
			newLinks.set(file.path, target);
			nextPaths[file.path] = cacheEntryOf(file, void 0, target);
			continue;
		}
		const read = await stableRead(options.root, file, options.signal);
		if (read === void 0) {
			skipped.push({
				path: file.path,
				reason: "read-failed"
			});
			continue;
		}
		const blob = createHash("sha256").update(read.content).digest("hex");
		addBytes(read.content.length);
		entries[file.path] = {
			kind: "file",
			blob,
			size: read.content.length,
			mode: read.stat.mode
		};
		newContent.set(file.path, read.content);
		nextPaths[file.path] = cacheEntryOf({
			...file,
			...read.stat
		}, blob);
	}
	for (const dir of options.emptyDirs ?? []) {
		options.signal?.throwIfAborted();
		entries[dir.path] = {
			kind: "dir",
			mode: dir.mode
		};
	}
	return {
		entries,
		skipped: skipped.slice().sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
		treeHash: hashTree(entries),
		fileCount: Object.keys(entries).length,
		totalBytes,
		newContent,
		newLinks,
		nextCache: {
			version: 1,
			paths: nextPaths,
			checksum: checksumOf(nextPaths)
		}
	};
}
/**
* 稳定读取：打开前后 stat 完全一致才算成功；任何不符重试，3 次耗尽返回
* undefined（由调用方按 read-failed 记录）。O_NOFOLLOW 防止符号链接偷换。
*/
async function stableRead(root, file, signal) {
	const target = resolveWorkspacePath(root, file.path);
	for (let attempt = 0; attempt < 3; attempt += 1) {
		signal?.throwIfAborted();
		let handle;
		try {
			handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
		} catch (error) {
			if (isNodeError(error, "ENOENT") || isNodeError(error, "ELOOP")) return void 0;
			throw error;
		}
		try {
			const openedStat = await handle.stat({ bigint: true });
			if (!openedStat.isFile()) return void 0;
			const content = await readBounded(handle, Number(openedStat.size));
			signal?.throwIfAborted();
			const afterStat = await handle.stat({ bigint: true });
			if (!sameStat(openedStat, afterStat) || BigInt(content.length) !== afterStat.size) continue;
			return {
				content,
				stat: {
					size: Number(openedStat.size),
					mode: Number(openedStat.mode & 4095n),
					mtimeNs: openedStat.mtimeNs,
					ctimeNs: openedStat.ctimeNs,
					dev: openedStat.dev,
					ino: openedStat.ino
				}
			};
		} finally {
			await handle.close().catch(() => void 0);
		}
	}
}
async function readBounded(handle, expectedSize) {
	const buffer = Buffer.allocUnsafe(expectedSize);
	let offset = 0;
	while (offset < buffer.length) {
		const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
		if (bytesRead === 0) break;
		offset += bytesRead;
	}
	return buffer.subarray(0, offset);
}
function sameStat(left, right) {
	return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
/** 全树确定性哈希：路径 + 条目完整签名（与存储后端无关）。 */
function hashTree(entries) {
	const hash = createHash("sha256");
	for (const path of Object.keys(entries).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))) {
		const entry = entries[path];
		if (entry === void 0) continue;
		hash.update(path);
		hash.update("\0");
		if (entry.kind === "file") hash.update(`file\0${entry.blob}\0${entry.size}\0${entry.mode}\0`);
		else if (entry.kind === "symlink") hash.update(`symlink\0${entry.target}\0${entry.mode}\0`);
		else hash.update(`dir\0${entry.mode}\0`);
	}
	return hash.digest("hex");
}
function checksumOf(paths) {
	return createHash("sha256").update(JSON.stringify(paths)).digest("hex");
}
//#endregion
export { captureSnapshot, hashTree };
