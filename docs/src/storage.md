# 存储层：影子仓库与清单

存储根 `$DSH_HOME/shadow-rewind/v1`（`src/engine.ts`）下每个工作区一套状态。本章逐个说明每个文件是什么、谁写它、损坏了会怎样。

## 目录布局与 key 派生

```text
$DSH_HOME/shadow-rewind/v1/
├── workspaces/<key>/                  key = sha256(canonical cwd)[0:16]
│   ├── workspace.json                 binding：身份的权威校验（src/store.ts）
│   ├── stat-cache.json                stat 指纹缓存（加速结构，永不参与正确性）
│   ├── manifests/rp_*.json            恢复点清单（user / turn / rescue）
│   ├── turn-outcomes/<hash>.json      自动检查点跳过记录（重启后 UI 可见）
│   └── content.db                     SQLite 内容库（sqlite 后端）
└── shadow-repos/<key>/                影子 jj 仓库（jj 后端）
    ├── .jj/
    └── checkpoint/                    快照镜像工作副本
```

> EXPECTED-DESIGN 1.4：`lock.json` 工作区互斥与 `operations/` 操作日志目录已废除——前者消灭僵尸锁与 PID 复用死锁隐患（并发一致性由单实例假设承担），后者在两态翻转模型下失去意义。历史遗留的这两个文件不再被读取，可手工清理。

key 截断 16 位 hex 是刻意的：Windows MAX_PATH 下深层 `.jj` 内部路径很长，全长 64 位 hex 容易触顶；16 位（64 bit）对自用场景碰撞可忽略。哈希碰撞或目录复用的后果由 binding 文件兜底：`workspaceDir` 发现 binding 里记录的工作区与请求不一致时直接抛 `STATE_CORRUPT`。

工作区改名/移动后得到全新 key，旧数据原样保留——不迁移、不删除，隔离即正确。

## manifest：自描述且 fail-closed

一条 manifest（`rp_<timeBase36>_<rand12>`）记录：

| 字段 | 说明 |
| --- | --- |
| `kind` | `user`（手动恢复点）/ `turn`（轮起/轮末自动检查点）/ `rescue`（恢复前自动备份） |
| `storage` + `commitId` | jj 后端必须携带 40 位 commitId；sqlite 后端禁止携带（`src/manifest.ts:114-119`） |
| `entries` | `path → {kind: file/symlink/dir, blob, size, mode, mtimeNs?, target?}` |
| `treeHash` | 全树确定性哈希 |
| `skippedPaths` | 过大 / 不支持 / 读取失败路径的显式记录 |
| `sessionId` `turn` `turnStartSeq` `phase` `intent` | turn 检查点的窗口元数据（`src/manifest.ts:145-163`：只有 turn 检查点允许携带） |

**读取即全量校验**（`parseManifest`，`src/manifest.ts:102-189`）：版本、id 形状、kind、路径合法性、每个 entry 的哈希形状、`fileCount` 与条目数一致、`totalBytes` 与条目累计一致、`treeHash` 与条目重算一致——任何一项不符抛 `STATE_CORRUPT`。这是「自产自销的数据也要按不受信任输入对待」的立场。

**treeHash 刻意不含 mtimeNs**（`src/manifest.ts:24-27` 注释；K-8 之后这是全仓唯一实现）：树哈希是内容寻址，恢复写回不保留时间戳——若时间戳进哈希，恢复后树哈希必变，会击穿 `planRestore` 的树哈希 CAS。

## 锁：已废除

EXPECTED-DESIGN 1.4 拍板：`lock.json` 互斥（O_EXCL 独占创建 + pid 判活 + staleLockMs 回收）整体移除。理由：进程异常崩溃留下的僵尸锁与 PID 复用误判是自用场景下真实发生过的问题，而它防的「双 DSH 实例互踩存储」在单实例假设下不成立。代价（如实）：两个实例同时写同一工作区的 manifest / stat-cache 无互斥，数据一致性自担。同工作区**快照捕获**的串行化仍在（协调器尾队列，`src/host/coordinator.ts`）——那不是锁用户，是防止交错的「半新半旧」快照。

## 内容寻址与 GC

- sqlite 后端：`putSqliteBlobs` 单事务批量写，冲突读回比对（`src/store.ts:277-312`）；读回时校验哈希（`readSqliteBlob`，`:333-345`）。
- GC 只删未被任何 manifest 引用的内容行（`collectGarbage`，`src/store.ts:348-369`），且**一旦真删了内容就必须同步作废 stat 缓存**——否则下一次命中会把已删除的 blob 引用进新 manifest（`src/engine.ts` 的 `createLocked` 与 `delete` 里两处注释都在强调这条）。
- jj 后端的影子 change 不随 manifest 删除：change id 是内容历史的地址，保留无害，批量 abandon 属于运维操作，不混进插件生命周期（`src/engine.ts` `delete` 内注释）。

## 配额与修剪

| 配额 | 默认 | 规则 |
| --- | --- | --- |
| `maxRestorePoints` | 50 | 只统计 user 恢复点；rescue 是自动安全网不挤占手动配额（`src/engine.ts:354-361`） |
| `maxTurnCheckpointsPerSession` | 30 | 每会话**每相位**各保留最新 N 条（轮起与轮末互不挤占，`src/engine.ts:423-434`） |
| rescue | ≤ maxRestorePoints | 超出淘汰最旧，被恢复日志引用的除外（`src/engine.ts:640-650`） |
| `maxFiles` / `maxFileBytes` / `maxSnapshotBytes` | 20000 / 16MB / 512MB | 扫描与捕获阶段的硬闸（`src/capture.ts:61-77`），超限路径显式跳过而非静默失败 |

删除恢复点不再需要确认串（EXPECTED-DESIGN 1.4 #2）；被进程内 undo 记录引用的 rescue 点仍拒绝删除（`isReferencedByUndo`）——那是「撤销最近一次恢复」的命脉。

## stat-cache.json

结构 `{version: 1, paths: {path → CacheEntry}, checksum}`，checksum 是内容哈希防篡改，损坏整体作废（`src/capture-cache.ts:31-47`）。CacheEntry 记 stat 指纹 + 上次内容哈希（`src/capture-cache.ts:17-29`）。三个失效触发点：GC 真删了 blob、影子仓库丢失自愈、缓存自身损坏——分别见 `src/engine.ts:636-638`、`:332-334`、`src/capture-cache.ts:39-47`。
