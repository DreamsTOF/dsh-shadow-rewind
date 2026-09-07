# 每轮 diff 是怎么来的

这一章回答插件最核心的问题：**「每一轮改了什么」这个清单是怎么生产出来的**。下面的数据流图从左到右分五个阶段：触发 → 捕获 → 持久化 → 对比 → 呈现。

<iframe src="diagrams/turn-diff-dataflow.html" title="每轮 diff 数据流" style="width:100%;height:640px;border:0;border-radius:8px;"></iframe>

## 触发：双相位自动检查点

- **轮起（phase=start）**：`agent/pre-step` 事件 `step===1` 时触发（`src/rewind-host.ts:116-121`），经 `createTurnCheckpoint` 持久化为一条 turn manifest（`src/engine.ts:388-466`）。同一回合同一相位的重复请求幂等返回已有检查点（duplicate 检查）。
- **轮末（phase=end）**：订阅 `session/event` 的 `turn/end`（`src/rewind-host.ts:123-126`），在轮结束那一刻冻结树状态（`captureEnd`，`src/rewind-host.ts:130-178`），并把轮窗口内的内容型工具调用摘要（`intent`）一并写入——标签来自 `collectTurnIntent`（`src/trace-replay.ts:189-208`），解析失败只少标签、不影响检查点。

两个相位各自计配额、互不挤占（`createTurnCheckpoint` 内的修剪按 `phase` 分组取最新 `maxTurnCheckpointsPerSession` 条）。轮起捕获的失败被归类为「可预期跳过」（`isCheckpointSkipCode`，`src/engine.ts:1368-1374`）并持久化到 `turn-outcomes/`，UI 重启后仍能看到「这一轮为什么没有检查点」。

## 捕获：扫描 → 稳定读取 → 增量

1. **目录扫描**（`scanWorkspace`，`src/scan.ts:116-229`）：显式栈遍历（防爆栈），命中排除规则的整棵剪枝，符号链接一律不跟随，超限/不支持的类型显式记录为 `skipped`（`too-large` / `unsupported-type`）。空目录 = 访问过的目录减去有入选内容的祖先（`src/scan.ts:206-217`）——非空目录由子条目隐式表达，快照只单独记录纯目录的增删。
2. **稳定读取**（`stableRead`，`src/capture.ts:148-183`）：`O_NOFOLLOW` 打开防符号链接偷换，打开前后 stat 完全一致才采信，重试 3 次耗尽记 `read-failed` 跳过，绝不拖垮整个检查点。
3. **增量判定**（`captureSnapshot`，`src/capture.ts:61-137`）：stat 指纹（size/mode/mtimeNs/ctimeNs/dev/ino，`src/capture-cache.ts:103-111`）命中缓存的文件直接复用上次内容，**零重读**。命中前有一道存在性校验 `verifyContent`（`src/engine.ts:257-262`）：jj 模式 stat 镜像文件、sqlite 模式 stat 内容库行——存储被 GC 或影子仓库被外部清理后，命中项在这里被识别为失效并重读，**绝不产生死引用**。

缓存的自我定位写在 `src/capture-cache.ts:9` 的注释里：*缓存只是加速结构，永不参与正确性*。损坏（校验和不符）即整体作废回落空缓存（`src/capture-cache.ts:39-47`）。

## 持久化：双后端

- **jj 后端**：把 `newContent` 写进影子仓库内的工作副本 `checkpoint/` 镜像（原子写：临时文件 + fsync + rename，`src/jj-backend.ts:225-243`），清掉工作区已不存在的路径（`pruneExtra`，`src/jj-backend.ts:251-319`），然后一次显式 `jj commit`。manifest 记录 **git commit id（40 位 hex）而不是 change id**——jj 各版本 change id 长度不一、部分版本不能当 revset 字面量，而插件的历史只追加、永不 rebase，commit id 在任何版本都能被 `-r` 稳定解析（`src/jj-backend.ts:181-192` 注释）。读回用 `jj file show`（0.40 起从 `jj cat` 迁移，两个子命令都试，`src/jj-backend.ts:207-221`）。
- **sqlite 后端**：`node:sqlite` 单文件，`PRAGMA journal_mode = WAL` + `synchronous = FULL`（与逐文件 fsync 持久性同级），内容寻址表 `blobs(hash PRIMARY KEY, ...)`（`src/store.ts:267-281`）。批量写入单事务，冲突时读回比对哈希（`putSqliteBlobs`，`src/store.ts:288-323`）。
- **降级**：配置 `jj` 但宿主机没有 jj CLI 时自动落 sqlite，降级原因写进启动日志（`src/engine.ts` 构造函数）。
- **自愈**：影子仓库丢失（`JJ_REPO_LOST` 或 "no jj repo"）时删残骸、清缓存、重试一次；关键不变量是仓库丢失时 `verifyContent` 必然拒绝所有命中项，所以首轮捕获已是全量重读，重试无需重新扫描（`persistJj`，`src/engine.ts:316-350`）。

