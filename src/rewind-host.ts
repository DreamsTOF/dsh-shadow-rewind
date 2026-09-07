/**
 * 宿主适配层：回合检查点协调器 + `/shadow-rewind` 同源 HTTP 端点。
 *
 * 协调器把「每轮第一步之前自动快照」挂在 agent/pre-step 瀑布最前面；
 * 快照失败只记录、绝不阻塞用户回合。HTTP 端点负责消息→检查点解析、
 * 分页预览、计划生成与恢复执行；会话分叉交给 DSH 官方 create/fork。
 *
 * 物理布局（拆分后本文件只做再导出，保持既有导入路径与公开 API 不变）：
 *  - ./host/types.ts          宿主最小结构类型面 + 会话事件读取；
 *  - ./host/coordinator.ts    TurnCheckpointCoordinator（轮起/轮末自动快照）；
 *  - ./host/revision.ts       工作区数据版本（客户端 warm 缓存失效依据）；
 *  - ./host/http-utils.ts     Node req/res 最小面 + 请求/查询参数解析；
 *  - ./host/session-resolve.ts 消息/回合 → 检查点解析（fork 谱系继承）；
 *  - ./host/fs-changes.ts     行数统计 + 轮配对 diff + 窗口归属共享助手；
 *  - ./host/diagnostics.ts    环境错误分类 → 可行动中文提示（纯函数）；
 *  - ./host/error-log.ts      最近错误环形缓冲（/status 下发）；
 *  - ./host/plugin-config.ts  配置卡片 schema 单一事实源 + 补丁清洗；
 *  - ./host/settings-bridge.ts settings namespace 三版本分派桥（1.2）；
 *  - ./host/manage-endpoints.ts 配置/管理/谱系端点（1.3、三、四）；
 *  - ./host/endpoints.ts      同源 HTTP 端点的注册与 handler；
 *  - ./host/commands.ts       headless 命令 /shadow-diff、/shadow-undo。
 */
export { REWIND_HTTP_PATH, installShadowRewindHttp } from './host/endpoints.js'
export { fuseBackoffMs, TurnCheckpointCoordinator } from './host/coordinator.js'
export { installShadowRewindCommands } from './host/commands.js'
export { SETTINGS_NAMESPACE, installSettingsNamespace } from './host/settings-bridge.js'
export type { SettingsBridge } from './host/settings-bridge.js'
export { cleanConfigPatch, createConfigSchema } from './host/plugin-config.js'
export { CONFIG_DEFAULTS, configEnvLocks } from './engine-config.js'
export { classifyEnvError, ENV_HINTS } from './host/diagnostics.js'
export type { EnvErrorKind } from './host/diagnostics.js'
export { ERROR_BUFFER_MAX, HostErrorLog } from './host/error-log.js'
export type { HostErrorRecord, HostErrorRecordView } from './host/error-log.js'
export type {
  ShadowRewindCommandsHost,
  ShadowRewindCommandInvocation,
  ShadowRewindCommandResult,
} from './host/commands.js'
export {
  sessionEvents,
} from './host/types.js'
export type {
  AgentFace,
  HostContext,
  HostSessionCore,
  HostSessionLike,
  PreStepData,
  RewindHttpDeps,
  SessionControllerLike,
  SessionEventFace,
  SessionFace,
  SessionLogEvent,
  SessionLogSnapshotLike,
} from './host/types.js'
