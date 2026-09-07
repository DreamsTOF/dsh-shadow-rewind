# 文件审查半边：hunk 级撤销

前几章的快照/恢复管线动的是「整棵树」；这一章的服务动的是「文件里的几个块」。`FileReviewService`（`src/file-review/file-review-service.ts`）经 Typert `fileReview` 命名空间暴露给浏览器，三条并行的执行路径共用同一套 `applied / undone / conflict` 状态模型：

1. **hunk 文本回放**：工具结果与 Code Mode 录制的常规改动；
2. **fs 整文件形状**：检查点对比派生的终端写盘（新增/删除/纯权限位）；
3. **目录条目**：mkdir / rmdir 互逆。

全局不变式写在模块注释第一屏（`src/file-review/file-review-service.ts:1-14`）：**绝不猜着改**。提交前的字节级 CAS 已在 H-3 收敛为单一模块 `src/file-review/cas.ts`（hunk CAS 放宽为 LF 归一比较，写回按重读行尾风格）。任何一侧对不上就报 `conflict` 或 `unsupported` 并原样不动。

## hunk 文本回放

撤销（undo）= 把 diff 的每一块从 `newText` 换回 `oldText`，**逆序**执行；重做（redo）= 正序执行（`transformFile`，`src/file-review/file-review-service.ts:436-460`）。定位不靠猜：

- 给了行锚点就做**锚点精确匹配**——该行起始处必须整段等于 `source`（`offsetAtLine` + 前缀比较，`replaceHunk`，`:99-116`）；
- 没给锚点则要求 `source` 全局唯一——出现 0 次或多次都拒绝；
- 空侧必须有行锚点兜底，否则无法定位插入点，直接判 `unsupported`（`hunkSupported`，`:123-128`）。

提交前还有字节级 CAS 复核 + 原子写（`@deepseek-ai/dsh-atomic-write`），CRLF 文件写回仍是 CRLF——所有 hunk 匹配在归一化文本上进行，写回路径把文件自己的行尾风格还原（`normalizeNewlines` / `restoreNewlines` 的模块注释解释了为什么必须归一化）。

**目标文件解析是双重围栏**（`resolveFile`，`:65-79`）：`realpath` 解析前后各校验一次都在会话 cwd 内（符号链接可能把路径指向工作区外）；显式拒绝符号链接与非普通文件；非 UTF-8 内容一律拒收（回放会毁掉字节）。

## fs 整文件形状

检查点对比（终端写盘）派生的条目天然互逆、无需回放（`fsChangeShape`，`:156-172`）：

| 形状 | undo | redo |
| --- | --- | --- |
| `added`（`oldText === null`） | 删除文件 | 写入 `newText` |
| `deleted`（`newText === ''` 且无 `oldStart` 锚点） | 写回 `oldText` | 删除文件 |
| `mode`（内容相同、仅权限位不同） | `chmod(oldMode)` | `chmod(newMode)` |
| `dir`（`dirKind` 显式标记） | added: rmdir（必须仍为空）/ deleted: mkdir | 互逆 |

注意「改到空」与「整文件删除」的区分：带 `oldStart` 锚点的「改成空」hunk 走通用回放路径（要求文件在场），无锚点的才被识别为整文件删除（`oldStart` 守卫注释——识别错了必冲突）。

**删除安全网**：任何走删除分支的 fs 撤销先把即将删除的内容落一份可找回副本到存储根 `file-review/rescue/`，落盘失败则拒绝删除。

## 目录条目

空目录的建/删走 `mkdir` / `rmdir` 互逆，删除侧带「必须为空」闸门——**目录非空时拒绝，绝不递归**（`:349-356`）。

## Code Mode（run_code）录制

嵌套派发（`run_code` 子调用）的文件修改在会话快照里没有 wire 视图，必须在宿主侧录制。装配点在 `src/file-review/host.ts:74-99`：挂 `tools/post-execute` 瀑布，**按结果形状识别**（`{path, before, after}`，不认工具名），只录 `exec.parent !== undefined` 的嵌套调用——模型直接发起的修改已经能通过会话视图审查。

录制的 before/after 持久化到存储根 `file-review/recorded/`，宿主重启后依然可审查、可撤销；损坏记录自愈（README「Code Mode 录制」节）。这里有一个已知风险被决策文档点名：返回该形状的非文件工具会被误录（README「边界」最后一条；决策文档批次 1 的 E-2）。

## 浏览器半边怎么组织这些

- 轮尾卡片（`ProducedFiles.tsx`）：「Edited N files · +M −K」、整轮撤销/重做、逐文件撤销/重做、悬停 diff 浮层、增删比例色条与目录折叠树；
- 侧边栏「文件审查」tab（`FileReviewTab.tsx`）：逐轮分组 + 行级红绿 diff + hunk 勾选（只撤销/重做选中的块）+ 面板拖宽；
- `UnifiedDiff.tsx`：行内字符级下划线高亮（替换对的字符级 diff，自 dsh-edit-diff 移植内核）+ 修改点跳转 + 大 diff 自动折叠；
- 多会话归属徽标随条目透传（`fsAttributionOf`，`src/client/fs-diff-utils.ts:38-43`），合并规则是工具视图优先、fs 条目跳过重复（决策文档 A 组「按现状接受」）。