## 对比：轮配对与归属

**轮配对语义**（`src/rewind-host.ts:1583-1677`）：第 N 轮的文件系统变更 = `diff(第 N 轮轮起检查点, 第 N 轮轮末检查点)`。轮末检查点把窗口终点从「下一轮轮起」收紧到「本轮轮末」，轮结束后的写盘不再混入本轮；旧数据或轮末捕获失败时回退旧语义（下一轮轮起，`endByTurn.get(current.turn) ?? next`）。树间 diff 本体是 `diffTrees`（`src/manifest.ts:62-91`；全树哈希 `hashTree` 在 K-8 归一后只有这一份实现，`src/capture.ts:21` 只是转引）：内容寻址等价比较，产出 `added / modified / deleted / mode-changed / type-changed` 五类。

**live-tail**：尚无轮末快照的最新一轮（进行中的回合），配对终点是哨兵 `'live'`——「最后轮起检查点 vs 当前磁盘」（`src/rewind-host.ts:1618-1640`）。已有轮末快照的轮不再发 live 条目，否则轮结束后的外部写盘会被误挂到该轮头上。

**窗口归属**（`attributePaths`，`src/attribution.ts:32-72`）：检查点在回合开始捕获，因此窗口 `[S_j, S_{j+1})` 的写者就是 S_j 的会话。把目标检查点、窗口内所有快照、当前树排成状态序列，逐边界比较条目键，变化的边界就是写者。产出四类标签：`target / session / multi / unknown`——**只是勾选清单的建议标签，勾选权在用户**；归因失败时保守保留全部路径（`computeTurnFsChanges`，`src/rewind-host.ts:1330`），同一路径被多会话触碰（multi）时从单会话视图剔除。

**服务端行数预算**：`fs-changes` 端点在服务端把每条变更的 +/− 行数算好随清单下发（`withLineCounts`，`src/rewind-host.ts:1259-1303`），单请求预算 600 条（`DIFF_COUNT_BUDGET`）、单侧 2MB（`DIFF_COUNT_MAX_BYTES`）、非 UTF-8 按「统计不可得」处理。客户端因此能**零全文请求**渲染文件行与统计条——全文只在悬停/展开/撤销时按需拉取。

## 呈现：计数先行、全文按需

客户端的懒加载分层（`src/client/fs-diff-utils.ts`）：

- `warmFsChanges` 批量预拉 + 2s 节流 + `rev` 跳过（`:169-228`）；
- 占位形态 `fsTurnReviews` 零全文渲染（`:313-324`）；
- 全文按 `(turnStartSeq, path)` 记忆化懒取（`ensureFsFileDiff`，`:331-371`，容量上限 512），该轮缓存条目被 warm 替换时记忆自动失效——live 条的磁盘内容会随回合推进变化，绝不能跨更新复用。

形状契约与宿主对齐：**新增文件 `oldText = null`（撤销 = 删文件）、删除文件 `newText = ''`（撤销 = 写回旧内容）、修改文件切真正的行级 hunks**（`generateFsDiff`，`:267-307`）——这三种形状正是下一章 hunk 撤销服务的输入。

## 轨迹重放：第三条证据链

时间线面板的轨迹节点不依赖快照存活。`traceNodes`（`src/trace-replay.ts:211-240`）把全部 `tool/call` 边界投影成节点；`traceRangeDiff`（`:417-455`，K-8/B-1 起接受 `baseline` 参数为触碰路径补基线，`:421-425`）把区间 `(from, to]` 内的内容操作重放成两个状态图再 diff：

- `write` 直接覆盖；`edit` / `str_replace` 要求 `old_string` 在当前重放态中找得到，找不到记「重放漂移」note 并跳过（`replayUntil`，`:368-404`）——**绝不猜着改**；
- 失败调用不重放；结果缺失（回合进行中）按成功重放并在 notes 计数（`contentOps` 内，`:276-278`）；
- 固有盲区在响应末尾诚实标注：「轨迹重放只覆盖会话内的内容型工具；终端命令与外部进程的写盘不可见——请用快照检查点对比」（`:454`）。

已知天花板也有 TODO 记录：文件在会话开始前就存在但从未被内容型工具写过时，重放图里没有它的基线，区间 diff 会把它标成 `added`（`src/trace-replay.ts:17-19`）。
