import { walkParentLineage } from "./write-gate.js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
//#region src/command-windows.ts
/**
* 命令窗口注册表（写盘归因）：记录每次工具调用的执行墙钟窗口
* `[startedAt, endedAt]`，让检查点窗口内的终端写盘能用「何时」（文件
* mtime，已随快照落盘）关联到「哪条命令、哪个会话」。
*
* 数据来源与边界：
*   - 录制器挂在 `tools/execute` around-dispatch 瀑布上包住 `next()` 打起止戳——
*     该瀑布的终端即工具体本身（宿主 dispatchToolBody），`next()` resolve 即
*     体执行完毕（`tools/pre-execute` 阶段只作放行裁决，体尚未运行，不可测时）；
*     被拒绝的调用（写入闸/守卫裁决）在 prepare 阶段终止，从不进入 dispatch，
*     自然不记录；信号已中止的调用在体前短路，同样不记录；
*     `next()` 抛错仍记录（保守召回：工具可能在抛错前已写盘）；
*   - 子代理的调用经 parentSession 谱系解析到顶层会话（与写入闸共用
*     谱系行走），归因落在用户可见的会话上；
*   - 缺 agent / 缺 cwd 的调用静默跳过——注册表只增强归因，绝不
*     影响工具执行本身。
*
* 持久化：窗口随防抖原子写落盘到 <storageDir>/command-windows/（懒加载 +
* 加载期缓冲，仿 file-review/recorded 模式），宿主重启后归因不降级；存储
* 目录缺省时保持纯内存。硬杀进程至多丢未落盘的防抖窗口（防抖时长内的
* 最近写入），归因优雅降级为窗口级（「何时」经快照里的 mtime 仍完整，
* 仅「哪条命令」不可知）。落盘内容为会话/工具名/时间戳，外加可选的
* 窗口内容（工具参数的截断序列化，见 COMMAND_WINDOW_DEFAULTS.detailBytes），
* 不含文件路径。对外接口（record / windowsOverlapping）不因持久化而变。
*/
/** 注册表可调参数的缺省值（单一事实源；插件配置解析从这里取默认）。 */
const COMMAND_WINDOW_DEFAULTS = {
	/** 落盘防抖（毫秒）；工具调用成簇到达，与 file-review 录制同量级。 */
	flushMs: 400,
	/** 保留期：超出即修剪（归因查询只跨检查点窗口，6h 足够宽裕）。 */
	retentionMs: 216e5,
	/** 每工作区条目上限：高频短命令下的防泄漏阀（修剪保留最新）。 */
	maxPerWorkspace: 2e3,
	/** 单窗口记录的工具参数序列化字节上限；0 = 不记录内容。 */
	detailBytes: 2048
};
/** cwd 原始串 → 规范 key 的备忘上限（与写入闸同量级）。 */
const KEY_MEMO_CAP = 256;
/** 持久化格式版本；读取方拒绝其它版本（视为损坏，从空开始）。 */
const WINDOWS_VERSION = 1;
/** 单条窗口的落盘形状守卫（损坏文件里可能混入任意条目）。 */
function isCommandWindow(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const candidate = value;
	return typeof candidate.sessionId === "string" && typeof candidate.agentId === "string" && typeof candidate.tool === "string" && (candidate.callId === void 0 || typeof candidate.callId === "string") && (candidate.detail === void 0 || typeof candidate.detail === "string") && typeof candidate.startedAt === "number" && typeof candidate.endedAt === "number";
}
/** 保留期 + 上限修剪（保留最新）。 */
function capWindows(list, cutoff, maxWindows) {
	const kept = list.filter((entry) => entry.endedAt >= cutoff);
	return kept.length > maxWindows ? kept.slice(kept.length - maxWindows) : kept;
}
/** 窗口文件名：可读前缀 + 工作区 key 的 16 位哈希，避免非法路径字符与碰撞。 */
function windowsFilename(workspaceKey) {
	const hash = createHash("sha256").update(workspaceKey, "utf8").digest("hex").slice(0, 16);
	const stem = workspaceKey.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 40);
	return `${stem === "" ? "workspace" : stem}-${hash}.json`;
}
/** 命令窗口注册表（可选持久化，见模块注释；接口不因持久化而变）。 */
var CommandWindowRegistry = class {
	deps;
	/** 规范化工作区 key → 按时间顺序的窗口列表。 */
	windows = /* @__PURE__ */ new Map();
	keyMemo = /* @__PURE__ */ new Map();
	/** 持久化目录；undefined = 纯内存。 */
	windowsDir;
	flushMs;
	retentionMs;
	maxWindows;
	detailBytes;
	/** 已完成懒加载的工作区（此后记录直写 windows 并调度落盘）。 */
	loaded = /* @__PURE__ */ new Set();
	/** 进行中的懒加载任务（保证同 key 只读一次盘）。 */
	loading = /* @__PURE__ */ new Map();
	/** 懒加载完成前到达的记录缓冲；加载完成后按「磁盘在前、缓冲在后」合并。 */
	preLoad = /* @__PURE__ */ new Map();
	/** 每工作区的落盘防抖定时器（前沿触发，不重置）。 */
	flushTimers = /* @__PURE__ */ new Map();
	/** 每工作区的串行化落盘链（防抖触发可能晚于前一次写入）。 */
	flushChains = /* @__PURE__ */ new Map();
	constructor(deps) {
		this.deps = deps;
		this.windowsDir = deps.storageDir !== void 0 && deps.storageDir.trim() !== "" ? join(deps.storageDir, "command-windows") : void 0;
		this.flushMs = deps.flushMs ?? COMMAND_WINDOW_DEFAULTS.flushMs;
		this.retentionMs = deps.retentionMs ?? COMMAND_WINDOW_DEFAULTS.retentionMs;
		this.maxWindows = deps.maxPerWorkspace ?? COMMAND_WINDOW_DEFAULTS.maxPerWorkspace;
		this.detailBytes = deps.detailBytes ?? COMMAND_WINDOW_DEFAULTS.detailBytes;
	}
	/** 把工具参数序列化为窗口内容（按 detailBytes 截断；0 = 不记录内容）。
	* 宿主契约保证参数 JSON 可序列化，仍防御性兜底：失败即无内容，绝不
	* 影响记录本身。截断可能切断多字节字符（解码器以替换符容错）。 */
	captureDetail(args) {
		if (this.detailBytes <= 0 || args === void 0) return void 0;
		try {
			const text = JSON.stringify(args);
			if (text === void 0) return void 0;
			if (Buffer.byteLength(text, "utf8") <= this.detailBytes) return text;
			return Buffer.from(text, "utf8").subarray(0, this.detailBytes).toString("utf8");
		} catch {
			return;
		}
	}
	/** 记录一个已闭合的窗口（顺带修剪：过期条目 + 超量保留最新）。 */
	async record(cwd, window) {
		const key = await this.keyFor(cwd);
		if (key === void 0) return;
		if (!this.loaded.has(key)) {
			const buffered = this.preLoad.get(key) ?? [];
			buffered.push(window);
			this.preLoad.set(key, buffered);
			this.ensureLoaded(key);
			return;
		}
		this.pushWindow(key, window);
		this.scheduleFlush(key);
	}
	/** 与 [startMs, endMs]（闭区间）相交的全部窗口，按记录顺序。 */
	async windowsOverlapping(cwd, startMs, endMs) {
		const key = await this.keyFor(cwd);
		if (key === void 0) return [];
		await this.ensureLoaded(key);
		return (this.windows.get(key) ?? []).filter((entry) => entry.startedAt <= endMs && entry.endedAt >= startMs);
	}
	/** 立即冲刷未落盘的工作区（宿主关停时调用，防止防抖窗口内的记录随重启丢失）。 */
	async flushPending() {
		if (this.windowsDir === void 0) return;
		await Promise.all([...this.loading.values()]);
		const keys = [...this.flushTimers.keys()];
		for (const key of keys) {
			const timer = this.flushTimers.get(key);
			if (timer !== void 0) clearTimeout(timer);
			this.flushTimers.delete(key);
			this.chainFlush(key);
		}
		await Promise.all([...this.flushChains.values()]);
	}
	pushWindow(key, window) {
		const cutoff = window.endedAt - this.retentionMs;
		const kept = (this.windows.get(key) ?? []).filter((entry) => entry.endedAt >= cutoff);
		kept.push(window);
		this.windows.set(key, kept.length > this.maxWindows ? kept.slice(kept.length - this.maxWindows) : kept);
	}
	ensureLoaded(key) {
		if (this.loaded.has(key)) return Promise.resolve();
		const existing = this.loading.get(key);
		if (existing !== void 0) return existing;
		const task = this.loadFromDisk(key).finally(() => {
			this.loading.delete(key);
		});
		this.loading.set(key, task);
		return task;
	}
	async loadFromDisk(key) {
		try {
			if (this.windowsDir === void 0) return;
			let raw;
			try {
				raw = await readFile(join(this.windowsDir, windowsFilename(key)), "utf8");
			} catch {
				return;
			}
			const parsed = JSON.parse(raw);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
			const record = parsed;
			if (record.version !== WINDOWS_VERSION || !Array.isArray(record.windows)) return;
			const disk = [];
			for (const entry of record.windows) if (isCommandWindow(entry)) disk.push(entry);
			this.windows.set(key, capWindows(disk, Date.now() - this.retentionMs, this.maxWindows));
		} catch {} finally {
			this.loaded.add(key);
			const remaining = this.preLoad.get(key);
			if (remaining !== void 0) {
				this.preLoad.delete(key);
				for (const window of remaining) this.pushWindow(key, window);
				this.scheduleFlush(key);
			}
		}
	}
	scheduleFlush(key) {
		if (this.windowsDir === void 0 || this.flushTimers.has(key)) return;
		const timer = setTimeout(() => {
			this.flushTimers.delete(key);
			this.chainFlush(key);
		}, this.flushMs);
		timer.unref?.();
		this.flushTimers.set(key, timer);
	}
	chainFlush(key) {
		const next = (this.flushChains.get(key) ?? Promise.resolve()).then(() => this.writeWindows(key)).catch(() => {});
		this.flushChains.set(key, next);
	}
	async writeWindows(key) {
		await this.ensureLoaded(key);
		if (this.windowsDir === void 0) return;
		const list = this.windows.get(key) ?? [];
		const text = JSON.stringify({
			version: WINDOWS_VERSION,
			windows: list
		});
		await writeFileAtomic(join(this.windowsDir, windowsFilename(key)), text, { mode: 384 });
	}
	async keyFor(cwd) {
		const memoed = this.keyMemo.get(cwd);
		if (memoed !== void 0) return memoed;
		const key = await this.deps.canonicalDirectory(cwd);
		if (key === void 0) return void 0;
		if (this.keyMemo.size >= KEY_MEMO_CAP) {
			const oldest = this.keyMemo.keys().next().value;
			if (oldest !== void 0) this.keyMemo.delete(oldest);
		}
		this.keyMemo.set(cwd, key);
		return key;
	}
};
/**
* 解析调用所属的顶层会话：沿 parentSession 上溯到无父为止（深度上限与
* 防环内置）。断链/环/超深时停在最深已声明祖先（header 指名的父会话，
* 即使它已不可解析）——归因宁模糊不错，绝不把子代理误当顶层会话。
*/
function topLevelSessionOf(agent, sessions) {
	let top = agent.id;
	walkParentLineage(agent.session.header, (parentId) => sessions?.get(parentId)?.session.header, (parentId) => {
		top = parentId;
		return true;
	}, [agent.id]);
	return top;
}
/** 瀑布返回值是否为拒绝裁决（裁决形短路 = 工具未执行，无窗口可言）。 */
function isDenyDecision(value) {
	return typeof value === "object" && value !== null && value.kind === "deny";
}
/**
* 在宿主上下文装配命令窗口录制器：`tools/execute` around-dispatch 瀑布包住
* `next()` 打起止戳——该瀑布的终端即工具体本身，测得的是体的真实墙钟
* （`tools/pre-execute` 阶段体尚未运行，测时只能挂这里）；装配模式与写入闸
* 的 installWriteGateHost 相同。被闸拒绝的调用在 prepare 阶段终止、从不进入
* dispatch，自然不记录；裁决形检查是上游 around-dispatch 监听器以裁决短路
* 代替执行的兜底。
*
* @param sessions - 惰性读取的会话查找面（注入完成前为 undefined，谱系
* 上溯停止、子代理归于自身——与写入闸同一降级语义）。
*/
function installCommandWindowRecorder(ctx, registry, sessions) {
	ctx.effect(() => {
		const off = ctx.on("tools/execute", async (execRaw, nextRaw) => {
			const exec = execRaw;
			if (exec?.signal?.aborted === true) return nextRaw();
			const agent = exec?.agent;
			const cwd = agent?.session?.header?.cwd;
			const startedAt = Date.now();
			const recordWindow = async () => {
				if (agent === void 0 || cwd === void 0) return;
				const tool = typeof exec.name === "string" && exec.name !== "" ? exec.name : "unknown";
				const callId = typeof exec.callId === "string" && exec.callId !== "" ? exec.callId : void 0;
				const detail = registry.captureDetail(exec.arguments);
				await registry.record(cwd, {
					sessionId: topLevelSessionOf(agent, sessions?.()),
					agentId: agent.id,
					tool,
					...callId === void 0 ? {} : { callId },
					...detail === void 0 ? {} : { detail },
					startedAt,
					endedAt: Date.now()
				});
			};
			let result;
			try {
				result = await nextRaw();
			} catch (error) {
				await recordWindow();
				throw error;
			}
			if (!isDenyDecision(result)) await recordWindow();
			return result;
		});
		return () => {
			off();
			registry.flushPending();
		};
	}, "shadow-rewind: command windows");
}
//#endregion
export { COMMAND_WINDOW_DEFAULTS, CommandWindowRegistry, installCommandWindowRecorder, topLevelSessionOf };
