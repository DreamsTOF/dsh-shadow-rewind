import { ShadowRewindError } from "./errors.js";
import { validateRelativePath } from "./path-utils.js";
import "./types.js";
import { createHash, randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";
//#region src/manifest.ts
/** 恢复点清单：确定性哈希、差异计算与持久化数据的全量校验。 */
/** 生成形如 `rp_<timeBase36>_<rand12>` 的持久化 id。 */
function makeId(prefix) {
	return `${prefix}_${Date.now().toString(36)}_${randomBytes(6).toString("hex")}`;
}
/** 内容寻址：文件字节 → SHA-256 hex。 */
function sha256Hex(content) {
	return createHash("sha256").update(content).digest("hex");
}
/**
* 全树确定性哈希：路径逐条目序列化后统一 SHA-256。
* 快照条目只含 kind/blob/size/mode/target——与字节存放在哪个后端无关，
* 因此同一棵树在 jj 与 blob 两种后端下 treeHash 一致。
* 刻意不含 mtimeNs：树哈希是内容寻址，恢复写回不保留时间戳——若时间戳进哈希，
* 恢复后树哈希必变，会击穿 planRestore 的树哈希 CAS（旧清单也因而判「损坏」）。
*/
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
/** 两个条目是否字节/类型/权限完全等价。
* mtimeNs 不参与：等价判定与树哈希同为内容寻址，恢复写回不保留时间戳。 */
function entriesEqual(left, right) {
	if (left === void 0 || right === void 0) return left === right;
	if (left.kind !== right.kind || left.mode !== right.mode) return false;
	if (left.kind === "file" && right.kind === "file") return left.blob === right.blob && left.size === right.size;
	if (left.kind === "dir") return true;
	return left.kind === "symlink" && right.kind === "symlink" && left.target === right.target;
}
/**
* 计算快照树之间的路径级差异。
* `before` 是旧树（缺路径 → added），`after` 是新树（缺路径 → deleted）。
*/
function diffTrees(before, after) {
	const paths = [.../* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after)])].sort((a, b) => Buffer.from(a).compare(Buffer.from(b)));
	const changes = [];
	for (const path of paths) {
		const left = before[path];
		const right = after[path];
		if (left === void 0 && right !== void 0) {
			changes.push({
				path,
				kind: "added",
				after: right
			});
			continue;
		}
		if (left !== void 0 && right === void 0) {
			changes.push({
				path,
				kind: "deleted",
				before: left
			});
			continue;
		}
		if (left === void 0 || right === void 0 || entriesEqual(left, right)) continue;
		if (left.kind !== right.kind) {
			changes.push({
				path,
				kind: "type-changed",
				before: left,
				after: right
			});
			continue;
		}
		if (entriesSameBytes(left, right) && left.mode !== right.mode) {
			changes.push({
				path,
				kind: "mode-changed",
				before: left,
				after: right
			});
			continue;
		}
		changes.push({
			path,
			kind: "modified",
			before: left,
			after: right
		});
	}
	return changes;
}
function entriesSameBytes(left, right) {
	if (left.kind === "file" && right.kind === "file") return left.blob === right.blob;
	if (left.kind === "symlink" && right.kind === "symlink") return left.target === right.target;
	return left.kind === "dir" && right.kind === "dir";
}
/** 解析并全量校验一份不受信任的 manifest JSON。 */
function parseManifest(value) {
	const record = objectRecord(value, "恢复点清单");
	if (record.version !== 1) corrupt(`不支持的恢复点版本 ${String(record.version)}`);
	const id = stringField(record, "id");
	if (!/^rp_[0-9a-z]+_[0-9a-f]{12}$/.test(id)) corrupt(`恢复点 id 无效：${JSON.stringify(id)}`);
	const kind = record.kind;
	if (kind !== "user" && kind !== "rescue" && kind !== "turn") corrupt("恢复点 kind 非法");
	const restoreKind = kind;
	const workspace = absoluteString(record, "workspace");
	const storage = record.storage;
	if (storage !== "jj" && storage !== "blob") corrupt("storage 必须是 \"jj\" 或 \"blob\"");
	const commitId = optionalString(record, "commitId");
	if (storage === "jj") {
		if (commitId === void 0 || !/^[0-9a-f]{40}$/.test(commitId)) corrupt("jj 后端的恢复点必须携带 40 位 commitId");
	} else if (commitId !== void 0) corrupt("blob 后端的恢复点不应携带 commitId");
	const entriesRecord = objectRecord(record.entries, "恢复点条目");
	const entries = Object.create(null);
	let totalBytes = 0;
	for (const [path, entryValue] of Object.entries(entriesRecord)) {
		validateRelativePath(path);
		const entry = parseEntry(entryValue, path);
		entries[path] = entry;
		if (entry.kind === "file") totalBytes += entry.size;
	}
	const fileCount = nonNegativeInteger(record, "fileCount");
	if (fileCount !== Object.keys(entries).length) corrupt("fileCount 与条目数不符");
	if (nonNegativeInteger(record, "totalBytes") !== totalBytes) corrupt("totalBytes 与条目不符");
	const treeHash = hashField(record, "treeHash");
	if (treeHash !== hashTree(entries)) corrupt("treeHash 与条目不符");
	const skipped = parseSkipped(record.skippedPaths);
	const createdAt = nonNegativeInteger(record, "createdAt");
	const restoreCount = nonNegativeInteger(record, "restoreCount");
	const sessionId = optionalString(record, "sessionId");
	const label = optionalString(record, "label");
	const parentRestorePoint = optionalString(record, "parentRestorePoint");
	if (parentRestorePoint !== void 0 && !/^rp_[0-9a-z]+_[0-9a-f]{12}$/.test(parentRestorePoint)) corrupt("parentRestorePoint id 无效");
	const turn = optionalNonNegativeInteger(record, "turn");
	const turnStartSeq = optionalNonNegativeInteger(record, "turnStartSeq");
	const turnEndSeq = optionalNonNegativeInteger(record, "turnEndSeq");
	const phase = record.phase;
	if (phase !== void 0 && phase !== "start" && phase !== "end") corrupt(`非法的 phase ${JSON.stringify(phase)}`);
	if (restoreKind === "turn") {
		if (sessionId === void 0 || turn === void 0 || turnStartSeq === void 0) corrupt("turn 恢复点必须携带 sessionId、turn 与 turnStartSeq");
	} else {
		if (turn !== void 0 || turnStartSeq !== void 0 || turnEndSeq !== void 0) corrupt("只有 turn 恢复点可以携带回合元数据");
		if (phase !== void 0) corrupt("只有 turn 恢复点可以携带 phase");
	}
	const lastRestoredAt = optionalNonNegativeInteger(record, "lastRestoredAt");
	return {
		version: 1,
		id,
		kind: restoreKind,
		workspace,
		storage,
		...commitId === void 0 ? {} : { commitId },
		...sessionId === void 0 ? {} : { sessionId },
		...label === void 0 ? {} : { label },
		...parentRestorePoint === void 0 ? {} : { parentRestorePoint },
		...turn === void 0 ? {} : { turn },
		...turnStartSeq === void 0 ? {} : { turnStartSeq },
		...phase === void 0 ? {} : { phase },
		...turnEndSeq === void 0 ? {} : { turnEndSeq },
		createdAt,
		treeHash,
		fileCount,
		totalBytes,
		entries,
		skippedPaths: skipped,
		restoreCount,
		...lastRestoredAt === void 0 ? {} : { lastRestoredAt }
	};
}
/** 解析并校验一份恢复操作日志。 */
function parseOperation(value) {
	const record = objectRecord(value, "恢复操作日志");
	if (record.version !== 1) corrupt(`不支持的操作日志版本 ${String(record.version)}`);
	const id = stringField(record, "id");
	if (!/^op_[0-9a-z]+_[0-9a-f]{12}$/.test(id)) corrupt(`操作 id 无效：${JSON.stringify(id)}`);
	const restorePointId = stringField(record, "restorePointId");
	const rescuePointId = stringField(record, "rescuePointId");
	for (const point of [restorePointId, rescuePointId]) if (!/^rp_[0-9a-z]+_[0-9a-f]{12}$/.test(point)) corrupt(`操作引用的恢复点 id 无效：${JSON.stringify(point)}`);
	const workspace = absoluteString(record, "workspace");
	const pathsValue = record.paths;
	if (!Array.isArray(pathsValue)) corrupt("操作日志 paths 必须是数组");
	const paths = pathsValue.map((path) => validateRelativePath(String(path)));
	if (new Set(paths).size !== paths.length) corrupt("操作日志 paths 含重复项");
	const state = record.state;
	if (state !== "running" && state !== "rollback-running" && state !== "completed" && state !== "rolled-back" && state !== "interrupted" && state !== "recovery-required") corrupt(`非法的操作状态 ${JSON.stringify(state)}`);
	const sessionId = optionalString(record, "sessionId");
	const startedAt = nonNegativeInteger(record, "startedAt");
	const finishedAt = optionalNonNegativeInteger(record, "finishedAt");
	const error = optionalString(record, "error");
	const rollbackError = optionalString(record, "rollbackError");
	return {
		version: 1,
		id,
		workspace,
		restorePointId,
		rescuePointId,
		...sessionId === void 0 ? {} : { sessionId },
		paths,
		startedAt,
		...finishedAt === void 0 ? {} : { finishedAt },
		state,
		...error === void 0 ? {} : { error },
		...rollbackError === void 0 ? {} : { rollbackError }
	};
}
function parseSkipped(value) {
	if (value === void 0) return [];
	if (!Array.isArray(value)) corrupt("skippedPaths 必须是数组");
	return value.map((item) => {
		const record = objectRecord(item, "skippedPaths 条目");
		const path = String(record.path ?? "");
		validateRelativePath(path);
		const reason = record.reason;
		if (reason !== "too-large" && reason !== "unsupported-type" && reason !== "read-failed") corrupt(`非法的跳过原因 ${JSON.stringify(reason)}`);
		return {
			path,
			reason
		};
	});
}
function parseEntry(value, path) {
	const record = objectRecord(value, `快照条目 ${JSON.stringify(path)}`);
	const kind = record.kind;
	const mode = nonNegativeInteger(record, "mode");
	if (mode > 4095) corrupt(`快照 mode 越界：${JSON.stringify(path)}`);
	if (kind === "file") {
		const blob = stringField(record, "blob");
		if (!/^[0-9a-f]{64}$/.test(blob)) corrupt(`快照 blob 哈希无效：${JSON.stringify(path)}`);
		const mtimeNs = record.mtimeNs;
		if (mtimeNs !== void 0 && (typeof mtimeNs !== "string" || !/^[0-9]{1,20}$/.test(mtimeNs))) corrupt(`快照 mtimeNs 无效：${JSON.stringify(path)}`);
		return {
			kind,
			blob,
			size: nonNegativeInteger(record, "size"),
			mode,
			...mtimeNs === void 0 ? {} : { mtimeNs }
		};
	}
	if (kind === "symlink") {
		const target = stringField(record, "target");
		if (target.includes("\0")) corrupt(`快照符号链接 target 含 NUL：${JSON.stringify(path)}`);
		return {
			kind,
			target,
			mode
		};
	}
	if (kind === "dir") return {
		kind,
		mode
	};
	corrupt(`快照条目 kind 非法：${JSON.stringify(path)}`);
}
function objectRecord(value, label) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) corrupt(`${label} 必须是对象`);
	return value;
}
function stringField(record, key) {
	const value = record[key];
	if (typeof value !== "string" || value === "") corrupt(`${key} 必须是非空字符串`);
	return value;
}
function optionalString(record, key) {
	const value = record[key];
	if (value === void 0) return void 0;
	if (typeof value !== "string" || value === "") corrupt(`${key} 必须是非空字符串`);
	return value;
}
function absoluteString(record, key) {
	const value = stringField(record, key);
	if (!isAbsolute(value)) corrupt(`${key} 必须是绝对路径`);
	return value;
}
function hashField(record, key) {
	const value = stringField(record, key);
	if (!/^[0-9a-f]{64}$/.test(value)) corrupt(`${key} 必须是 64 位小写 hex`);
	return value;
}
function nonNegativeInteger(record, key) {
	const value = record[key];
	if (!Number.isSafeInteger(value) || value < 0) corrupt(`${key} 必须是非负安全整数`);
	return value;
}
function optionalNonNegativeInteger(record, key) {
	return record[key] === void 0 ? void 0 : nonNegativeInteger(record, key);
}
function corrupt(message) {
	throw new ShadowRewindError("STATE_CORRUPT", message);
}
//#endregion
export { diffTrees, entriesEqual, hashTree, makeId, parseManifest, parseOperation, sha256Hex };
