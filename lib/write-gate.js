//#region src/write-gate.ts
/**
* 只读 / agent 本地工具白名单（deny-by-default 的放行面）。
* 依据本机 DSH 安装的内置工具注册名逐一核实；未知名一律拒绝，
* 保证新装的可写工具默认不会绕过闸。可用 config.writeGateAllow 扩充。
*/
const DEFAULT_READONLY_TOOLS = [
	"read",
	"read_image",
	"view",
	"glob",
	"grep",
	"web_search",
	"web_fetch",
	"todo_write",
	"ask_user_question",
	"skill",
	"get_goal",
	"job_list",
	"job_output"
];
/** 谱系上溯深度上限；防环由「访问集」保证。 */
const LINEAGE_DEPTH_CAP = 8;
/** cwd 原始串 → 规范 key 的备忘上限（每进程活跃工作区远小于此）。 */
const KEY_MEMO_CAP = 256;
var WorkspaceWriteGate = class {
	deps;
	/** 规范化工作区 key → 所有者 agent id（= 会话 id）。 */
	owners = /* @__PURE__ */ new Map();
	keyMemo = /* @__PURE__ */ new Map();
	allowSet;
	/** 拒绝裁决的总开关（运行时可翻转）；所有权登记不受它影响、永远进行。 */
	gateEnabled;
	constructor(deps, options = {}) {
		this.deps = deps;
		this.allowSet = /* @__PURE__ */ new Set([...DEFAULT_READONLY_TOOLS, ...options.allow ?? []]);
		this.gateEnabled = options.enabled ?? true;
	}
	/** 运行时翻转拒绝裁决（所有权登记照常，保证再开启时立刻有据可依）。 */
	setGate(enabled) {
		this.gateEnabled = enabled;
	}
	get isEnabled() {
		return this.gateEnabled;
	}
	/** 安装回合开始的所有权登记（与快照协调器同一瀑布，step 1 时抢占）。 */
	install(ctx) {
		ctx.on("agent/pre-step", async (data, next) => {
			if (data.step === 1) await this.claim(data.agent);
			return next();
		});
	}
	/**
	* 回合开始登记所有权。子代理（header.parentSession 存在）不登记——
	* 它们通过谱系继承父会话的权利，且绝不从父会话手里抢走工作区。
	*/
	async claim(agent) {
		const cwd = agent.session.header.cwd;
		if (cwd === void 0 || agent.session.header.parentSession !== void 0) return;
		const key = await this.keyFor(cwd);
		if (key === void 0) return;
		this.owners.set(key, agent.id);
	}
	/** 当前所有者（已做存活校验）；工作区无登记或所有者已消失时返回 undefined。 */
	async ownerOf(cwd) {
		const key = await this.keyFor(cwd);
		if (key === void 0) return void 0;
		const owner = this.owners.get(key);
		if (owner === void 0) return void 0;
		if (!this.isLive(owner)) {
			this.owners.delete(key);
			return;
		}
		return owner;
	}
	/**
	* `tools/pre-execute` 裁决：拒绝时不要调用 next（短路整个瀑布）。
	* 闸关闭时直接放行（所有权登记照常进行，保证再开启时立刻有据可依）。
	* 无法归因（无 agent / 无 cwd / 工作区无所有者）也一律放行——闸绝不挡
	* 「按定义合法」的调用，只挡明确属于旁观者的写入。
	*/
	async check(exec) {
		if (!this.gateEnabled) return { kind: "allow" };
		const agent = exec.agent;
		if (agent === void 0 || agent.session === void 0) return { kind: "allow" };
		const name = typeof exec.name === "string" && exec.name !== "" ? exec.name : "该工具";
		if (this.allowSet.has(name)) return { kind: "allow" };
		const cwd = agent.session.header.cwd;
		if (cwd === void 0) return { kind: "allow" };
		const owner = await this.ownerOf(cwd);
		if (owner === void 0) return { kind: "allow" };
		if (agent.id === owner) return { kind: "allow" };
		if (await this.lineageReaches(agent, owner)) return { kind: "allow" };
		return {
			kind: "deny",
			reason: `工作区当前由会话 ${owner} 占用（shadow-rewind 写入闸，以当前为准）：工具 ${name} 已被拒绝。请停止修改项目文件的尝试，也不要用终端命令绕过；如需写入，请让用户向本会话重新发送一条消息来取得工作区。`
		};
	}
	/** exec.agent 是否在谱系上（经 parentSession 链）连接到所有者。 */
	async lineageReaches(agent, owner) {
		let current = agent;
		const seen = /* @__PURE__ */ new Set([agent.id]);
		for (let depth = 0; depth < LINEAGE_DEPTH_CAP; depth += 1) {
			const parentId = current?.session.header.parentSession;
			if (parentId === void 0) return false;
			if (parentId === owner) return true;
			if (seen.has(parentId)) return false;
			seen.add(parentId);
			current = this.deps.sessions?.get(parentId);
			if (current === void 0) return false;
		}
		return false;
	}
	isLive(agentId) {
		const list = this.deps.agents?.list();
		if (list === void 0) return true;
		return list.some((agent) => agent.id === agentId);
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
* 在宿主上下文装配写入闸：工具瀑布的拒绝裁决。所有权登记由 install()
* 挂在 agent/pre-step（见 index.ts 的 agents 作用域注入）。
*/
function installWriteGateHost(ctx, gate) {
	ctx.effect(() => {
		const off = ctx.on("tools/pre-execute", async (execRaw, nextRaw) => {
			const decision = await gate.check(execRaw);
			if (decision.kind === "deny") return decision;
			return nextRaw();
		});
		return () => {
			off();
		};
	}, "shadow-rewind: write gate");
}
//#endregion
export { DEFAULT_READONLY_TOOLS, WorkspaceWriteGate, installWriteGateHost };
