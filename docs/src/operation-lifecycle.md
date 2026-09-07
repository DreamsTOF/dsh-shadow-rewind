# 恢复执行的两态模型

> EXPECTED-DESIGN 1.4（2026-09）落地：持久操作日志状态机（`running / rollback-running / completed / rolled-back / interrupted / recovery-required`）已整体废除。本章描述取代它的「两态翻转」模型；旧版状态机图见 git 历史。

## 两态翻转

任何恢复操作只存在两个良定义状态：

- **状态 A**：操作前的磁盘状态（= 恢复前自动创建的 rescue 备份点）；
- **状态 B**：操作后的目标状态（= 所选恢复点的快照）。

执行要么完整落到 B（restorePaths + verifyRestored 全部通过），要么整体停在 A（失败即从 rescue 点自动回滚）。不存在半应用、半撤销的中间态，磁盘上也没有需要人工对账的持久记录。

## 失败语义

| 情形 | 行为 |
| --- | --- |
| 主恢复失败（写盘 / 验证抛错） | 进程内立即从 rescue 点回滚全部涉及路径，成功后抛 `RESTORE_FAILED_ROLLED_BACK`——停在状态 A |
| 回滚也失败 | 抛 `RECOVERY_REQUIRED`；rescue 点仍在，翻转可幂等重跑——用户重试即收敛，不再有持久化的挂起状态 |
| 进程在恢复中途崩溃 | 磁盘可能停在中间状态；rescue 点持久存在，用户（或重启后的恢复）从 rescue 点重跑翻转即收敛 |

「恢复文件并从这里继续」的会话分叉失败时的补偿回滚同样遵循两态模型（补偿本身也是一次 applyRestore，`skipUndoRecord` 防止覆盖 undo 单槽）。

## undo 记录与 rescue 的关系

`completed` 后引擎在进程内记下 `undoRecords`（workspace → 逐路径 before/after）。它不是持久状态——重启即失效，持久兜底永远是 rescue 检查点本身。undo 记录引用的 rescue 点有独立的「活的引用」保护：被 undo 记录引用的 rescue 点拒绝删除、拒绝修剪（`isReferencedByUndo`），保证「撤销最近一次恢复」在用户点击时可用。
