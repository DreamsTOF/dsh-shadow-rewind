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
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
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
  /** 工具参数的截断序列化（如终端命令文本）；纯展示线索，归因不依赖它。 */
  readonly detail?: string
  readonly startedAt: number
  readonly endedAt: number
}

/** 注册表可调参数的缺省值（单一事实源；插件配置解析从这里取默认）。 */
export const COMMAND_WINDOW_DEFAULTS = {
  /** 落盘防抖（毫秒）；工具调用成簇到达，与 file-review 录制同量级。 */
  flushMs: 400,
  /** 保留期：超出即修剪（归因查询只跨检查点窗口，6h 足够宽裕）。 */
  retentionMs: 6 * 60 * 60 * 1000,
  /** 每工作区条目上限：高频短命令下的防泄漏阀（修剪保留最新）。 */
  maxPerWorkspace: 2000,
  /** 单窗口记录的工具参数序列化字节上限；0 = 不记录内容。 */
  detailBytes: 2048,
} as const

/** cwd 原始串 → 规范 key 的备忘上限（与写入闸同量级）。 */
const KEY_MEMO_CAP = 256

/** 持久化格式版本；读取方拒绝其它版本（视为损坏，从空开始）。 */
const WINDOWS_VERSION = 1

/** 单条窗口的落盘形状守卫（损坏文件里可能混入任意条目）。 */
function isCommandWindow(value: unknown): value is CommandWindow {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.sessionId === 'string'
    && typeof candidate.agentId === 'string'
    && typeof candidate.tool === 'string'
    && (candidate.callId === undefined || typeof candidate.callId === 'string')
    && (candidate.detail === undefined || typeof candidate.detail === 'string')
    && typeof candidate.startedAt === 'number'
    && typeof candidate.endedAt === 'number'
}

/** 保留期 + 上限修剪（保留最新）。 */
function capWindows(list: readonly CommandWindow[], cutoff: number, maxWindows: number): CommandWindow[] {
  const kept = list.filter(entry => entry.endedAt >= cutoff)
  return kept.length > maxWindows ? kept.slice(kept.length - maxWindows) : kept
}

/** 窗口文件名：可读前缀 + 工作区 key 的 16 位哈希，避免非法路径字符与碰撞。 */
function windowsFilename(workspaceKey: string): string {
  const hash = createHash('sha256').update(workspaceKey, 'utf8').digest('hex').slice(0, 16)
  const stem = workspaceKey.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40)
  return `${stem === '' ? 'workspace' : stem}-${hash}.json`
}

export interface CommandWindowRegistryDeps {
  /** 工作区 key 规范化（realpath）；失败返回 undefined（静默跳过）。 */
  readonly canonicalDirectory: (path: string) => Promise<string | undefined>
  /** 持久化根目录（shadow-rewind 存储根）；缺省/空串时保持纯内存（不落盘）。 */
  readonly storageDir?: string
  /** 落盘防抖（毫秒）；缺省走 COMMAND_WINDOW_DEFAULTS.flushMs。 */
  readonly flushMs?: number
  /** 窗口保留期（毫秒），超出即修剪；缺省走 COMMAND_WINDOW_DEFAULTS.retentionMs。 */
  readonly retentionMs?: number
  /** 每工作区窗口上限（修剪保留最新）；缺省走 COMMAND_WINDOW_DEFAULTS.maxPerWorkspace。 */
  readonly maxPerWorkspace?: number
  /** 单窗口记录的工具参数序列化字节上限；0 = 不记录内容；缺省走 COMMAND_WINDOW_DEFAULTS.detailBytes。 */
  readonly detailBytes?: number
}

