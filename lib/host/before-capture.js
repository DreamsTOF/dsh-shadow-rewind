import { errorMessage } from "../errors.js";
import { canonicalDirectory } from "../path-utils.js";
import { lstat, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
//#region src/host/before-capture.ts
/**
* 宿主适配层·BEFORE 捕获管道（主路捕获，抄 dsh-rewind 的 checkpoint 管道）。
*
* 三个钩子（与文件审查半边的 ptc 录制器同一张 cordis 事件表）：
*  1. `tools/execute`（around-dispatch）：写类工具执行**前**读目标文件全文，
*     存入 pending——放 here 而非 pre-execute：审批 ask 短路不会跳过本钩子，
*     被拒绝的调用不会 dispatch（不留悬挂 pending）；
*  2. `tools/post-execute`：工具成功（!result.isError 且未被否决）后提交，
*     锚定到当前回合最新的 user/message seq；
*  3. `tools/result`：兜底清理（工具体 throw 时 post-execute 可能被跳过）。
*
* 外加 `session/event`（global）的 user/message 边界重查：外部编辑/删除
* （写类捕获的盲区）在每条用户消息落盘时补录 BEFORE。
*
* 与 dsh-rewind 的差异：内容走 shadow-rewind 引擎的 BEFORE 日志（内联 JSON，
* 物化时才入 sqlite 内容库），路径解析用 node:fs + canonicalDirectory
* （不引入 dsh-fs / dsh-sandbox 依赖）；子代理会话一律跳过。
*/
/** 只跟踪真实的文件修改工具（同 dsh-rewind 白名单）。 */
const TRACKED_TOOLS = /* @__PURE__ */ new Set([
	"write",
	"edit",
	"str_replace_editor"
]);
/** str_replace_editor 的变更型命令（view 等只读命令不跟踪）。 */
const MUTATING_EDITOR_COMMANDS = /* @__PURE__ */ new Set([
	"create",
	"str_replace",
	"insert"
]);
/** 从工具参数解析目标路径（字段名随工具名分叉，同 dsh-rewind mutationPathOf）。 */
function mutationPathOf(exec) {
	const args = exec.arguments ?? {};
	if (exec.name === "write" || exec.name === "edit") return typeof args.file_path === "string" && args.file_path !== "" ? args.file_path : void 0;
	if (exec.name === "str_replace_editor") {
		if (typeof args.command !== "string" || !MUTATING_EDITOR_COMMANDS.has(args.command)) return void 0;
		return typeof args.path === "string" && args.path !== "" ? args.path : void 0;
	}
}
/** 子代理会话不跟踪（对齐 Claude Code；宿主恢复围栏也只按主会话工作区）。 */
function isSubagent(header) {
	return header !== void 0 && (header.origin === "subagent" || (header.delegationDepth ?? 0) > 0);
}
function anchorSeqOf(session, cache) {
	const events = session?.snapshotEvents?.();
	if (events === void 0) return void 0;
	const cached = cache.get(session);
	if (cached !== void 0 && cached.eventsLength === events.length) return cached.anchor;
	let anchor = cached?.anchor;
	for (let i = events.length - 1; i >= (cached?.eventsLength ?? 0); i--) {
		const event = events[i];
		if (event !== void 0 && event.type === "user/message") {
			anchor = event.seq;
			break;
		}
	}
	cache.set(session, {
		anchor,
		eventsLength: events.length
	});
	return anchor;
}
function pendingKey(exec) {
	return `${exec.agent?.id ?? "anon"}:${exec.callId}`;
}
/**
* 装配 BEFORE 捕获管道。幂等性由调用方（插件入口的一次性 apply）保证。
* 捕获/提交的任何失败都只记警告、绝不拦截工具执行——捕获是尽力而为的
* 安全网，不是工具的前置闸。
*/
function installBeforeCapture(ctx, engine) {
	const pending = /* @__PURE__ */ new Map();
	const anchorCache = /* @__PURE__ */ new WeakMap();
	const workspaceCache = /* @__PURE__ */ new Map();
	/** 会话工作区（canonical realpath，与引擎 manifest 的路径空间一致）。 */
	const workspaceOf = async (session) => {
		const sessionId = session?.id;
		if (sessionId === void 0) return void 0;
		const cached = workspaceCache.get(sessionId);
		if (cached !== void 0) return cached;
		const cwd = session?.header?.cwd;
		if (cwd === void 0) {
			workspaceCache.set(sessionId, void 0);
			return;
		}
		const workspace = await canonicalDirectory(cwd).catch(() => void 0);
		workspaceCache.set(sessionId, workspace);
		return workspace;
	};
	const captureBefore = async (exec) => {
		if (!TRACKED_TOOLS.has(exec.name)) return;
		const session = exec.agent?.session;
		if (isSubagent(session?.header)) return;
		const rawPath = mutationPathOf(exec);
		if (rawPath === void 0) return;
		const workspace = await workspaceOf(session);
		if (workspace === void 0) return;
		const abs = isAbsolute(rawPath) ? rawPath : resolve(workspace, rawPath);
		const rel = relative(workspace, abs).split(sep).join("/");
		if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return;
		let existed = true;
		let content = null;
		let mode = 420;
		try {
			const stat = await lstat(abs);
			if (!stat.isFile()) return;
			mode = Number(stat.mode & 4095);
			content = await readFile(abs, "utf8");
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return;
			existed = false;
		}
		pending.set(pendingKey(exec), {
			rel,
			existed,
			content,
			mode
		});
	};
	const commitEntry = async (exec, result) => {
		const key = pendingKey(exec);
		const capture = pending.get(key);
		pending.delete(key);
		if (capture === void 0) return;
		if (result?.isError === true) return;
		const session = exec.agent?.session;
		if (session === void 0) return;
		const anchorSeq = anchorSeqOf(session, anchorCache);
		if (anchorSeq === void 0 || !Number.isSafeInteger(anchorSeq)) return;
		const workspace = await workspaceOf(session);
		if (workspace === void 0) return;
		await engine.recordBeforeEntry({
			workspace,
			sessionId: session.id,
			anchorSeq,
			callId: exec.callId,
			rel: capture.rel,
			existed: capture.existed,
			content: capture.content,
			mode: capture.mode
		});
	};
	const emitter = ctx;
	const warn = (message) => {
		try {
			emitter.logger?.warn?.(message);
		} catch {}
	};
	emitter.on("tools/execute", async (exec, next) => {
		try {
			await captureBefore(exec);
		} catch (error) {
			warn(`[dsh-shadow-rewind] before-capture failed for ${exec.name}: ${errorMessage(error)}`);
		}
		return next();
	});
	emitter.on("tools/post-execute", async (exec, result, next) => {
		const decision = await next();
		if (decision.kind !== "accept") return decision;
		try {
			await commitEntry(exec, result);
		} catch (error) {
			warn(`[dsh-shadow-rewind] before-capture commit failed for ${exec.name}: ${errorMessage(error)}`);
		}
		return decision;
	});
	emitter.on("tools/result", (exec) => {
		pending.delete(pendingKey(exec));
	});
	emitter.on("session/event", (session, event) => {
		if (event?.type !== "user/message") return;
		if (isSubagent(session?.header)) return;
		const sessionId = session?.id;
		if (sessionId === void 0) return;
		(async () => {
			try {
				const workspace = await workspaceOf(session);
				if (workspace === void 0) return;
				await engine.reconcileTrackedBefore({
					workspace,
					sessionId,
					anchorSeq: event.seq
				});
			} catch (error) {
				warn(`[dsh-shadow-rewind] boundary re-check failed: ${errorMessage(error)}`);
			}
		})();
	}, { global: true });
}
//#endregion
export { installBeforeCapture };
