# 决策记录：坍缩为单一组件——影子 jj 检查点（2026-09，取代前一份决策）

> **取代** [archive/DECISION-drop-terminal-audit.md](archive/DECISION-drop-terminal-audit.md)。
> 前一份只砍终端监听；本份把架构推到底：**全插件只剩影子 jj 检查点一个组件**。
> 文件广播器（A-1/A-2 挂靠）不再实施。

## 产品面（唯一需求集）

1. **知晓**：哪个会话、哪一轮、改了哪个文件——检查点窗口归属（快照网格 +
   轮起/轮末配对 diff）直接回答，不需要任何写入时事件。
2. **回滚**：把工作区（整树 / 某轮 / 某些文件）恢复到某检查点状态。
3. **撤销回滚**：undoLastRestore（rescue 点兜底）。

## 随之整体删除的子系统（与对应冲突组的了断）

| 删除 | 冲突组了断 |
| --- | --- |
| 工具视图全链：turn-deliverables / session-changes / recorded-diffs / host.ts 录制器 / hunk 勾选 UI / status-dedupe | **A 组灭**（fs diff 成为唯一数学，不再有两套） |
| trace-replay + `trace:` 寻址 + 时间线轨迹泳道 | **B 组灭**（时间线只剩检查点节点） |
| 词法删除 deleted-paths（前次决策） | **C 组灭** |
| file-review 的 hunk 机器（file-review-service / typert-descriptors / typert.host / remote / change-types） | **F 组灭**（typert 契约整体退役）；**H-1/H-2/H-3/H-4 灭**（hunk CAS、混合态、三套 CAS、录制行尾全部不存在了） |
| Code Mode 录制 | **E 组灭** |
| command-windows + attribution 窗口分支（前次决策） | **I-2/I-3/I-5 灭** |

**两个结构性收益值得点名**（不是删代码的副产品，是语义升级）：

- **每文件回滚 = paths 子集 planRestore**：复用对称模式已有的子集计划机制，
  走 `applyGuarded` → 写入闸分诊自动生效。**D 组灭**（file-review apply
  绕过闸的问题随 file-review 一起消失）。
- **条目状态判定从 CAS 三态收敛为只读比对**：整文件粒度下，一条 fs 变更的
  状态 = 当前磁盘 vs 检查点两侧（`applied` / `rolled-back` / `diverged`），
  服务端一次比对算完。H-2 的混合态震荡、H-1 的三套判定、status 请求/巡检
  机制全部没有存在理由了。

## 幸存冲突清单（按新优先级）

### P0 —— 单组件架构下成为核心路径的 bug（全是极小改动）

| 项 | 内容 | 为什么现在更紧急 |
| --- | --- | --- |
| G-1 | fetchSubsetPlan 的 `details=1` 死路径 | **每文件回滚的唯一客户端通路**，不修则需求 2 只能整轮回滚 |
| G-2 | plan.restorePointId 与请求 checkpointId 比对 | 回滚是唯一写路径，错配=静默回错时点 |
| H-9 | restore-undo 两入口补 rev bump + fs-changes 读序 | **撤销回滚是一级需求**，不修则撤销后 UI 与磁盘相反 |
| H-5 | undo 部分成功不销毁记录 | 同上；部分成功即永久搁浅不再可接受 |
| H-6 | fork 补偿覆盖 undoRecords | 同上；「撤销」被静默反转为「再恢复」 |
| H-8(引擎半边) | rescue 修剪纳入 undoRecords 引用检查 | undo 依赖的 rescue 点可能被配额修剪掉（file-review/rescue 目录半边随 file-review 消失） |

### P1 —— 检查点成为唯一组件后的存储正确性（K 组原样全部幸存）

K-1（仓库重建死恢复点，建议极简分支：重建即清 store manifests）、K-6（jj
半写毒化，中断路径清理镜像）、K-2（sqlite 字节闸 + 错误分类）、K-4（修剪
补 GC）、K-8（hashTree 等逐字双份合并——**现在它是核心数据完整性校验**，
合并后必须全量测试）、K-5（抽样校验折中）。

### P2 —— 展示一致性（fs-only 重写时顺手做）

- J-5：CRLF 行数双口径（服务端归一/渲染端不归一）+ UnifiedDiff 硬编码 'M'。
- J-6：warm 缓存与侧栏直拉双通道——侧栏重写为 fs-only 时**顺势统一**，
  从冲突变成重构红利。
- I-4：GET /shadow-rewind 响应里 `changes` 与 `fileSystemChanges` 两份清单
  ——单组件下可合并成一份，顺势消灭。
- 新增一个小工作项：**fs 条目状态只读比对**（applied/rolled-back/diverged）
  的服务端计算与下发，顶替 file-review status 的位置。

### P3 —— 注明接受或缓

- I-1 剩余：网格归属在闸开时仍是静默裁决（64 快照上限塌缩）——闸开模式下
  所有者本来就是唯一写者，过滤几乎恒真；自用接受，catch 分支统一为剔除（一行）。
- I-6（claim 先于 capture）、I-7（子代理 capture）、I-8（agent.id 断言）：极小，随手。
- K-3 / K-5 / K-7：自用接受现状。
- **配额边界**：trace-replay 兜底删除后，检查点被淘汰（默认 30 轮/会话）的
  轮永久不可审计——接受；不够用就调大配额。
- **粒度边界**：hunk 级撤销随 file-review 退役，回滚粒度 = 文件/轮。
  diff 展示为整文件红绿（fs 条目本来就是）。自用已接受。

## 实施顺序建议

1. **删除批**：按上表删子系统（含前次决策的终端监听）+ 测试瘦身。删除本身
   不修任何 bug，先让代码库回到单一数学。
2. **P0 批**：G-1/G-2/H-5/H-6/H-8(引擎)/H-9 —— 全是几行级，互相独立，
   修完需求 2/3 才真正可靠。
3. **P2 批**：状态只读比对 + 客户端 fs-only 重写（J-6/I-4 顺势消灭）。
4. **P1 批**：K 组存储正确性。
5. README 叙事改写（「三类变更全部可见可撤销」→ 检查点轮 diff 单一叙事）。

> 各组冲突的原始分析（file:line 证据链）保留在
> [archive/](archive/)，幸存条目仍然引用它们，行号以删除重构前的代码为准。
