# dsh-shadow-rewind 功能清单（核验用）

> 状态标记：✅ 已实现 · ❌ 已移除 · ⚠️ 已知边界
> 语义基线：**检查点 diff 是变更事实的唯一来源**；回退 = 整树恢复 + 就地遮蔽。
> 测试基线：155 个用例，151 通过 / 0 失败 / 4 跳过（POSIX-only 与 jj 降级用例）。

---

## 1. 会话回退面（聊天消息级）

- ✅ 每条**直发用户消息**旁的「恢复到发送之前」按钮（DOM 注入，挂错即拒绝，绝不误挂）
- ✅ 恢复预览对话框（GET `/shadow-rewind`，消息/轮两种寻址共用同一解码器与分页拉全）
  - ✅ 清单 = `inspect(该检查点 vs 当前磁盘)`——恢复会把其后一切写盘丢弃，这份清单就是「将被改动的文件」的完整事实
  - ✅ 逐文件净 `+/−` 行数（服务端按检查点两侧内容算好，与恢复后清单同口径）
  - ✅ 跳过项明细透出 `{path, reason}`（超大 / 不支持类型 / 读取失败）
  - ✅ 点文件行打开审查界面并深链展开该文件的 diff
- ✅ **整树恢复**（唯一语义）：恢复到该消息所属回合的轮起检查点，丢弃其后一切写盘（含终端/外部与手动修改）
- ✅ **就地遮蔽回退**（消息入口）：文件恢复后宿主追加空 `user/message` 遮蔽标记（`surfaceOp.replace` + `sourceEventSeqs`），客户端把 [目标…标记] 区间消息行隐藏并回填 composer（仅空输入框）；运行中回合先中断（保留 queue）
- ✅ 「撤销本次恢复」（进程内 undo 栈）
  - ✅ 两段式：probe 只读 CAS 比对 → 无冲突直接撤销；有冲突弹三选项（拒绝 / 全部回滚 / 只回滚正常部分）
  - ✅ force 撤销（用户显式授权）可覆盖后续修改；成功路径收缩记录，部分成功可重试
  - ✅ undo 栈多槽 + 身份回传：每工作区保留最近 8 次恢复（栈顶=最近一次）；多会话共享工作区时，若撤销的是其它会话的恢复，客户端不弹本会话遮蔽层
- ❌ 分叉新会话（`both` 模式）/「只恢复文件」消息入口 / `/rewind` 候选面板 / 勾选式子集恢复 / 归属自动勾选：**全部移除**

## 2. 回滚数据来源（唯一）

- ✅ **影子整树快照（唯一数据源）**
  - ✅ 轮起 / 轮末自动检查点（agent pre-step 注入 + `turn/end` 事件，幂等、同工作区串行、超时跳过、连续失败熔断）
  - ✅ 双后端：影子 jj 仓库 / 内置 SQLite 内容库（jj CLI 缺失自动降级）
  - ✅ 每轮变更 = diff(轮起检查点, 轮末检查点)；无轮末快照的轮回退「下一轮轮起」配对
  - ✅ 每会话每相位保留 30 个检查点；rescue 点独立配额且被 undo 引用时拒删
- ❌ BEFORE 日志（写盘前捕获）/ `kind 'message'` 部分树兜底 / `partial`·`createdPaths` 语义：**全部移除**（检查点缺失时如实提示「没有快照」）
- ✅ **安全闸（全部路径共用）**
  - ✅ 恢复前自动 rescue 全树备份；失败自动从 rescue 回滚（「要么 B 要么回 A」）
  - ✅ 树哈希 CAS（预览后变化 → PLAN_STALE）+ 计划逐路径新鲜度复核（assertPlanFresh）
  - ✅ 恢复后逐路径落盘哈希验证；快照跳过项永不删除；回环外 403
  - ✅ 删除动作围栏（assertSafeParents / 空目录回收 / 非空拒删）；恢复路径权限位写回（POSIX）

## 3. 文件审查面（检查点 diff 单源）

- ✅ **live 条**（输入框上方 `conversation.input.dock`）
  - ✅ 会话累计视图：服务端 `cumulative` 清单（同路径跨轮的净变化 = 最早触碰轮起 → 最后一次触碰轮末/当前磁盘），客户端零推导
  - ✅ 行 = 文件名 + 净 `+/−` + 徽标（删除 / 目录 / 已撤销 / 归属）
  - ✅ 悬停弹对齐 DiffPopover（全文按需懒加载并按检查点对记忆）
  - ✅ 行内撤销 / 重做：hunk 级（同审查界面一套宿主服务；检查点 hunks 带行锚点）
  - ✅ 头部「审查」按钮 + 点行：打开审查界面（点行深链展开该文件）
  - ✅ 恢复后按「恢复屏障」遮蔽（整树恢复 = 全部遮蔽）；「撤销本次恢复」弹出标记即还原
