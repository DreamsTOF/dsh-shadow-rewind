/**
 * 宿主适配层·最近错误环形缓冲。
 *
 * 进程级错误历史：宿主侧失败原本只进 console.warn（宿主进程日志，页面
 * 上不可见），这里留最近 20 条经 /shadow-rewind/status 下发给排障 UI。
 * 同时转发 console.warn 保持原有宿主日志不变。吸收自 dsh-recall-plugin
 * （ABSORB-RECALL 2.3）。
 *
 * 尾部去重：环境性错误随每个回合重复抛出，逐条 push 会把 20 条环形
 * 缓冲刷成同一条目、console 同步刷屏，其他诊断信息全被挤掉。相邻重复
 * 只更新 time/count——间隔其他错误的重复仍新建条目，错误时序不丢；
 * kind 随条目富集（classifyEnvError），供 status 端点机器分流。
 */

import { classifyEnvError, ENV_HINTS } from './diagnostics.js'
import type { EnvErrorKind } from './diagnostics.js'

/** 环形缓冲上限：排障面只关心「最近发生了什么」，20 条足够定位。 */
export const ERROR_BUFFER_MAX = 20

/** 环形缓冲条目：kind 直存 classifyEnvError 返回值，未命中即 null——
 * 建模不许滤掉「未分类」这一事实（status 端点 hint 按 null 回落）。 */
export interface HostErrorRecord {
  readonly time: number
  readonly message: string
  readonly count: number
  readonly kind: EnvErrorKind | null
}

/** status 端点的下发形状：message 拼「（×N）」重复计数、hint 为分类提示。 */
export interface HostErrorRecordView {
  readonly time: number
  readonly message: string
  readonly count: number
  readonly hint: string | null
}

export class HostErrorLog {
  private readonly entries: HostErrorRecord[] = []

  /** 记录一条错误：相邻去重计数、上限淘汰最旧，并转发 console.warn。 */
  push(message: string): void {
    const text = String(message ?? '')
    if (text === '') return
    const last = this.entries[this.entries.length - 1]
    if (last !== undefined && last.message === text) {
      // 相邻重复：替换为新对象而非就地改字段，保持 HostErrorRecord 不可变语义。
      this.entries[this.entries.length - 1] = { time: Date.now(), message: text, count: last.count + 1, kind: last.kind }
    } else {
      this.entries.push({ time: Date.now(), message: text, count: 1, kind: classifyEnvError(text) })
      if (this.entries.length > ERROR_BUFFER_MAX) this.entries.splice(0, this.entries.length - ERROR_BUFFER_MAX)
    }
    console.warn(`[shadow-rewind] ${text}`)
  }

  /** 最近错误（新→旧），供 status 端点直接下发。 */
  list(): HostErrorRecordView[] {
    return [...this.entries].reverse().map((entry) => ({
      time: entry.time,
      count: entry.count,
      message: entry.count > 1 ? `${entry.message}（×${String(entry.count)}）` : entry.message,
      hint: entry.kind === null ? null : ENV_HINTS[entry.kind],
    }))
  }

  /** 清空（status 端点 op=clear）。 */
  clear(): void {
    this.entries.length = 0
  }
}
