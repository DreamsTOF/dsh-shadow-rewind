/**
 * 宿主半边的文件审查装配（自 dsh-file-review-tab 移植）：
 *  1. FileReviewService —— hunk 级撤销/重做，发布为 Typert `fileReview` 命名空间；
 *  2. 最终回复的文件引用引导（浏览器端行内代码文件提及的配对渲染契约）；
 *  3. Code Mode（run_code）嵌套派发的修改录制器 —— 嵌套调用在会话快照里没有
 *     wire 视图，必须在宿主侧快照 before/after 才能回放 diff；
 *  4. 便携增强：录制记录持久化到 shadow-rewind 的存储目录（原插件为纯内存，
 *     宿主重启后 Code Mode 轮次的 diff 与撤销会静默丢失）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { FileReviewService } from './file-review-service.ts'

export type * from './change-types.ts'
export { FileReviewService, transformFile } from './file-review-service.ts'

/** 稳定的最终回复引导：与浏览器端的文件引用渲染器一一配对。 */
const FILE_REFERENCE_PROMPT = 'When you successfully create or modify files, mention the primary outputs in your final response. '
  + 'To make those and any other changed-file references clickable in Web, format them as Markdown inline code using the exact file-tool path, or a basename when unique among the files changed in that turn.'

/** `tools/post-execute` 瀑布参数的运行时形状（只消费，不发明依赖）。 */
interface PostExecuteCall {
  readonly name: string
  readonly callId: string
  readonly rootCallId?: string | undefined
  readonly parent?: unknown
  readonly agent?: Agent | undefined
}
interface PostExecuteResult {
  readonly value?: unknown
}
type PostExecuteDecision = { readonly kind: string }
type PostExecuteNext = () => Promise<PostExecuteDecision>

/** systemPrompt 服务注册面（结构类型，避免与具体 dsh 版本的类型包强耦合）。 */
interface SystemPromptSection {
  section(section: { readonly name: string; readonly order: number; readonly text: string }): unknown
}

export interface InstallFileReviewHostOptions {
  /** 录制记录持久化目录（shadow-rewind 存储根）；缺省时保持纯内存。 */
  readonly storageDir?: string
}

/**
 * 在插件宿主上下文里装配全部文件审查能力，返回创建的 FileReviewService。
 * @param ctx - 宿主 cordis 上下文（携带 system-prompt 注册表与工具瀑布）。
 */
export function installFileReviewHost(
  ctx: Context,
  options: InstallFileReviewHostOptions = {},
): FileReviewService {
  const service = new FileReviewService(ctx, options)

  ctx.inject(['systemPrompt'], (scope) => {
    const systemPrompt = (scope as unknown as { readonly systemPrompt: SystemPromptSection }).systemPrompt
    systemPrompt.section({
      name: 'ui:file-review-references',
      order: 190,
      text: FILE_REFERENCE_PROMPT,
    })
  })

  // 'tools/post-execute' 位于宿主工具注册表的 Cordis 事件表，不在本包的类型化
  // Events 面里；宽松的 emitter 转型保持运行时契约而不引入注册表插件类型依赖。
  // ctx.effect 拥有注册生命周期：HMR / 插件禁用时移除监听，泄漏会导致重复录制。
  const emitter = ctx as unknown as {
    on(event: string, listener: (exec: unknown, result: unknown, next: unknown) => unknown): () => void
  }
  ctx.effect(() => {
    const off = emitter.on('tools/post-execute', async (
      execRaw: unknown,
      resultRaw: unknown,
      nextRaw: unknown,
    ): Promise<PostExecuteDecision> => {
      const exec = execRaw as PostExecuteCall
      const result = resultRaw as PostExecuteResult
      const next = nextRaw as PostExecuteNext
      const decision = await next()
      if (decision.kind !== 'accept') return decision
      // 模型直接发起的修改已经能通过会话视图审查；只有嵌套派发（run_code
      // 子调用）需要宿主侧录制。按结果形状识别（{path, before, after}），不认工具名。
      if (exec.parent === undefined || exec.agent === undefined) return decision
      const value = result.value
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return decision
      const candidate = value as { path?: unknown; before?: unknown; after?: unknown }
      if (typeof candidate.path !== 'string' || typeof candidate.after !== 'string') return decision
      if (candidate.before !== null && typeof candidate.before !== 'string') return decision
      service.recordMutation(exec.agent, {
        rootCallId: String(exec.rootCallId ?? exec.callId),
        name: exec.name,
        path: candidate.path,
        before: candidate.before ?? null,
        after: candidate.after,
      })
      return decision
    })
    return () => { off() }
  }, 'shadow-rewind: ptc recorder')

  return service
}
