# 冲突组 G —— 恢复计划的铸造与执行脱节（决策文档）

> 冲突描述：卷二 G1–G3（对称模式勾选恢复死路径；plan 与 checkpointId 互不
> 比对；闸态 TOCTOU）。三条都是一行级修复，无实质取舍，可一批上。

## 方案 G-1：fetchSubsetPlan 去掉 `details=1` ★最优先

- **做法**：`subset-plan.ts:21` 的 URL 去掉 `&details=1`。
- **代价**：一行。现有测试直调端点不带 details，所以测不出这条死路径——
  建议补一条走 `fetchSubsetPlan` 的端到端用例。
- **注意**：修复前，对称模式的勾选式恢复（README 招牌功能）一直坏着，
  这是全清单里唯一「用户可直接感知的功能不可用」，排第一。

## 方案 G-2：plan.restorePointId 与请求 checkpointId 比对

- **做法**：`applyGuarded` 里补一处 `plan.restorePointId === checkpoint.id`，
  不匹配抛 `PLAN_STALE`。
- **代价**：一行 + 一个错配测试用例。堵住「轮 3 的 checkpointId 配轮 4 的
  plan 静默执行轮 4 恢复」的错配窗口。

## 方案 G-3：plan 记录铸造时的闸语义，apply 时校验

- **做法**：`planRestore` 记录铸造时的 mode，`applyRestore` 发现与当前闸态
  推导的 mode 不一致即拒绝（同 G-2 的 PLAN_STALE 通道）。
- **改动面**：plan 结构加一个字段 + 一处校验。
- **代价**：小。这是三条里唯一要动持久结构的，但其实 plan 已有确认串机制，
  字段塞进 plan 内存对象即可（plan 本就有 TTL，不必落盘）。

## 推荐

三条互不依赖，一批上。G-1 最优先，G-2/G-3 顺手。
