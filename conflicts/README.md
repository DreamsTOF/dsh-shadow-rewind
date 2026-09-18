# 冲突文档索引

> **当前有效决策**：[DECISION-single-source.md](DECISION-single-source.md)
> —— 单源收敛（本轮）：每轮 = 一个检查点；变更清单/行数/diff/撤销全部来自检查点
> diff；回退 = 整树恢复 + 就地遮蔽；工具 hunks、Code Mode 录制、BEFORE 部分树、
> 子集勾选、fork、lineage 全部退役；归属只作信息徽标。
>
> **历史决策**：[DECISION-final-scope.md](DECISION-final-scope.md)（上一轮，全部 16 项拍板）
> —— 其中「A 组现状接受（两套管线并存）」「E 重复记账接受」「H 两套 CAS」等条目
> 已被本轮单源收敛取代；其余（K 组存储正确性、J 客户端修复、G-1/G-2、F-1 等）仍有效。

## 目录结构

- `DECISION-single-source.md` —— **当前定稿**：删除清单、新增/归一、测试与文档影响。
- `DECISION-final-scope.md` —— 上一轮定稿（终端监听/写入闸移除 + 四批次修复），
  部分条目被本轮取代，保留作历史。
- `archive/A.md … K.md` —— 十一组冲突的原始分析（file:line 证据链）；
  行号以当时的代码为准。
- `archive/DECISION-drop-terminal-audit.md`、`archive/DECISION-single-component.md`
  —— 更早的过程决策，留档。
- 项目根目录 `ARCHITECTURE-CONFLICTS.md`（卷一 A–E）与
  `ARCHITECTURE-CONFLICTS-II.md`（卷二 F–K）为分析原始出处，保留。