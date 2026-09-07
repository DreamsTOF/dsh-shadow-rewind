# 总体架构

下面这张图是插件的全景：浏览器半边、宿主进程内的五个模块、被管理的工作区和插件存储根。图可缩放、可点节点看关系、可切换明暗主题。

<iframe src="diagrams/architecture.html" title="dsh-shadow-rewind 总体架构" style="width:100%;height:780px;border:0;border-radius:8px;"></iframe>

## 模块清单

| 节点 | 源码 | 职责 |
| --- | --- | --- |
| 轮检查点协调器 | `src/rewind-host.ts:93-267` `TurnCheckpointCoordinator` | 挂 `agent/pre-step` 与 `session/event`，触发轮起/轮末捕获；同工作区捕获串行化 |
| ShadowRewindEngine | `src/engine.ts:159-1345` | 捕获、对比、计划、恢复、撤销、崩溃恢复的全部状态机 |
| `/shadow-rewind` HTTP | `src/rewind-host.ts:457-481` 注册，`526-1855` 各 handler | 预览、计划铸造、恢复执行、轮配对变更、轨迹时间线、文件内容读取 |
| FileReviewService | `src/file-review/file-review-service.ts` | hunk 级撤销/重做的服务端（Typert `fileReview`），fs 形状与目录条目也挂同一模型 |
| 影子 jj 仓库 | `src/jj-backend.ts:91-211` `ShadowJj` | 每工作区一个隐藏 jj 仓库，快照镜像 + `jj commit` |
| SQLite 内容库 | `src/store.ts:251-358` | `node:sqlite`（WAL + FULL）内容寻址 blob，jj 缺失时的降级后端 |
| 清单/stat 缓存 | `src/store.ts` + `src/capture-cache.ts` | manifest 与增量指纹缓存的持久化 |

## 关键设计取舍

**为什么协调器 prepend 在 `agent/pre-step` 最前面？** 轮起检查点必须抢在 Agent 第一步的任何工具调用之前，否则第一笔下盘就漏拍。`src/rewind-host.ts:116-121` 用 `{ prepend: true }` 保证先于其它监听器执行，且 `step === 1` 才触发——同一轮的后续步骤不重复捕获。

**为什么快照失败绝不阻塞回合？** 自动检查点是尽力而为的旁路：`TurnCheckpointCoordinator.capture` 把捕获包在 deadline（`turnCheckpointTimeoutMs`，默认 5s）里与回合解耦（`src/rewind-host.ts:181-252`），失败只记内存状态 + 可持久化的跳过记录（`recordTurnCheckpointSkip`，`src/engine.ts:498-513`），预览接口在检查点缺失时把 `pending / skipped / failed / missing` 状态如实报给 UI（`src/rewind-host.ts:839-862`）。

**为什么同工作区捕获要串行化？** 两个会话同时开轮时，交错的快照会拍到「半新半旧」的树。协调器用 `workspaceTails` 尾队列把同一 cwd 的捕获排队（`src/rewind-host.ts:256-270`），引擎侧还有第二道 `lock.json` 互斥（`src/store.ts:91-136`）。

**为什么两个内容后端是互斥的？** manifest 的 `storage` 字段只允许 `jj` 或 `sqlite`（`src/manifest.ts:114-119`）：jj 后端记录 40 位 commitId、按 change 读回；sqlite 后端按 blob 哈希读回。一个恢复点的字节只存在于一处，读回路径由 manifest 自描述（`src/engine.ts:1129-1146` `readSnapshotContent`），不存在跨后端混合。

**浏览器半边怎么知道数据变了？** 服务端维护进程内的工作区数据版本 `rev`（检查点捕获/恢复成功即递增，`src/rewind-host.ts:1158-1169`），`fs-changes` 响应携带该版本；客户端 warm 层发现 `rev` 未变就整轮跳过（`src/client/fs-diff-utils.ts:200-228`），正确性不依赖 JSON 深比较。

## 图表的取材口径

架构图里 FileReviewService 没有画到工作区的连线：它的逐 hunk 写盘（撤销/重做）确实落在工作区文件上，但为了主图干净，这条边用卡片文字表达（「工具 hunk：轮尾卡片逐块撤销/重做」），完整语义在[文件审查半边](file-review.md)一章展开。
