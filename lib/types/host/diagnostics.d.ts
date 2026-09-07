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
export type EnvErrorKind = 'jj' | 'space' | 'permission' | 'lock' | 'mkdir';
export declare const ENV_HINTS: Record<EnvErrorKind, string>;
export declare function classifyEnvError(text: string): EnvErrorKind | null;
