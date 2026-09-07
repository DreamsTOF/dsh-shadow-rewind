# dsh-shadow-rewind 功能清单（核验用）

> 状态标记：✅ 已实现 · 🆕 本轮新增/改造 · ❌ 已移除 · ⚠️ 已知边界
> 生成于 2026-09-07，对应版本 0.9.2+（BEFORE 捕获 / live 条 / pending 撤回改造后）。
> 测试基线：160 个用例，156 通过 / 0 失败 / 4 跳过（3 个 POSIX-only + jj 降级用例因宿主机有 jj 而跳过）。

---

## 1. 会话回退面（聊天消息级）

- ✅ 每条**直发用户消息**旁的「恢复到发送之前」按钮（DOM 注入，挂错即拒绝，绝不误挂）
- ✅ 恢复预览对话框
  - ✅ 对称模式勾选清单（分页拉全、按归属自动勾选：本会话 ✔ / 他会话须显式勾选）
  - ✅ 两种模式：`both`（恢复文件并 fork 新会话继续）/ `code`（只恢复文件）
  - ✅ PLAN_STALE 检测与重试（预览后磁盘又变了 → 提示重新预览）
  - ✅ 跳过项明细透出 `{path, reason}`（超大 / 不支持类型 / 读取失败）
  - ✅ 子集计划：只勾选部分路径时铸造只覆盖勾选路径的恢复计划
- ✅ 「恢复并从新会话继续」：按消息边界 fork；fork 失败自动把文件滚回操作前（绝不留半完成状态）
- ✅ fork 谱系（时间线「v2 · 恢复自」徽标）
- ✅ 「撤销本次恢复」（单次 undo）
  - ✅ 两段式：probe 只读 CAS 比对 → 无冲突直接撤销；有冲突弹三选项（拒绝 / 全部回滚 / 只回滚正常部分）
  - ✅ force 撤销（用户显式授权）可覆盖后续修改；成功路径收缩记录，部分成功可重试

## 2. 回滚数据来源（混合架构）🆕

- ✅ **主路捕获：BEFORE 日志（Claude Code 式，抄 dsh-rewind）**
  - ✅ `tools/execute`（around-dispatch）写盘**前**抓目标文件全文——审批 ask 短路不跳过、被拒调用不留悬挂
  - ✅ 只跟踪 `write` / `edit` / `str_replace_editor`（编辑器只认 create / str_replace / insert 命令）
  - ✅ 锚定当前回合最新 `user/message` 事件 seq（增量缓存）
  - ✅ 工具失败（isError）不提交；`tools/result` 兜底清 pending
  - ✅ 子代理会话一律跳过；工作区外路径放弃（恢复围栏一致）
  - ✅ **边界重查**：每条 user/message 落盘时重查全部被跟踪路径，外部编辑/删除补录 BEFORE
  - ✅ 存储：`workspaces/<key>/before-journal/<会话>/<anchorSeq>/<callId>.json`，内容内联、原子写、单会话保留 100 个 anchor 组
- ✅ **消息检查点兜底（kind `message`，partial 部分树）**
  - ✅ 回合检查点缺席（关闭 / 失败 / 被修剪）时自动从 BEFORE 日志物化——「消除没料可回」
  - ✅ earliest-before 语义：每路径取 anchorSeq ≥ 目标（含边界）的最早 BEFORE；`existed=false`（工具创建）→ 恢复即删除
  - ✅ partial 语义：未捕获路径**绝不**被当作新增删除（防部分树清空工作区）
  - ✅ 物化幂等（id 稳定、增量合并）；非法相对路径 fail-closed 跳过
- ✅ **影子整树快照（兜底 + 检查点在位时的主路）**
  - ✅ 轮起 / 轮末自动检查点（agent pre-step 注入，幂等、同工作区串行、超时跳过、连续失败熔断）
  - ✅ 双后端：影子 jj 仓库 / 内置 SQLite 内容库（jj CLI 缺失自动降级）
  - ✅ 检查点在位时恢复走全树（语义是 BEFORE 日志的超集——含终端写盘）
- ✅ **安全闸（全部路径共用）**
  - ✅ 恢复前自动 rescue 全树备份；失败自动从 rescue 回滚（「要么 B 要么回 A」）
  - ✅ 树哈希 CAS（预览后变化 → PLAN_STALE）+ 计划逐路径新鲜度复核（assertPlanFresh）
  - ✅ 恢复后逐路径落盘哈希验证；快照跳过项永不删除；回环外 403
  - ✅ 删除动作围栏（assertSafeParents / 空目录回收 / 非空拒删）；恢复路径权限位写回（POSIX）
  - ⚠️ 轮中恢复（恢复与编辑交错在同一轮内）按整条遮蔽，无法按条目切分（TODO 已标注）

## 3. 文件审查面（live 条 + 全屏审查界面）🆕

- ✅ **live 条**（输入框上方 `conversation.input.dock`）
  - ✅ 会话累计视图：5 轮改 10 个文件显示 10 行；回滚 2 轮撤销 5 个后剩 5 行
  - ✅ 自适应扣减：恢复成功时以当时快照最大 seq 为屏障，`lastSeq ≤ 屏障` 且路径被恢复的条目遮蔽；屏障后再编辑照常显示；「撤销本次恢复」弹出标记即还原
  - ✅ 数据源合流：工具侧改动（会话快照全部轮，跨轮按路径合并 diff）+ 终端写盘（fs-changes 缓存全部轮占位条目）
  - ✅ 样式：宽度与输入对话框对齐（宿主 dock 共享几何变量）；最多 8 行超出滚动；悬停弹对齐 DiffPopover（fs 条目懒补全文）
  - ✅ 行内撤销 / 重做：每行 hunk 级开关（同原卡片逻辑：fs 占位先补全文、目录带 dirKind、reversibleOf 闸、结果气泡）
  - ✅ 头部「审查」按钮 + 点行：打开审查界面（点行深链展开该文件）
