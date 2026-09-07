# 冲突文档索引

> **当前有效决策**：[DECISION-final-scope.md](DECISION-final-scope.md)（定稿，全部 16 项已拍板）
> ——删除终端写盘监听 + **写入闸整体移除（恢复也不等空闲）**；其余一切保留
> （精确回滚、diff 视图链、勾选 UI、工具视图、hunk 撤销、trace-replay）；
> 广播器不实施，A 组现状接受；H-3/H-1/H-2 按用户要求做 CAS 与状态的完全归一。

## 决策速览

| | |
| --- | --- |
| **删除** | 终端监听（command-windows + 词法删除 + 窗口归属）、写入闸全链（write-gate/端点/配置/开关/阻塞分诊） |
| **消灭的组** | C、D 全灭；I-1/I-2/I-3/I-4/I-5/I-6 灭；A 现状接受 |
| **修复** | 批次1 P0（F-1 含 strict、G-1/G-2、H-4/5/6/8/9、E-2、I-7/I-8）→ 批次2 归一（H-3 统一 CAS、H-1/H-2 服务端单一事实）→ 批次3 K 组 7 条 → 批次4 J 全包 + B-1 |
| **接受现状** | A（两套管线并存）、E 重复记账、K-3/K-7 |

## 目录结构

- `DECISION-final-scope.md` —— **定稿决策**：删除清单、四批次修复清单、
  消灭总账、README 改写点。
- `archive/A.md … K.md` —— 十一组冲突的原始分析（file:line 证据链）；
  行号以删除重构前代码为准。
- `archive/DECISION-drop-terminal-audit.md`、`archive/DECISION-single-component.md`
  —— 被取代的过程决策，留档。
- 项目根目录 `ARCHITECTURE-CONFLICTS.md`（卷一 A–E）与
  `ARCHITECTURE-CONFLICTS-II.md`（卷二 F–K）为分析原始出处，保留。