/** 命令窗口注册表（可选持久化，见模块注释；接口不因持久化而变）。 */
export class CommandWindowRegistry {
  /** 规范化工作区 key → 按时间顺序的窗口列表。 */
  private readonly windows = new Map<string, CommandWindow[]>()
  private readonly keyMemo = new Map<string, string>()
  /** 持久化目录；undefined = 纯内存。 */
  private readonly windowsDir: string | undefined
  private readonly flushMs: number
  private readonly retentionMs: number
  private readonly maxWindows: number
  private readonly detailBytes: number
  /** 已完成懒加载的工作区（此后记录直写 windows 并调度落盘）。 */
  private readonly loaded = new Set<string>()
  /** 进行中的懒加载任务（保证同 key 只读一次盘）。 */
  private readonly loading = new Map<string, Promise<void>>()
  /** 懒加载完成前到达的记录缓冲；加载完成后按「磁盘在前、缓冲在后」合并。 */
  private readonly preLoad = new Map<string, CommandWindow[]>()
  /** 每工作区的落盘防抖定时器（前沿触发，不重置）。 */
  private readonly flushTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** 每工作区的串行化落盘链（防抖触发可能晚于前一次写入）。 */
  private readonly flushChains = new Map<string, Promise<void>>()

  constructor(private readonly deps: CommandWindowRegistryDeps) {
    this.windowsDir = deps.storageDir !== undefined && deps.storageDir.trim() !== ''
      ? join(deps.storageDir, 'command-windows')
      : undefined
    this.flushMs = deps.flushMs ?? COMMAND_WINDOW_DEFAULTS.flushMs
    this.retentionMs = deps.retentionMs ?? COMMAND_WINDOW_DEFAULTS.retentionMs
    this.maxWindows = deps.maxPerWorkspace ?? COMMAND_WINDOW_DEFAULTS.maxPerWorkspace
    this.detailBytes = deps.detailBytes ?? COMMAND_WINDOW_DEFAULTS.detailBytes
  }

  /** 把工具参数序列化为窗口内容（按 detailBytes 截断；0 = 不记录内容）。
   * 宿主契约保证参数 JSON 可序列化，仍防御性兜底：失败即无内容，绝不
   * 影响记录本身。截断可能切断多字节字符（解码器以替换符容错）。 */
  captureDetail(args: unknown): string | undefined {
    if (this.detailBytes <= 0 || args === undefined) return undefined
    try {
      const text = JSON.stringify(args)
      if (text === undefined) return undefined
      if (Buffer.byteLength(text, 'utf8') <= this.detailBytes) return text
      return Buffer.from(text, 'utf8').subarray(0, this.detailBytes).toString('utf8')
    } catch {
      return undefined
    }
  }

  /** 记录一个已闭合的窗口（顺带修剪：过期条目 + 超量保留最新）。 */
  async record(cwd: string, window: CommandWindow): Promise<void> {
    const key = await this.keyFor(cwd)
    if (key === undefined) return
    if (!this.loaded.has(key)) {
      // 懒加载尚未完成：先缓冲，完成后按「磁盘在前、缓冲在后」合并（磁盘
      // 条目全部属于上一个宿主生命周期，时间序天然成立）。
      const buffered = this.preLoad.get(key) ?? []
      buffered.push(window)
      this.preLoad.set(key, buffered)
      void this.ensureLoaded(key)
      return
    }
    this.pushWindow(key, window)
    this.scheduleFlush(key)
  }

  /** 与 [startMs, endMs]（闭区间）相交的全部窗口，按记录顺序。 */
  async windowsOverlapping(cwd: string, startMs: number, endMs: number): Promise<readonly CommandWindow[]> {
    const key = await this.keyFor(cwd)
    if (key === undefined) return []
    await this.ensureLoaded(key)
    return (this.windows.get(key) ?? []).filter(entry => entry.startedAt <= endMs && entry.endedAt >= startMs)
  }

  /** 立即冲刷未落盘的工作区（宿主关停时调用，防止防抖窗口内的记录随重启丢失）。 */
  async flushPending(): Promise<void> {
    if (this.windowsDir === undefined) return
    // 先等进行中的懒加载：缓冲合并与防抖调度在加载完成后才发生，
    // 提前返回会漏掉刚到达的缓冲记录。
    await Promise.all([...this.loading.values()])
    const keys = [...this.flushTimers.keys()]
    for (const key of keys) {
      const timer = this.flushTimers.get(key)
      if (timer !== undefined) clearTimeout(timer)
      this.flushTimers.delete(key)
      this.chainFlush(key)
    }
    await Promise.all([...this.flushChains.values()])
  }