- ✅ **文件审查全屏界面**（AuditOverlay）
  - ✅ 逐轮变更组 + 行级红/绿 diff（LazyDiff、未变行折叠、复制）
  - ✅ hunk / 文件 / 轮粒度撤销与重新应用（宿主 fileReview 服务，冲突三选项弹窗）
  - ✅ 每轮「从快照恢复」对话框（整树恢复；预览与安全闸同一套）
  - ✅ 文件级时间线对话框、归属徽标（本会话/他会话/多方/未知，仅信息展示）
  - ✅ 双向同步：live 条与审查界面共用行级开关状态（review-state）
- ❌ Code Mode（run_code）录制管线：**移除**（嵌套写盘同样落在轮末检查点里，由检查点 diff 覆盖）
- ❌ 侧边栏「文件审查」tab（dsh-better-sidebar 注册整体移除）
- ❌ 多会话写入确认弹窗：移除（归属不再参与默认行为，撤销冲突由 CAS + 三选项弹窗裁决）
- ✅ 行内文件提及（最终回复里的文件引用渲染 + 引导 system prompt；词汇 = 该轮工具结果路径）

## 4. pending 消息撤回

- ✅ pending steering 气泡旁撤回按钮（`[data-pending-steering]` 行 × 队列镜像，索引优先 + 文本严格校验配对，不匹配不挂载）
- ✅ 单步确认对话框（预览被撤回文本；撤回目标及其后的全部排队消息一并撤回）
- ✅ 执行：`session.cancel()` → 逐个 `session.updateQueue(id, {kind:'remove'})` → composer 为空时回填被撤回文本
- ✅ 子代理会话跳过（宿主 queueMutable 闸镜像）；remove 失败静默

## 5. headless 命令面

- ✅ `/shadow-diff`：两检查点对比摘要（轮号 / `rp_…` / `trace:序号`，快照与轨迹不可混用）
- ❌ `/shadow-undo`、`/shadow-inplace`（`/rewind` 别名）：已移除；撤销统一走 GUI `/restore-undo` + 身份回传，就地回退走 GUI 弹窗

## 6. HTTP 端点（仅回环，非回环 403）

- ✅ `GET/POST /shadow-rewind`：回退预览（messageSeq / turn 两种寻址，逐文件净行数）与整树恢复执行
- ✅ `GET /shadow-rewind/file`：按检查点读文件（base64）
- ✅ `GET /shadow-rewind/fs-changes`：逐轮检查点 diff（`turns`）+ 会话累计净变化（`cumulative`）
- ✅ `GET /shadow-rewind/trace`：轨迹重放 / 检查点两两 diff
- ✅ `POST /shadow-rewind/inplace`：就地遮蔽回退（对话侧）
- ✅ `POST /shadow-rewind/restore-undo`：撤销本次恢复（probe / apply / force / paths 子集撤销）
- ✅ `GET /shadow-rewind/status`：最近错误诊断（去重计数 + hint）+ POST 清空
- ✅ `GET/POST /shadow-rewind/config`：配置读取 / 写入 / 重置
- ✅ `GET/POST /shadow-rewind/manage`：恢复点树、磁盘占用、删除、手动 GC
- ❌ `GET /shadow-rewind/lineage`：随 fork 移除

## 7. 设置（settings namespace `shadow-rewind`，env 前缀 `DSH_SHADOW_REWIND_*`）

- ✅ `maxRestorePoints`（50，rescue 不占额）
- ✅ `maxTurnCheckpointsPerSession`（30，每会话每相位）
- ✅ `maxFiles`（20000）/ `maxFileBytes`（16MB）/ `maxSnapshotBytes`（512MB）
- ✅ `turnCheckpointMode`（jj / sqlite / off，启动级）+ `turnCheckpointTimeoutMs`（5s）+ `turnCheckpointMaxNewBytes`（32MB）
- ✅ `turnCheckpointTrust`（fast=stat 缓存 / strict=全量读回）
- ✅ `excludePatterns`（默认 `.git .jj node_modules dist build …`）
- ✅ `storageDir`（启动级，默认 `$DSH_HOME/shadow-rewind/v1`）
- ✅ 设置卡片 GUI（`settings.plugin.item` 槽位，热更补丁白名单清洗）
- ❌ `planTtlMs`（计划 TTL 软警告）：随死字段移除

## 8. 存储与清理

- ✅ 存储布局：`workspaces/<key>/`（manifests / sqlite 内容库 / stat 缓存）+ `shadow-repos/<key>/`（jj 镜像）
- ✅ GC 双闸（累计删除 ≥50 manifest 或 ≥24h 先到先触发）；blob 引用计数式回收；stat 缓存同步作废
- ✅ 配额修剪：手动点 / rescue / 每会话 turn 检查点各自独立窗口；被 undo 引用的 rescue 拒删
- ✅ 两铁律：绝不调用工作区自身 VCS；恢复 = rescue + 验证 + 失败回 A