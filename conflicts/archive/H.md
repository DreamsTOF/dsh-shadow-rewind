# 冲突组 H —— 撤销状态机的多套真值（决策文档）

> 冲突描述：卷二 H1–H9。本组分三批：**极小批**（互相独立、随时可上）→
> **小批**（单处逻辑改造）→ **收敛批**（依赖 F-1 与 A-2 之后才有意义）。

## 极小批（一批上，互相独立）

### H-4：run_code 录制 LF 归一（卷二 H4）

`recorded-diffs.ts:46-50` 入口对 before/after 补一次 `normalizeNewlines`，
与宿主匹配基准、fs 条目产线对齐。代价：一行 + 一个 CRLF 录制用例。
不修的后果：CRLF 文件的 run_code 变更撤销/重做永远显示「内容冲突」。
与 [E.md](E.md) E-2 同一段代码，建议同一次改。

### H-5：undo 部分成功不销毁记录（卷二 H5）

`engine.ts:996` 的删除条件改为「undonePaths 覆盖全部请求路径才 delete」。
代价：一行。副作用：undoRecords 常驻内存多留一轮，可忽略。

### H-6：fork 补偿跳过 undoRecords（卷二 H6）

补偿回滚（`rewind-host.ts:768-784`）用的 applyRestore 加一个内部
`skipUndoRecord` 参数（或补偿前 delete 该工作区记录）。改动：engine 一处
内部参数。代价：极小。不修的后果：「撤销恢复」被静默反转为「重新应用恢复」。

### H-9：rev 补全 + fs-changes 读序（卷二 H9）

`handleRestoreUndoHttp` 与 `runShadowUndoCommand` 两处补
`bumpWorkspaceRevision`（两行）；fs-changes 把读 rev 挪到读检查点列表之前
（一行）。代价：极小。不修的后果：撤销恢复后客户端缓存展示与磁盘相反，
与 H-6 叠加时尤其危险。

## 小批

### H-3：三套 CAS 的最小对齐（卷二 H3）

- **做法**：fs 形状路径（file-review-service.ts:392-420）两处对齐：
  ① 写回时 `stat.mode` 原样恢复，不回落 0o644；② 写回用 `restoreNewlines`
  按原行尾风格（hunk 路径的现成函数直接复用）。
- **代价**：小（约 10 行）。不追求三处判定语义完全相同——那个正解是全局
  世代计数，要动 file-review + engine + 客户端，且对外部编辑器这种不在
  世代内的写入者本来就无效，自用不值得。天花板如实标注：对齐后三处语义
  仍不严格相同，只是「一种撤销的副作用引爆另一种撤销的验证」这条路径被拆掉。

### H-7：恢复找回的文件防「redo 再删」（卷二 H7）

- **实用解**：恢复成功后客户端对受影响轮强刷一次 status（rev bump 已触发
  清单重拉，补一条「重拉后对本轮发 status」）。代价：小。
- **完整解**（恢复时间戳失效判定）代价中，自用不建议。天花板：时间窗口内
  （恢复完成到 status 返回之间）用户点 redo 仍可再删，有 rescue 副本兜底。

### H-8：rescue 修剪纳入 undoRecords + file-review/rescue 目录上限（卷二 H8）

- 前者：`isReferencedByRecovery`（engine.ts:1222-1226）补查 undoRecords
  引用的 rescuePointId——引擎内部数据，几行。
- 后者：`writeRescueCopy` 落盘前按数量上限清最旧（file-review/rescue/ 现在
  无限增长）。代价：小。

## 收敛批（等 F-1 与 A-2）

### H-1：可逆判定收敛到服务端单源（卷二 H1）

- **做法**：删掉客户端两套 `isReversible`/`reversiblePaths` 的本地判定，
  统一由 status 巡检结果驱动按钮 disabled；首帧乐观渲染 + 巡检修正。
- **代价**：小到中（两个组件删代码为主 + 点击时序要容忍巡检未回）。
- **依赖**：F-1 修复后服务端判定本身才正确，本方案在那之后做才有意义。

### H-2：混合态表达（卷二 H2）

- **完整解**：per-hunk 状态，服务端与客户端都要改。代价大，自用不建议。
- **实用解**：客户端合并状态时要求「同 path 且同 diff 集」才允许 apply
  结果覆盖全量巡检结果（合并键加 diff 签名，一处改动）；conflict 文案补
  「可能因存在部分撤销」。代价：小。
- **天花板（ponytail 级折衷）**：全量巡检仍会周期性把混合态标回 conflict，
  只是不再随「最后写入者」震荡。

## 推荐

极小批（H-4/H-5/H-6/H-9）随时一批上；H-3/H-8 第二批（可与 D-1 同一次动
file-review）；H-1/H-2 待 F-1 与 A-2 之后。