  private pushWindow(key: string, window: CommandWindow): void {
    const cutoff = window.endedAt - this.retentionMs
    const kept = (this.windows.get(key) ?? []).filter(entry => entry.endedAt >= cutoff)
    kept.push(window)
    this.windows.set(key, kept.length > this.maxWindows
      ? kept.slice(kept.length - this.maxWindows)
      : kept)
  }

  // ── 持久化（懒加载 + 防抖原子写；任何失败都静默退化为纯内存） ─────────

  private ensureLoaded(key: string): Promise<void> {
    if (this.loaded.has(key)) return Promise.resolve()
    const existing = this.loading.get(key)
    if (existing !== undefined) return existing
    const task = this.loadFromDisk(key).finally(() => { this.loading.delete(key) })
    this.loading.set(key, task)
    return task
  }

  private async loadFromDisk(key: string): Promise<void> {
    try {
      if (this.windowsDir === undefined) return
      let raw: string
      try {
        raw = await readFile(join(this.windowsDir, windowsFilename(key)), 'utf8')
      } catch {
        return // 不存在或不可读：从空开始（首次使用是常态）。
      }
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return
      const record = parsed as { version?: unknown; windows?: unknown }
      if (record.version !== WINDOWS_VERSION || !Array.isArray(record.windows)) return
      const disk: CommandWindow[] = []
      for (const entry of record.windows) if (isCommandWindow(entry)) disk.push(entry)
      // 加载即按当前时刻修剪（重启自然淘汰跨保留期的窗口）。
      this.windows.set(key, capWindows(disk, Date.now() - this.retentionMs, this.maxWindows))
    } catch {
      // 损坏的记录文件：静默从空开始，下一次落盘会用内存态重写。
    } finally {
      // 标志必须在加载完成后才置位：加载期间的记录走 preLoad 缓冲，
      // 这里统一兜底合并（磁盘在前、缓冲在后）。
      this.loaded.add(key)
      const remaining = this.preLoad.get(key)
      if (remaining !== undefined) {
        this.preLoad.delete(key)
        for (const window of remaining) this.pushWindow(key, window)
        this.scheduleFlush(key)
      }
    }
  }

  private scheduleFlush(key: string): void {
    if (this.windowsDir === undefined || this.flushTimers.has(key)) return
    const timer = setTimeout(() => {
      this.flushTimers.delete(key)
      this.chainFlush(key)
    }, this.flushMs)
    timer.unref?.()
    this.flushTimers.set(key, timer)
  }

  private chainFlush(key: string): void {
    const previous = this.flushChains.get(key) ?? Promise.resolve()
    const next = previous.then(() => this.writeWindows(key)).catch(() => {
      // 落盘失败静默退化：内存态完整，归因不受影响（下次记录再试）。
    })
    this.flushChains.set(key, next)
  }

  private async writeWindows(key: string): Promise<void> {
    // 冲刷前确保加载完成：绝不能把未合并的磁盘态覆盖掉。
    await this.ensureLoaded(key)
    if (this.windowsDir === undefined) return
    const list = this.windows.get(key) ?? []
    const text = JSON.stringify({ version: WINDOWS_VERSION, windows: list })
    await writeFileAtomic(join(this.windowsDir, windowsFilename(key)), text, { mode: 0o600 })
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
  /** 宿主契约：解析后的工具参数（JSON 可序列化；由各工具自行校验模式）。 */
  readonly arguments?: unknown
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
        const detail = registry.captureDetail(exec.arguments)
        await registry.record(cwd, {
          sessionId: topLevelSessionOf(agent, sessions?.()),
          agentId: agent.id,
          tool,
          ...(callId === undefined ? {} : { callId }),
          ...(detail === undefined ? {} : { detail }),
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
    // 关停时冲刷防抖窗口内未落盘的记录（优雅重启不丢窗口）。
    return () => { off(); void registry.flushPending() }
  }, 'shadow-rewind: command windows')
}
