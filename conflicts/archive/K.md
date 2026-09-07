# 冲突组 K —— 存储与生命周期：同一职责的多套实现（决策文档）

> 冲突描述：卷二 K1–K9。与其它组几乎无依赖，按条独立取舍。

## K-1：影子仓库重建后的死恢复点（卷二 K1）

- **方案 1a（极简分支，自用倾向）**：`JJ_REPO_LOST` 重建时直接清掉该工作区
  的 store manifests（历史恢复点列表随之清空）。语义诚实——内容确实没了，
  列表不该再展示。改动：重建路径加一次清理。代价：极小。
- **方案 1b（保列表）**：manifest 加 `degraded` 字段，重建时批量标记，
  列表端点标注「内容已失，不可恢复」。改动：engine + manifest + 客户端列表。
  代价：中。仅在你在意重建后仍要看到历史清单时值得。

## K-2：字节闸只在 jj 后端生效 + 错误分类错位（卷二 K2）

- putSqliteBlobs 前补累加字节闸（小）；`TURN_CHECKPOINT_NEW_CONTENT_LIMIT`
  对手动 `create()` 不归类为「可预期跳过」（小）。两处独立。

## K-3：rescue 与 user 共用一个配额旋钮（卷二 K3）

- 加 `rescueMaxRestorePoints` 配置，默认沿用现值。代价：极小。
- 或接受牵连并在配置注释里注明（零改动）。

## K-4：GC 行为三种 + 时机嵌在恢复事务中间（卷二 K4）

- turn/rescue 修剪处补 `collectGarbage` 调用（两处各一行）；
  createLocked 里 GC 挪到 rescue 修剪之后（一行挪动）。
- applyRestore 中途的 GC：自用低并发下竞态影响小，可不动（诚实评估）。
- `store.closeAll` 挂 dispose：一行，可选。
- 代价合计：极小。

## K-5：内容可读性抽样 1 个 vs 恢复全量校验（卷二 K5）

- 折中：抽样提到 3 个（最小/最新/随机各一），失败标 degraded。
  全量化会让大检查点的 /fs-changes 变慢，不建议。代价：小。

## K-6：jj 中断半写毒化检查点（卷二 K6）

- **做法**：`TURN_CHECKPOINT_NEW_CONTENT_LIMIT` 抛出前 try/finally 清理镜像
  半写文件（或该次捕获涉及的镜像路径重置）。改动：jj-backend 一处。
  代价：小。
- 不建议改 verifyContent 去查 commit 可达性——每次缓存命中都要跑 jj 命令，
  这个代价是真实的且持续发生。

## K-7：只读端点不加锁的读竞态（卷二 K7）

- 用现有 withLock 包住只读清单读取。代价：小。
- 自用单窗口场景并发低，可缓；多开窗口/脚本轮询 /fs-changes 时再上。

## K-8：逐字双份与三种 containment（卷二 K8）

- hashTree/checksumOf/basename/producedDiffs 等导出单一实现共享：机械工作，
  半小时内。注意 hashTree 统一后必须全量测试（manifest 校验路径全覆盖），
  且**两侧实现当前必须逐字相同才能安全合并**——合并前先 diff 确认。
- containment 三选一统一（建议以 path-utils.isWithin 为准，其余两处改调它）；
  live 读（/file?checkpointId=live）补符号链接拒绝，与 file-review 对齐——
  这是安全面（工作区内指向外部的软链接可被读出），建议修，小。
- turnEndSeq 死字段删除：一行。

## K-9：陈旧注释与文案（卷二 K9）

零风险清理，随手做：rewind-host.ts:1647 头注释更新为轮末优先语义、
live-bar「四行」注释、engine.ts:980 中文跳过原因走 locales、chat-locales
死键清理。

## 推荐

K-1（选极简分支）/ K-2 / K-4 / K-6 / K-8 优先；K-3 / K-5 / K-7 自用可注明
接受现状。
