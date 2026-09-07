# HTTP 端点与命令面

全部端点同源、**仅接受回环请求**（`isLoopback`，`src/rewind-host.ts:1046-1048`，非回环一律 403）。注册集中在 `installShadowRewindHttp`（`src/rewind-host.ts:457-481`）。

## 端点一览

| 端点 | 方法 | 用途 | 关键 handler |
| --- | --- | --- | --- |
| `/shadow-rewind` | GET | 消息回退预览（`?sessionId&messageSeq`）/ 按轮快照预览（`?sessionId&turn`）；`paths=[...]` 铸造勾选子集计划；`details=1` 只取清单 | `handleRewindHttp`，`src/rewind-host.ts:526-745` |
| `/shadow-rewind` | POST | `{mode: "code"\|"both", sessionId, checkpointId, planId}` 执行恢复（确认串已废除，确认由 GUI 弹窗承担）；`both` 在文件恢复后分叉新会话，分叉失败自动把文件滚回 | `handleRewindHttp` POST 分支 |
| `/shadow-rewind/fs-changes` | GET | 批量返回会话所有轮次的终端写盘变更（轮配对、行数预算、权限位、归属、`rev` 数据版本、degraded 标注） | `handleFsChangesHttp` |
| `/shadow-rewind/trace` | GET | 不带 `from/to`：时间线（轨迹节点 + 检查点摘要 + 三泳道 spans + turn 刻度）；带 `from/to`：`trace:序号`（重放区间 diff）或 `rp_…`（快照对比），**不可混用** | `handleTraceHttp` |
| `/shadow-rewind/file` | GET | 按检查点读取文件内容（base64）；`checkpointId=live` 读当前磁盘，工作区围栏校验 | `handleFileContentHttp` |
| `/shadow-rewind/restore-undo` | POST | 撤销该工作区最近一次恢复。body `{sessionId\|cwd, mode?: "probe"\|"apply", force?, paths?}`——`probe` 只读比对 CAS 返回 `{clean, conflicted}`（三选项弹窗的依据）；`apply`（缺省）执行撤销，`force` + `paths` 为用户授权后的强制/子集回滚 | `handleRestoreUndoHttp` |

（写入闸端点 `/shadow-rewind/gate` 已随写入闸移除，见决策文档。）

## 响应里值得注意的字段

- `skippedPaths`：逐条 `{path, reason}`，恢复预览必须展示「恢复不会碰它们」；
- `owner` / `autoSelect`：窗口归属的建议标签，`serializeOwner` 序列化为 `'target' | 'multi' | 'unknown' | <sessionId>`（`src/attribution.ts:75-83`）；
- `rev`：工作区数据版本，客户端 warm 的跳过依据（`src/rewind-host.ts:1171-1182`）；
- `degraded`：检查点快照内容抽样不可读（影子仓库丢失 / sqlite 受损）时诚实标注——只读探测最小的文件条目，绝不写任何数据（`checkpointContentReadable`，`src/engine.ts:597-625`；抽样 3 个——最小/最大/中位大小，单样本只覆盖一个 blob 的死活）。

## 错误模型

错误统一 `{error, code}` JSON，`ShadowRewindError` 的 code 即机器可读错误码：`PLAN_STALE`（重开预览重试）、`NO_CHANGES`、`RESTORE_POINT_NOT_FOUND`（404）、`UNDO_CONFLICT` / `UNDO_NOT_FOUND`（409）……EXPECTED-DESIGN 1.4 之后：流程性拒绝（TTL 过期、会话绑定不匹配）降级为软警告字段不再抛错；`WORKSPACE_LOCKED`、`CONFIRMATION_MISMATCH`、`RECOVERY_REFERENCE` 随锁与确认串、操作日志的废除而消失。HTTP 层只做翻译不做吞并（各 handler 的 catch 分支）。

## headless 命令面

宿主命令系统（cordis 服务 `commands`）可用时自动注册（`installShadowRewindCommands`，`src/rewind-host.ts:1715-1727`），输出纯文本、脚本可直接消费：

- **`/shadow-diff [起] [终]`**——两个时间节点的文件变更摘要。参数三种：轮号（`3`，单轮 = 轮起 → 轮末/下一轮轮起配对）、检查点 id（`rp_…`）、轨迹节点（`trace:序号`）；快照与轨迹不可混用。输出最多 40 行（`COMMAND_MAX_ROWS`），超出提示完整清单见时间线面板（`COMMAND_MAX_ROWS`，`:1712`）。
- **`/shadow-undo`**——撤销该工作区最近一次文件恢复，语义同 restore-undo 端点（`runShadowUndoCommand`，`:1836-1850`）。

命令系统缺失的宿主上该 inject 挂起即可，不影响其余装配（`src/index.ts:71-75`）。

## 客户端消费模式

浏览器半边（随包分发，构建产物 `lib/client.js`）对端点的消费有三层缓存纪律（`src/client/fs-diff-utils.ts`）：

1. **批量预拉**：`warmFsChanges` 2 秒节流 + `rev` 比对，rev 未变整轮跳过；
2. **占位渲染**：清单条目零全文，行数来自服务端；
3. **懒取全文**：`(turnStartSeq, path)` 记忆化，容量 512，该轮条目更新即失效。
