# 决策记录：单源收敛（本轮，取代 DECISION-final-scope 的 A/E/H 部分）

> 本轮把「同一事实多套数学」的残留全部收敛为**检查点 diff 单一来源**，
> 并删掉与目标语义冲突的第二套行为。范围基线：
> **每轮 = 一个检查点；回退 = 整树恢复 + 就地遮蔽；变更清单 = 检查点 diff。**

## 一、目标语义（用户拍板）

1. 每一轮用户对话都是一个检查点（轮起快照；轮末快照用于精确界定本轮变更）。
2. 文件清单、`+/−` 行数、diff、撤销全部来自检查点 diff——工具 hunks / Code Mode
   录制 / 跨轮拼接近似全部退役。
3. 回滚对话 = 整树恢复到该检查点，**丢弃其后一切写盘**（含终端/外部与手动修改），
   消息入口同时就地遮蔽对话行。
4. 点击文件名 → 打开审查界面看完整 diff。
5. 展示面 = live 条（会话累计净变化）；归属只作信息徽标。

## 二、删除清单

| 项 | 结局 |
| --- | --- |
| 工具 hunks 管线（`deriveSessionChanges` / `deliverablesDefinition` 的 hunks / `filterRewoundTurns` / `mergeRecordedTurns` / `mergeToolFsEntries`） | 全删；`turn-deliverables` 收缩为「文件提及词汇（仅路径）」 |
| Code Mode（run_code）录制管线（`recorded` 远端 + 宿主录制/持久化 + 客户端合并 + `coalesceCreatedFileDiffs`） | 全删；hunk 反推内核提为 `client/diff-build.ts` |
| BEFORE 日志 + `kind 'message'` partial 恢复点（`before-capture` / `before-journal` / `ensureMessageRestorePoint` / `partial`·`createdPaths`） | 全删；检查点缺失即如实提示 |
| 子集恢复（`paths` 计划、勾选清单、`autoSelect` 归属默认勾选、`subset-plan.ts`） | 全删；`planRestore` 不再接受 `paths` |
| fork（`both` 模式、`createConversationRestart`、`lineage.json` / lineage 端点 / 时间线徽标） | 全删 |
| 多会话写入确认弹窗、工具条目的回滚遮蔽谓词（`isToolEntryRewound`） | 全删（CAS 冲突仍走三选项弹窗） |
| 死字段/死文案：`planTtlMs`·`expiresAt`·`PlanFreshness`·`plan.skippedPaths`·`RestoreResult.warnings`·`activeSessionIds`·`snapshotBlocked` 等 | 全删 |
| 命令面 `/shadow-undo`、`/shadow-inplace`、`/rewind` | 已移除（保留 `/shadow-diff`） |

## 三、新增/归一

- **服务端 `cumulative` 清单**（`/shadow-rewind/fs-changes`）：同一路径跨轮的净变化
  = diff(最早触碰轮起检查点, 最后一次触碰轮末/当前磁盘)；单轮路径复用该轮预算结果
  （零额外读取），跨轮路径按两侧重算净行数。live 条只消费这一份，客户端零推导。
- **预览逐文件净行数**：`/shadow-rewind` 预览的每条变更由服务端算好 `added/removed`，
  与恢复后的清单同口径。
- **唯一遮蔽谓词**：`isFsTurnRewound(marks, turnStartSeq, path)`——整树恢复
  （`paths = null`）遮蔽屏障前的全部条目。
- **可逆判定单点**：`reversibleOf`（目录 / mode-only / 整文件增删 / 完整 hunk 序列），
  客户端只做形状闸，真值仍由宿主 `inspectOne` 巡检给出。
- **归属降级为徽标**：`attributePaths` 只产出 `owner`；不参与可见性、勾选或默认行为。

## 四、测试与文档

- 测试：`pnpm run check` → 155 用例 / 151 通过 / 0 失败（4 skip = POSIX-only 与 jj 降级）。
  删除 `before-journal.test.mjs`、`chaos-composite.test.mjs`、`client-recorded-diffs.test.mjs`；
  新增 `client-diff-build.test.mjs`；`client-session-changes.test.mjs` 改写为路径键 + 可逆判定。
- 文档：README / docs/features.md / docs/manual.md 全部改写为单源语义。