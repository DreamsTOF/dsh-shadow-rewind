import { ShadowRewindError } from "./errors.js";
import { isNodeError, pathExists, readJson, safeFileNames, syncDirectory, writeJsonAtomic } from "./path-utils.js";
import { parseManifest, sha256Hex } from "./manifest.js";
import { createRequire } from "node:module";
import { mkdir, realpath, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
//#region src/store.ts
const ID_PATTERN = /^rp_[0-9a-z]+_[0-9a-f]{12}$/;
/** 每个工作区的全部持久化状态。 */
var WorkspaceStore = class {
	config;
	constructor(config) {
		this.config = config;
	}
	/** 启动装配：确保存储根存在。历史遗留的操作日志文件不再读取——
	* 下一次 GC / 清理时自然过期，不做启动期迁移。 */
	async initialize() {
		await mkdir(join(this.config.storageDir, "workspaces"), {
			recursive: true,
			mode: 448
		});
	}
	/** 规范工作区 → 状态目录（binding 校验通过后）。 */
	async workspaceDir(workspace) {
		const key = sha256Hex(Buffer.from(workspace, "utf8")).slice(0, 16);
		const dir = join(this.config.storageDir, "workspaces", key);
		const bindingPath = join(dir, "workspace.json");
		if (await pathExists(bindingPath)) {
			if ((await readJson(bindingPath)).workspace !== workspace) throw new ShadowRewindError("STATE_CORRUPT", `状态目录 ${key} 已绑定到其它工作区`);
			return dir;
		}
		await mkdir(dir, {
			recursive: true,
			mode: 448
		});
		await writeJsonAtomic(bindingPath, {
			version: 1,
			workspace
		});
		return dir;
	}
	async writeManifest(workspace, manifest) {
		const parsed = parseManifest(manifest);
		if (parsed.workspace !== workspace) throw new ShadowRewindError("STATE_CORRUPT", "恢复点 workspace 与存储目标不一致");
		const dir = await this.workspaceDir(workspace);
		await writeJsonAtomic(join(dir, "manifests", `${parsed.id}.json`), parsed);
	}
	async readManifest(workspace, id) {
		if (!ID_PATTERN.test(id)) throw new ShadowRewindError("INVALID_RESTORE_POINT_ID", `恢复点 id 无效：${JSON.stringify(id)}`);
		const dir = await this.workspaceDir(workspace);
		let raw;
		try {
			raw = await readJson(join(dir, "manifests", `${id}.json`));
		} catch (error) {
			if (isMissingStateRead(error)) throw new ShadowRewindError("RESTORE_POINT_NOT_FOUND", `恢复点 ${id} 不存在`, { cause: error });
			throw error;
		}
		const manifest = parseManifest(raw);
		if (manifest.id !== id || manifest.workspace !== workspace) throw new ShadowRewindError("STATE_CORRUPT", `恢复点 ${id} 的持久化身份不一致`);
		return manifest;
	}
	async listManifests(workspace) {
		const dir = await this.workspaceDir(workspace);
		const result = [];
		for (const filename of await safeFileNames(join(dir, "manifests"))) {
			const manifest = parseManifest(await readJson(join(dir, "manifests", filename)));
			if (manifest.workspace !== workspace || filename !== `${manifest.id}.json`) throw new ShadowRewindError("STATE_CORRUPT", `清单 ${filename} 的持久化身份不一致`);
			result.push(manifest);
		}
		return result.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
	}
	async deleteManifest(workspace, id) {
		if (!ID_PATTERN.test(id)) throw new ShadowRewindError("INVALID_RESTORE_POINT_ID", `恢复点 id 无效：${JSON.stringify(id)}`);
		const dir = await this.workspaceDir(workspace);
		try {
			await unlink(join(dir, "manifests", `${id}.json`));
		} catch (error) {
			if (isNodeError(error, "ENOENT")) throw new ShadowRewindError("RESTORE_POINT_NOT_FOUND", `恢复点 ${id} 不存在`);
			throw error;
		}
		await syncDirectory(join(dir, "manifests"));
	}
	/**
	* 影子仓库丢失重建后（K1）：旧 manifest 引用的 commit 已全部死亡——
	* 整目录清除全部清单。决策语义是「重建即清」：列表不再展示内容已失、
	* 恢复必败的恢复点（与其逐个标 degraded，不如诚实清空）。
	* 跳过记录不在此列：它只是提示。
	*/
	async purgeManifests(workspace) {
		const dir = await this.workspaceDir(workspace);
		await rm(join(dir, "manifests"), {
			recursive: true,
			force: true
		});
	}
	/** 追加一条 fork 谱系（childId ↔ parentId）到工作区状态目录的
	* lineage.json。缺失/损坏按空表处理（谱系是展示性增强，不致命）；
	* 同一 (childId, parentId) 只记一次（fork 幂等）。 */
	async appendLineage(workspace, entry) {
		const dir = await this.workspaceDir(workspace);
		const existing = await this.readLineage(workspace);
		if (existing.some((item) => item.childId === entry.childId && item.parentId === entry.parentId)) return;
		existing.push(entry);
		await writeJsonAtomic(join(dir, "lineage.json"), existing);
	}
	/** 读取 fork 谱系链；缺失/损坏返回空数组（按无谱系展示）。 */
	async readLineage(workspace) {
		const dir = await this.workspaceDir(workspace);
		try {
			const raw = await readJson(join(dir, "lineage.json"));
			if (!Array.isArray(raw)) return [];
			return raw.filter((item) => typeof item === "object" && item !== null && typeof item.childId === "string" && typeof item.parentId === "string" && typeof item.time === "number");
		} catch {
			return [];
		}
	}
	/** 读上次 GC 时刻（gc.stamp，跨重启续存）；缺失/损坏返回 0（视为很久前）。 */
	async readGcStamp(workspace) {
		const dir = await this.workspaceDir(workspace);
		try {
			const raw = await readJson(join(dir, "gc.stamp"));
			return typeof raw?.lastRunAt === "number" && Number.isFinite(raw.lastRunAt) ? raw.lastRunAt : 0;
		} catch {
			return 0;
		}
	}
	/** 记录本次 GC 时刻。失败上抛由调用方静默（节流退化为每次都跑，不损正确性）。 */
	async writeGcStamp(workspace, lastRunAt) {
		const dir = await this.workspaceDir(workspace);
		await writeJsonAtomic(join(dir, "gc.stamp"), {
			version: 1,
			lastRunAt
		});
	}
	async writeTurnSkip(workspace, skip) {
		const dir = await this.workspaceDir(workspace);
		const key = sha256Hex(Buffer.from(`${skip.sessionId}\0${skip.turn}\0${skip.turnStartSeq}`, "utf8"));
		await writeJsonAtomic(join(dir, "turn-outcomes", `${key}.json`), {
			version: 1,
			...skip,
			createdAt: Date.now()
		});
	}
	async readTurnSkip(workspace, sessionId, turn, turnStartSeq) {
		const dir = await this.workspaceDir(workspace);
		const key = sha256Hex(Buffer.from(`${sessionId}\0${turn}\0${turnStartSeq}`, "utf8"));
		try {
			const value = await readJson(join(dir, "turn-outcomes", `${key}.json`));
			return typeof value.reason === "string" ? { reason: value.reason } : void 0;
		} catch (error) {
			if (isMissingStateRead(error)) return void 0;
			throw error;
		}
	}
	async deleteTurnSkip(workspace, sessionId, turn, turnStartSeq) {
		const dir = await this.workspaceDir(workspace);
		const key = sha256Hex(Buffer.from(`${sessionId}\0${turn}\0${turnStartSeq}`, "utf8"));
		try {
			await unlink(join(dir, "turn-outcomes", `${key}.json`));
		} catch (error) {
			if (!isNodeError(error, "ENOENT")) throw error;
		}
	}
	sqliteDbs = /* @__PURE__ */ new Map();
	/** 打开（或复用）工作区的快照内容库：单文件 SQLite（WAL + FULL），内容寻址。 */
	async sqliteDb(workspace) {
		const dir = await this.workspaceDir(workspace);
		let db = this.sqliteDbs.get(dir);
		if (db === void 0) {
			db = new (sqliteConstructor())(join(dir, "content.db"));
			db.exec("PRAGMA journal_mode = WAL");
			db.exec("PRAGMA synchronous = FULL");
			db.exec("CREATE TABLE IF NOT EXISTS blobs (hash TEXT PRIMARY KEY, size INTEGER NOT NULL, content BLOB NOT NULL)");
			this.sqliteDbs.set(dir, db);
		}
		return db;
	}
	/**
	* 批量写入内容寻址 blob（单事务）。
	* ponytail: 整库单文件 + 内容寻址表；天花板是「跨工作区全局去重」与
	* 「增量压缩」，需要时再加全局库或 VACUUM 策略，当前单工作区去重已够。
	*/
	async putSqliteBlobs(workspace, items) {
		if (items.length === 0) return;
		const db = await this.sqliteDb(workspace);
		const insert = db.prepare("INSERT INTO blobs (hash, size, content) VALUES (?, ?, ?) ON CONFLICT (hash) DO NOTHING");
		const select = db.prepare("SELECT content FROM blobs WHERE hash = ?");
		db.exec("BEGIN IMMEDIATE");
		let committed = false;
		try {
			for (const item of items) {
				if (!/^[0-9a-f]{64}$/.test(item.hash)) throw new ShadowRewindError("STATE_CORRUPT", `非法 blob 哈希 ${JSON.stringify(item.hash)}`);
				if (sha256Hex(item.content) !== item.hash) throw new ShadowRewindError("BLOB_HASH_MISMATCH", "内容与声明哈希不一致，拒绝写入");
				if (insert.run(item.hash, item.content.length, item.content).changes === 0) {
					const row = select.get(item.hash);
					if (row === void 0 || sha256Hex(Buffer.from(row.content)) !== item.hash) throw new ShadowRewindError("BLOB_COLLISION", `已存在的 blob ${item.hash} 与内容不符`);
				}
			}
			db.exec("COMMIT");
			committed = true;
		} finally {
			if (!committed) try {
				db.exec("ROLLBACK");
			} catch {}
		}
	}
	/** 缓存命中校验用：内容行是否确实存在于库（不读内容）。 */
	async sqliteBlobExists(workspace, hash) {
		if (!/^[0-9a-f]{64}$/.test(hash)) return false;
		return (await this.sqliteDb(workspace)).prepare("SELECT 1 AS x FROM blobs WHERE hash = ?").get(hash) !== void 0;
	}
	/** 读取并校验一个 blob。 */
	async readSqliteBlob(workspace, hash) {
		if (!/^[0-9a-f]{64}$/.test(hash)) throw new ShadowRewindError("STATE_CORRUPT", `非法 blob 哈希 ${JSON.stringify(hash)}`);
		const row = (await this.sqliteDb(workspace)).prepare("SELECT content FROM blobs WHERE hash = ?").get(hash);
		if (row === void 0) throw new ShadowRewindError("BLOB_CORRUPT", `blob ${hash} 不存在于内容库`);
		const content = Buffer.from(row.content);
		if (sha256Hex(content) !== hash) throw new ShadowRewindError("BLOB_CORRUPT", `blob ${hash} 校验失败`);
		return content;
	}
	/** 删除未被任何 manifest 引用的内容行（只统计 sqlite 后端的引用）。 */
	async collectGarbage(workspace) {
		const referenced = /* @__PURE__ */ new Set();
		for (const manifest of await this.listManifests(workspace)) for (const entry of Object.values(manifest.entries)) if (entry.kind === "file" && manifest.storage === "sqlite") referenced.add(entry.blob);
		const db = await this.sqliteDb(workspace);
		const rows = db.prepare("SELECT hash FROM blobs").all();
		const remove = db.prepare("DELETE FROM blobs WHERE hash = ?");
		let deletedBlobs = 0;
		let retainedBlobs = 0;
		for (const row of rows) {
			if (referenced.has(row.hash)) {
				retainedBlobs += 1;
				continue;
			}
			remove.run(row.hash);
			deletedBlobs += 1;
		}
		return {
			deletedBlobs,
			retainedBlobs
		};
	}
	/** 关闭全部打开的 SQLite 句柄（受控关闭/测试清理用；幂等）。 */
	async closeAll() {
		for (const [dir, db] of this.sqliteDbs) {
			this.sqliteDbs.delete(dir);
			try {
				db.close();
			} catch {}
		}
	}
	/** 状态根必须不在被管理工作区内（防自吞）。 */
	async assertStorageSeparated(workspace) {
		const storageReal = await realpathOf(this.config.storageDir);
		const workspaceReal = await realpathOf(workspace);
		if (workspaceReal === storageReal || workspaceReal.startsWith(storageReal + sepOf()) || storageReal.startsWith(workspaceReal + sepOf())) throw new ShadowRewindError("STORAGE_INSIDE_WORKSPACE", `存储目录与工作区重叠：storage=${JSON.stringify(storageReal)} workspace=${JSON.stringify(workspaceReal)}`);
	}
};
function sepOf() {
	return process.platform === "win32" ? "\\" : "/";
}
async function realpathOf(path) {
	return realpath(path);
}
function isMissingStateRead(error) {
	return error instanceof ShadowRewindError && error.code === "STATE_READ_FAILED" && error.cause instanceof Error && isNodeError(error.cause, "ENOENT");
}
let sqliteModule;
/** 探测宿主机 `node:sqlite` 是否可用（一次性开销；Node ≥22.19 自带）。 */
function sqliteAvailable() {
	if (sqliteModule === void 0) try {
		sqliteModule = createRequire(import.meta.url)("node:sqlite");
	} catch {
		sqliteModule = "missing";
	}
	return sqliteModule !== "missing";
}
/** 取 DatabaseSync 构造器；仅在 sqliteAvailable() 为真后调用。 */
function sqliteConstructor() {
	if (sqliteModule === void 0) sqliteAvailable();
	if (sqliteModule === void 0 || sqliteModule === "missing") throw new ShadowRewindError("STATE_CORRUPT", "node:sqlite 不可用，无法打开 SQLite 内容库");
	return sqliteModule.DatabaseSync;
}
//#endregion
export { WorkspaceStore, sqliteAvailable };
