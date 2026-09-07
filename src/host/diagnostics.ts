/**
 * 宿主适配层·环境错误诊断（纯函数模块，无 ctx 依赖）。
 *
 * 环境类失败（jj 缺失/磁盘满/权限/锁/mkdir）的「识别 → 可行动提示」分层：
 * kind 供机器分流（error-log 富集、status 端点 hint），提示文本由展示层
 * 直接使用。吸收自 dsh-recall-plugin（ABSORB-RECALL 2.2），模式表按影子
 * 插件的错误面重写：快照走 jj CLI + node:fs + SQLite，而非 git 脚本层。
 *
 * 文案硬约束：提示不嵌原始路径（路径可达百字符，截断出残句），目标
 * ≤120 字符、硬上限 140；完整原文由 /shadow-rewind/status 的最近错误承载。
 */

// 环境错误分类 kind（单一事实源）：成员以 classifyEnvError 实现与
// tests/host-diagnostics.test.mjs 断言为唯一来源。ENV_HINTS 的
// Record<EnvErrorKind, string> 与本联合编译期互锁：漏提示即编译报错。
export type EnvErrorKind = 'jj' | 'space' | 'permission' | 'lock' | 'mkdir'

// 分类模式表，按根因优先级排列（同一文本命中多类时先命中者胜——
// 如 `EACCES: permission denied, ... No space left on device` 同时命中
// permission 与 space 时，磁盘满是根因，space 必须排在 permission 前面；
// 同理锁文件写入失败报 ENOSPC 时 space 优先于 lock）。模式为不区分
// 大小写的正则，覆盖两平台措辞（POSIX `command not found` / win32
// `not recognized`、node `spawn xxx ENOENT`）与常见 errno 文本。
const ENV_PATTERNS: ReadonlyArray<readonly [EnvErrorKind, RegExp[]]> = [
  ['jj', [/spawn \S*jj\b.*enoent/i, /command not found/i, /not recognized/i]],
  ['space', [/no space left on device/i, /disk quota exceeded/i, /enospc/i]],
  ['permission', [/permission denied/i, /operation not permitted/i, /access is denied/i]],
  ['lock', [/database is locked/i, /database is busy/i, /unable to create .*\.lock/i, /could not lock/i]],
  ['mkdir', [/cannot create directory/i, /EEXIST: file already exists, mkdir/i]],
]

// kind → 可行动中文提示（status 端点 hint 与未来 toast/设置卡片共用同一
// 张表，保证各处看到同一套文案）。值都是静态短句，不带路径。
export const ENV_HINTS: Record<EnvErrorKind, string> = {
  jj: '未检测到 jj CLI：请安装或升级 jj，自动检查点将自动恢复（期间已降级为 SQLite 存储）',
  space: '磁盘空间已满，快照写入失败：清理磁盘空间后自动恢复',
  permission: '快照存储目录无写入权限：请检查目录权限后重试',
  lock: '疑似多个 DSH 实例并发使用同一快照库：请确认只启动了一个 DSH 实例后重试',
  mkdir: '快照存储目录被同名文件占用：处理后自动恢复',
}

// 环境错误分类：命中返回 kind，未命中返回 null（未识别错误保现状回落
// 原文，误判只影响 hint 文案不影响功能）。jj > space > permission >
// lock > mkdir 的表序即根因优先级，勿按字母序重排。
export function classifyEnvError(text: string): EnvErrorKind | null {
  const s = String(text ?? '')
  for (const [kind, patterns] of ENV_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(s)) return kind
    }
  }
  return null
}
