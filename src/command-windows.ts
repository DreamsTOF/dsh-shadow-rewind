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
 * ponytail: 纯内存是明确的天花板——每工作区保留期 6 小时、上限 2000 条，
 * 宿主重启后历史窗口丢失，归因优雅降级为窗口级（「何时」经快照里的
 * mtime 仍完整，仅「哪条命令」不可知）。持久化升级路径：对外接口
 * （record / windowsOverlapping）不变，届时仿 file-review/recorded 的
 * 防抖原子写模式落盘。
 */
import { walkParentLineage } from './write-gate.js'
import type { GateAgentFace } from './write-gate.js'

/** 一次工具调用的执行墙钟窗口（归因单元）。 */
export interface CommandWindow {
  /** 调用所属的顶层会话 id（子代理已沿谱系上溯解析）。 */
  readonly sessionId: string
  /** 实际发起调用的 agent id（可能是子代理）。 */
  readonly agentId: string
  readonly tool: string
  /** 防御性记录（供未来定位到具体调用）；归因正确性不依赖它。 */
  readonly callId?: string
  readonly startedAt: number
  readonly endedAt: number
}

/** 保留期：超出即修剪（归因查询只跨检查点窗口，6h 足够宽裕）。 */
const RETENTION_MS = 6 * 60 * 60 * 1000
/** 每工作区条目上限：高频短命令下的防泄漏阀（修剪保留最新）。 */
const MAX_WINDOWS_PER_WORKSPACE = 2000

/** cwd 原始串 → 规范 key 的备忘上限（与写入闸同量级）。 */
const KEY_MEMO_CAP = 256

export interface CommandWindowRegistryDeps {
  /** 工作区 key 规范化（realpath）；失败返回 undefined（静默跳过）。 */
  readonly canonicalDirectory: (path: string) => Promise<string | undefined>
}

/** 纯内存命令窗口注册表（见模块注释的天花板与升级路径）。 */
export class CommandWindowRegistry {
  /** 规范化工作区 key → 按时间顺序的窗口列表。 */
  private readonly windows = new Map<string, CommandWindow[]>()
  private readonly keyMemo = new Map<string, string>()

  constructor(private readonly deps: CommandWindowRegistryDeps) {}

  /** 记录一个已闭合的窗口（顺带修剪：过期条目 + 超量保留最新）。 */
  async record(cwd: string, window: CommandWindow): Promise<void> {
    const key = await this.keyFor(cwd)
    if (key === undefined) return
    const cutoff = window.endedAt - RETENTION_MS
    const kept = (this.windows.get(key) ?? []).filter(entry => entry.endedAt >= cutoff)
    kept.push(window)
    this.windows.set(key, kept.length > MAX_WINDOWS_PER_WORKSPACE
      ? kept.slice(kept.length - MAX_WINDOWS_PER_WORKSPACE)
      : kept)
  }

  /** 与 [startMs, endMs]（闭区间）相交的全部窗口，按记录顺序。 */
  async windowsOverlapping(cwd: string, startMs: number, endMs: number): Promise<readonly CommandWindow[]> {
    const key = await this.keyFor(cwd)
    if (key === undefined) return []
    return (this.windows.get(key) ?? []).filter(entry => entry.startedAt <= endMs && entry.endedAt >= startMs)
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
 * 解析调用所属的顶层会话：沿 parentSession 上溯到无父为止（深度上限与
 * 防环内置）。断链/环/超深时停在最深已声明祖先（header 指名的父会话，
 * 即使它已不可解析）——归因宁模糊不错，绝不把子代理误当顶层会话。
 */
export function topLevelSessionOf(
  agent: GateAgentFace,
  sessions: { get(sessionId: string): GateAgentFace | undefined } | undefined,
): string {
  let top = agent.id
  walkParentLineage(
    agent.session.header,
    (parentId) => sessions?.get(parentId)?.session.header,
    (parentId) => {
      top = parentId
      return true
    },
    [agent.id],
  )
  return top
}

/** `tools/execute` 瀑布参数的运行时形状（只消费用到的字段）。 */
interface RecorderToolExec {
  readonly name?: unknown
  readonly callId?: unknown
  readonly agent?: GateAgentFace | undefined
  /** 已中止的信号 ⇒ 工具体在执行前短路（宿主 dispatchToolBody），无执行窗口。 */
  readonly signal?: { readonly aborted?: boolean }
}

/** 瀑布返回值是否为拒绝裁决（裁决形短路 = 工具未执行，无窗口可言）。 */
function isDenyDecision(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'deny'
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
export function installCommandWindowRecorder(
  ctx: {
    effect(dispose: () => void, label?: string): void
    on(event: string, listener: (exec: unknown, next: unknown) => unknown): () => void
  },
  registry: CommandWindowRegistry,
  sessions?: () => { get(sessionId: string): GateAgentFace | undefined } | undefined,
): void {
  ctx.effect(() => {
    const off = ctx.on('tools/execute', async (execRaw: unknown, nextRaw: unknown) => {
      const exec = execRaw as RecorderToolExec
      // 信号已中止的调用在工具体前短路（宿主 dispatchToolBody），无执行窗口。
      if (exec?.signal?.aborted === true) return (nextRaw as () => Promise<unknown>)()
      const agent = exec?.agent
      const cwd = agent?.session?.header?.cwd
      const startedAt = Date.now()
      const recordWindow = async (): Promise<void> => {
        if (agent === undefined || cwd === undefined) return
        const tool = typeof exec.name === 'string' && exec.name !== '' ? exec.name : 'unknown'
        const callId = typeof exec.callId === 'string' && exec.callId !== '' ? exec.callId : undefined
        await registry.record(cwd, {
          sessionId: topLevelSessionOf(agent, sessions?.()),
          agentId: agent.id,
          tool,
          ...(callId === undefined ? {} : { callId }),
          startedAt,
          endedAt: Date.now(),
        })
      }
      let result: unknown
      try {
        result = await (nextRaw as () => Promise<unknown>)()
      } catch (error) {
        // 抛错仍记录（保守召回：工具可能在失败前已写盘）。
        await recordWindow()
        throw error
      }
      if (!isDenyDecision(result)) await recordWindow()
      return result
    })
    return () => { off() }
  }, 'shadow-rewind: command windows')
}
