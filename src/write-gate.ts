/**
 * 写入闸（方案 G，「以当前为准」）：同一工作区任一时刻只允许一个会话写入。
 *
 * 所有权规则：最近一次回合开始（= 用户最近发消息）的顶层会话拥有工作区。
 * 工具瀑布 `tools/pre-execute` 上，非所有者会话的调用按「拒绝为默认」裁决：
 * 只放行白名单里的只读/agent 本地工具，其余（文件写入、bash/pwsh、run_code、
 * 子代理派生等）一律返回 {kind:'deny'} 并附可行动的理由；读取类工具永远放行。
 * 子代理通过会话头的 parentSession 谱系继承父会话的所有权，因此所有者的
 * 子代理照常工作；子代理自身的回合开始不改变所有权。
 *
 * 与恢复的配合：占用闸据此放宽——运行中的旁观者已被拒绝写入，恢复只需等待
 * 「请求者自身」与「当前所有者」空闲（见 rewind-host 的 partitionRunningSessions）。
 * 闸的边界：只管 DSH 工具调用；外部编辑器与系统进程不受限（README 说明）。
 */
import type { HostContext, PreStepData, AgentFace } from './rewind-host.js'

/** 闸看到的最小会话头（runtime 会在 header 上附带 parentSession）。 */
export interface GateAgentHeader {
  readonly cwd?: string
  readonly parentSession?: string
}

/** 闸看到的最小 agent 面（结构类型，兼容 Agent / AgentFace）。 */
export interface GateAgentFace {
  readonly id: string
  readonly session: { readonly header: GateAgentHeader }
}

/** `tools/pre-execute` 瀑布参数的运行时形状（只消费用到的字段）。 */
export interface ToolExecLike {
  readonly name?: unknown
  readonly agent?: GateAgentFace | undefined
}

/** 闸的裁决（与宿主 PreToolDecision 同构）。 */
export type GateDecision = { readonly kind: 'allow' } | { readonly kind: 'deny'; readonly reason: string }

export interface WriteGateDeps {
  /** 工作区 key 规范化（realpath）；失败返回 undefined（无法归因则放行）。 */
  readonly canonicalDirectory: (path: string) => Promise<string | undefined>
  /** 存活会话查找（谱系上溯用）；缺省时谱系只看 exec.agent 自身的 header。 */
  readonly sessions?: { get(sessionId: string): GateAgentFace | undefined }
  /** 存活 agent 列表（所有者消失检测）；缺省时所有者视为一直存活。 */
  readonly agents?: { list(): readonly GateAgentFace[] }
  readonly logger?: { warn(message: string): void }
}

export interface WriteGateOptions {
  /** 初始开关（config.writeGate）；运行时可经 HTTP 端点翻转。 */
  readonly enabled?: boolean
  /** 在只读白名单之外额外放行的工具名。 */
  readonly allow?: readonly string[]
}

/**
 * 只读 / agent 本地工具白名单（deny-by-default 的放行面）。
 * 依据本机 DSH 安装的内置工具注册名逐一核实；未知名一律拒绝，
 * 保证新装的可写工具默认不会绕过闸。可用 config.writeGateAllow 扩充。
 */
export const DEFAULT_READONLY_TOOLS: readonly string[] = [
  // dsh-tool-fs / dsh-tool-str-replace-editor 的读取面
  'read', 'read_image', 'view',
  // dsh-tool-fs-search
  'glob', 'grep',
  // dsh-tool-web
  'web_search', 'web_fetch',
  // agent 本地状态与交互
  'todo_write', 'ask_user_question', 'skill', 'get_goal',
  // 作业只读面
  'job_list', 'job_output',
]

/** 谱系上溯深度上限；防环由「访问集」保证。 */
const LINEAGE_DEPTH_CAP = 8

/** cwd 原始串 → 规范 key 的备忘上限（每进程活跃工作区远小于此）。 */
const KEY_MEMO_CAP = 256

export class WorkspaceWriteGate {
  /** 规范化工作区 key → 所有者 agent id（= 会话 id）。 */
  private readonly owners = new Map<string, string>()
  private readonly keyMemo = new Map<string, string>()
  private readonly allowSet: ReadonlySet<string>
  /** 拒绝裁决的总开关（运行时可翻转）；所有权登记不受它影响、永远进行。 */
  private gateEnabled: boolean

  constructor(
    private readonly deps: WriteGateDeps,
    options: WriteGateOptions = {},
  ) {
    this.allowSet = new Set([...DEFAULT_READONLY_TOOLS, ...(options.allow ?? [])])
    this.gateEnabled = options.enabled ?? true
  }

  /** 运行时翻转拒绝裁决（所有权登记照常，保证再开启时立刻有据可依）。 */
  setGate(enabled: boolean): void {
    this.gateEnabled = enabled
  }

  get isEnabled(): boolean {
    return this.gateEnabled
  }

