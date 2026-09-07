# 已知边界与待办

本章如实记录当前版本的能力边界与实现状态。来源：README「边界」节、`conflicts/DECISION-final-scope.md`（2026-09 定稿，含第五节实施状态附录）与源码注释中的 `ponytail:` 标记。

> 实施基线：2026-09 定稿当日 25 项修复全部落地，`pnpm run check` 105 测试 0 失败（4 skip = 本机无 jj 的双后端用例），typecheck 干净。

## 恢复语义的边界

- 恢复的是**文件内容 + 权限位 + 空目录**：不回滚任何 VCS 历史（工作区 git 的提交不受影响）；非空目录不单独立条目（由子条目在恢复时隐式重建）；符号链接仅在 POSIX 环境验证（`src/engine.ts:1254`、`:1263` 两处 `process.platform !== 'win32'` 守卫）。
- **恢复撤销是进程内单次 undo**：重启即失效（持久兜底是恢复时自动创建的 rescue 备份点）；只保留最近一次，再次恢复会替换；部分成功时记录保留以供重试（`src/engine.ts:1048-1051`）。
- **轨迹重放只覆盖会话内的内容型工具**：终端命令与外部进程的写盘不可见（由检查点对比补位）；早于会话首次写入的文件基线不可知——B-1 之后宿主会为触碰路径取基线内容，重放图仍有基线缺失时在 notes 注明（`src/trace-replay.ts:13-19`、`:421-425`）。
- **排除清单内的写入完全不可见**（默认 18 项，`src/engine.ts:64-83`）；超过大小/数量上限的路径显式跳过、不可恢复。
- 终端写盘归属是窗口语义：轮末检查点之后的轮间手动/外部修改不属于任何轮；同一路径被多会话触碰时从单会话视图保守剔除；**轮内创建又删除的临时文件两端检查点都不含、不可见**。
- Windows 上权限位语义受限（只读位有效）；跨机共享存储未设计（锁判活按单机 pid）。
- Code Mode 录制按结果形状 `{path, before, after}` 识别——E-2 之后已加工具名白名单收紧，误录面大幅缩小（`src/file-review/host.ts` 录制器）。

## 决策实施状态（已核销）

决策文档第五节的实施状态附录显示**全部项已落地**（2026-09 定稿当日），与本文档关系密切的包括：

- 删除批：终端写盘监听（command-windows / deleted-paths / attribution 窗口分支）与写入闸全链（write-gate / `/gate` 端点 / 配置 / 侧栏开关 / 恢复阻塞分诊）——README 已同步改写为单一对称叙事；
- F-1 schema 补字段 + `z.strictObject`（zod v4 没有 `.strict()`）；G-1 `fetchSubsetPlan` 去 `details=1`；G-2 计划与检查点错配抛 `PLAN_STALE`（`src/rewind-host.ts:949-958` `applyGuarded`）；
- H-3 统一 CAS：新模块 `src/file-review/cas.ts`，hunk CAS 放宽为 LF 归一；H-1/H-2 客户端可逆判定单点 `reversibleOf`、状态键 = path + diff 集签名；
- H-5 undo 部分成功不销毁记录；H-6 fork 补偿 `skipUndoRecord`；H-9 restore-undo 两入口 bump `rev`；
- I-7 capture 跳过子代理（`src/rewind-host.ts:183-186`）；I-8 agent.id ≠ session.id 启动告警一次；
- K-8 `hashTree`/`checksumOf` 单一实现（`src/manifest.ts:28`，`src/capture.ts:21` 转引）；K-5 degraded 抽样 3 个（最小/最大/中位）；B-1 `traceRangeDiff` 接受 baseline 为触碰路径补基线。

遗留如实说明（决策文档原文）：I-8 是可观察行为告警而非修复宿主；J-5 的 `diffContentLines` 归一让 CRLF 文件的渲染行不再带行尾字符（展示更干净，与计数同源）。

## 代码注释里的天花板标记（`ponytail:`）

按你自己的约定，有风险的简化逻辑用 `ponytail:` 标注了天花板与升级路径，全文检索可枚举。本文写作时确认的几处：

- `src/store.ts`（`putSqliteBlobs` 前）：sqlite 整库单文件 + 内容寻址表；天花板是「跨工作区全局去重」与「增量压缩」。
- `src/file-review/file-review-service.ts`（`inspectFsChange` 前）：混合行尾的文件仍可能被判冲突；天花板是行级行尾映射。

## 测试基线

`pnpm test` 用真实临时目录跑完整链路（README「测试」节）：引擎（双后端全测）、文件审查（hunk 子集撤销、Code Mode 录制往返、终端写盘撤销语义）、轨迹重放与意图标签、恢复撤销与命令面、混沌套件（固定种子，7 会话不对称轮数的逐条断言）。jj CLI 可用时自动加测影子后端。
