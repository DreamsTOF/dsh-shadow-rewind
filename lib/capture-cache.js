import { isNodeError, writeJsonAtomic } from "./path-utils.js";
import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
//#region src/capture-cache.ts
/**
* 共享 stat 缓存：jj 与 blob 两个内容后端共用的增量快照基础。
*
* 缓存记录「stat 指纹 → 内容指纹（blob 哈希）」。stat 指纹未变的文件，
* 内容必然未变（工程假设），因此：
*   - 无需重新读取文件内容；
*   - blob 后端无需重复 putBlob（blob 已在存储里）；
*   - jj 后端无需重写镜像文件（工作副本里已是旧内容）。
* 快照过程若被中断，缓存未写回即作废——缓存只是加速结构，永不参与正确性。
*/
/** 读取缓存；缺失/损坏回落空缓存（缓存永不阻塞捕获）。 */
async function readCaptureCache(path) {
	try {
		const value = JSON.parse((await readFile(path, "utf8")).toString());
		if (isCache(value)) return value;
	} catch (error) {
		if (!isNodeError(error, "ENOENT") && !(error instanceof SyntaxError)) throw error;
	}
	return makeCache({});
}
/** 原子写回缓存。 */
async function writeCaptureCache(path, cache) {
	await writeJsonAtomic(path, cache);
}
/**
* 清空缓存（直接删除文件）。
* 在「目标存储可能已失去缓存所引用内容」之后调用——例如 GC 删除 blob、
* 影子仓库被外部清理。缺失即无操作。
*/
async function clearCaptureCache(path) {
	try {
		await unlink(path);
	} catch (error) {
		if (!isNodeError(error, "ENOENT")) throw error;
	}
}
function makeCache(paths) {
	return {
		version: 1,
		paths,
		checksum: checksumOf(paths)
	};
}
function checksumOf(paths) {
	return createHash("sha256").update(JSON.stringify(paths)).digest("hex");
}
function isCache(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value;
	return record.version === 1 && typeof record.checksum === "string" && typeof record.paths === "object" && record.paths !== null && !Array.isArray(record.paths) && record.checksum === checksumOf(record.paths);
}
/** 从扫描事实生成缓存记录（blob 由调用方在实际读到内容后补充）。 */
function cacheEntryOf(file, blob, target) {
	return {
		kind: file.kind,
		size: file.size,
		mode: file.mode,
		mtimeNs: file.mtimeNs.toString(),
		ctimeNs: file.ctimeNs.toString(),
		dev: file.dev.toString(),
		ino: file.ino.toString(),
		...blob === void 0 ? {} : { blob },
		...target === void 0 ? {} : { target }
	};
}
/** stat 指纹比对：缓存记录 vs 扫描事实。 */
function cacheMatches(cached, file) {
	return cached.kind === file.kind && cached.size === file.size && cached.mode === file.mode && cached.mtimeNs === file.mtimeNs.toString() && cached.ctimeNs === file.ctimeNs.toString() && cached.dev === file.dev.toString() && cached.ino === file.ino.toString();
}
//#endregion
export { cacheEntryOf, cacheMatches, clearCaptureCache, readCaptureCache, writeCaptureCache };