  /** 安装回合开始的所有权登记（与快照协调器同一瀑布，step 1 时抢占）。 */
  install(ctx: HostContext): void {
    ctx.on('agent/pre-step', async (data: PreStepData, next: () => Promise<unknown>) => {
      if (data.step === 1) await this.claim(data.agent as AgentFace)
      return next()
    })
  }

  /**
   * 回合开始登记所有权。子代理（header.parentSession 存在）不登记——
   * 它们通过谱系继承父会话的权利，且绝不从父会话手里抢走工作区。
   */
  async claim(agent: GateAgentFace): Promise<void> {
    const cwd = agent.session.header.cwd
    if (cwd === undefined || agent.session.header.parentSession !== undefined) return
    const key = await this.keyFor(cwd)
    if (key === undefined) return
    this.owners.set(key, agent.id)
  }

  /** 当前所有者（已做存活校验）；工作区无登记或所有者已消失时返回 undefined。 */
  async ownerOf(cwd: string): Promise<string | undefined> {
    const key = await this.keyFor(cwd)
    if (key === undefined) return undefined
    const owner = this.owners.get(key)
    if (owner === undefined) return undefined
    if (!this.isLive(owner)) {
      this.owners.delete(key)
      return undefined
    }
    return owner
  }

  /**
   * `tools/pre-execute` 裁决：拒绝时不要调用 next（短路整个瀑布）。
   * 闸关闭时直接放行（所有权登记照常进行，保证再开启时立刻有据可依）。
   * 无法归因（无 agent / 无 cwd / 工作区无所有者）也一律放行——闸绝不挡
   * 「按定义合法」的调用，只挡明确属于旁观者的写入。
   */
  async check(exec: ToolExecLike): Promise<GateDecision> {
    if (!this.gateEnabled) return { kind: 'allow' }
    const agent = exec.agent
    if (agent === undefined || agent.session === undefined) return { kind: 'allow' }
    const name = typeof exec.name === 'string' && exec.name !== '' ? exec.name : '该工具'
    if (this.allowSet.has(name)) return { kind: 'allow' }
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return { kind: 'allow' }
    const owner = await this.ownerOf(cwd)
    if (owner === undefined) return { kind: 'allow' }
    if (agent.id === owner) return { kind: 'allow' }
    if (await this.lineageReaches(agent, owner)) return { kind: 'allow' }
    return {
      kind: 'deny',
      reason: `工作区当前由会话 ${owner} 占用（shadow-rewind 写入闸，以当前为准）：工具 ${name} 已被拒绝。`
        + '请停止修改项目文件的尝试，也不要用终端命令绕过；如需写入，请让用户向本会话重新发送一条消息来取得工作区。',
    }
  }

  /** exec.agent 是否在谱系上（经 parentSession 链）连接到所有者。 */
  private async lineageReaches(agent: GateAgentFace, owner: string): Promise<boolean> {
    let current: GateAgentFace | undefined = agent
    const seen = new Set<string>([agent.id])
    for (let depth = 0; depth < LINEAGE_DEPTH_CAP; depth += 1) {
      const parentId: string | undefined = current?.session.header.parentSession
      if (parentId === undefined) return false
      if (parentId === owner) return true
      if (seen.has(parentId)) return false
      seen.add(parentId)
      current = this.deps.sessions?.get(parentId)
      if (current === undefined) return false
    }
    return false
  }

  private isLive(agentId: string): boolean {
    const list = this.deps.agents?.list()
    if (list === undefined) return true
    return list.some(agent => agent.id === agentId)
  }

  private async keyFor(cwd: string): Promise<string | undefined> {
    const memoed = this.keyMemo.get(cwd)
    if (memoed !== undefined) return memoed
    const key = await this.deps.canonicalDirectory(cwd)
    if (key === undefined) return undefined
    if (this.keyMemo.size >= KEY_MEMO_CAP) {
      const oldest = this.keyMemo.keys().next().value
      if (oldest !== undefined) this.keyMemo.delete(oldest)
    }
    this.keyMemo.set(cwd, key)
    return key
  }
}

/**
 * 在宿主上下文装配写入闸：工具瀑布的拒绝裁决。所有权登记由 install()
 * 挂在 agent/pre-step（见 index.ts 的 agents 作用域注入）。
 */
export function installWriteGateHost(
  ctx: {
    effect(dispose: () => void, label?: string): void
    on(event: string, listener: (exec: unknown, next: unknown) => unknown): () => void
  },
  gate: WorkspaceWriteGate,
): void {
  // 'tools/pre-execute' 位于宿主工具注册表的 Cordis 事件表（dsh-tools 的
  // 调度瀑布：pre-execute → execute → post-execute），宽松 emitter 转型与
  // 录制器（host.ts）同一模式。ctx.effect 拥有注册生命周期。
  ctx.effect(() => {
    const off = ctx.on('tools/pre-execute', async (execRaw: unknown, nextRaw: unknown) => {
      const decision = await gate.check(execRaw as ToolExecLike)
      if (decision.kind === 'deny') return decision
      return (nextRaw as () => Promise<unknown>)()
    })
    return () => { off() }
  }, 'shadow-rewind: write gate')
}