- ❌ 聊天轮尾「已编辑 N 个文件」卡片（功能由 live 条接管）
- ✅ **文件审查全屏界面**（AuditOverlay，原侧边栏 tab 的新外壳）
  - ✅ 逐轮变更组 + 行级红/绿 diff（LazyDiff、未变行折叠、复制）
  - ✅ hunk / 文件 / 轮粒度撤销与重新应用（宿主 fileReview 服务，冲突三选项弹窗）
  - ✅ 每轮「从快照恢复」对话框（整树恢复 + 窗口统计 + 跳转 diff）
  - ✅ 多会话写入确认弹窗、文件级时间线对话框、归属徽标（本会话/他会话/多方/未知）
  - ✅ Code Mode（run_code）嵌套派发的修改录制合并（宿主侧录制、持久化到存储目录）
- ❌ 侧边栏「文件审查」tab（dsh-better-sidebar 注册整体移除，依赖声明清理）
- ✅ 双向同步：live 条与审查界面共用行级开关状态（review-state），任一侧 apply 后另一侧自动翻转/重巡检
- ✅ 行内文件提及（最终回复里的文件引用渲染 + 引导 system prompt）
- ⚠️ fs 条目跨轮的精确净计数为近似（取最新一轮占位，TODO 已标注）

## 4. pending 消息撤回 🆕

- ✅ pending steering 气泡旁撤回按钮（`[data-pending-steering]` 行 × 队列镜像，索引优先 + 文本严格校验配对，不匹配不挂载）
- ✅ 单步确认对话框（预览被撤回文本；撤回目标及其后的全部排队消息一并撤回）
- ✅ 执行：`session.cancel()` → 逐个 `session.updateQueue(id, {kind:'remove'})` → composer 为空时回填被撤回文本
- ✅ 子代理会话跳过（宿主 queueMutable 闸镜像）；remove 失败静默（消息刚被领取时走常规回退）

## 5. headless 命令面

- ✅ `/shadow-diff`：两检查点对比摘要
- ✅ `/shadow-undo`：恢复点管理/撤销

## 6. HTTP 端点（仅回环，非回环 403）

- ✅ `GET/POST /shadow-rewind`：回退预览（messageSeq / turn 两种寻址）与执行
- ✅ `GET /shadow-rewind/file`：按检查点读文件（base64）
- ✅ `GET /shadow-rewind/fs-changes`：逐轮终端写盘变更（live 条数据源，rev 节流）
- ✅ `GET /shadow-rewind/trace`：轨迹重放 / 检查点两两 diff
- ✅ `POST /shadow-rewind/restore-undo`：撤销本次恢复（probe / apply / force）
- ✅ `GET /shadow-rewind/status`：最近错误诊断（去重计数 + hint）+ POST 清空
- ✅ `GET/POST /shadow-rewind/config`：配置读取 / 写入 / 重置
- ✅ `GET/POST /shadow-rewind/manage`：恢复点树、磁盘占用、删除、手动 GC
- ✅ `GET /shadow-rewind/lineage`：fork 谱系链

## 7. 设置（settings namespace `shadow-rewind`，env 前缀 `DSH_SHADOW_REWIND_*`）

- ✅ `maxRestorePoints`（50，rescue 不占额）
- ✅ `maxTurnCheckpointsPerSession`（30，每会话每相位）
- ✅ `maxFiles`（20000）/ `maxFileBytes`（16MB）/ `maxSnapshotBytes`（512MB）
- ✅ `planTtlMs`（15min，过期仅软警告）
- ✅ `turnCheckpointMode`（jj / sqlite / off，启动级）+ `turnCheckpointTimeoutMs`（5s）+ `turnCheckpointMaxNewBytes`（32MB）
- ✅ `turnCheckpointTrust`（fast=stat 缓存 / strict=全量读回）
- ✅ `excludePatterns`（默认 `.git .jj node_modules dist build …`）
- ✅ `storageDir`（启动级，默认 `$DSH_HOME/.dsh/shadow-rewind/v1`）
- ✅ 设置卡片 GUI（`settings.plugin.item` 槽位，热更补丁白名单清洗）

## 8. 存储与清理

- ✅ 存储布局：`workspaces/<key>/`（manifests / sqlite 内容库 / stat 缓存 / before-journal）+ `shadow-repos/<key>/`（jj 镜像）
- ✅ GC 双闸（累计删除 ≥50 manifest 或 ≥24h 先到先触发）；blob 引用计数式回收；stat 缓存同步作废
- ✅ 配额修剪：手动点 / rescue / 每会话 turn 检查点各自独立窗口；被 undo 引用的 rescue 拒删
- ✅ BEFORE 日志 prune：保留最新 100 anchor，对应消息恢复点随删、独占 blob 进 GC
- ✅ 两铁律：绝不调用工作区自身 VCS；恢复 = rescue + 验证 + 失败回 A
