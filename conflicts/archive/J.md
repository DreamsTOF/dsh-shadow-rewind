# 冲突组 J —— 客户端合并层：同一份事实的多种读法（决策文档）

> 冲突描述：卷二 J1–J8。先说依赖：J-1/J-2/J-3 的根源是「同一份轮清单两处
> 推导」（卡片 vs 侧栏），A-2 收敛后自然消失大半——**不建议在 A-2 之前
> 单独修这三个**。其余是独立小修，可先行。

## 随 A-2 收敛（不单独做）

- J-1 surface 闸（卡片排除 replacement-surface、侧栏计入）
- J-2 参数残缺 write/edit（卡片丢弃、侧栏幽灵条目）
- J-3 轮归属两套算法（侧栏虚构「下一轮 live」）

## 独立小修包（互不依赖，可一批上）

1. **路径归一（J4）**：客户端列表层加一个 `toPosix`（win32 再加小写）helper，
   替换四处裸 `===` 比较（live-bar.tsx:155、FileReviewTab.tsx:982、
   session-changes.ts:227/346、fs-diff-utils.ts:361），与服务端 path-utils
   的正斜杠语义对齐。代价：小。不修的后果：反斜杠/绝对路径的工具调用与
   fs 条目重复成行、+/− 统计劈半——Windows 上最容易撞到的一条。
   `buildDirTree` 只按 `/` 切的问题顺带解决（归一在先）。
2. **CRLF 行数口径（J5）**：`diffContentLines` 切行前 `normalizeNewlines`
   （一行；只影响计数，渲染原文可保留 `\r`）。同批：UnifiedDiff.tsx:427
   硬编码 `'M'` 改为按 kind 传参（一行级）。不修的后果：徽标 +0/−0 与
   悬停浮层 +1/−1 并存；新增文件在时间线头部标 M。
3. **ensuredFs 失效（J6）**：FileReviewTab 在 fsRaw 更新时 clear
   `ensuredFsRef`（一行）；侧栏接入 warm 缓存广播（几行，消除双通道）。
   不修的后果：侧栏刷新后仍展示过期全文 diff。
4. **空文件（J7）**：recorded-diffs.ts:44 条件放宽为与 fs/write 路径一致
   （`before===null` 保留空 after）；同步检查 session-changes.ts:345 的
   `diffs.length===0 → continue` 不会把它丢掉。代价：极小。
5. **status-dedupe 覆盖 Tab（J8）**：FileReviewTab 的 status invoke 套上
   现成的 `dedupeStatus`。代价：极小。

## 推荐

独立包 1–5 一批上（全是极小到小）。1 和 2 是用户最容易实际撞到的两个。
J-1/2/3 等 A-2。
