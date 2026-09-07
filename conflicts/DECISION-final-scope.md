# 决策记录（定稿，2026-09）

> 本文档是全部 16 项冲突决策的**定稿记录**，取代 archive/ 中两份过程决策。
> 范围基线：**只移除终端写盘的监听与支持；写入闸整体移除；其余一切保留**。
> 精确回滚（会话内某轮某 diff）、diff 视图链、勾选 UI、工具视图、hunk 撤销、
> Code Mode 录制、trace-replay 全部保留。

## 一、架构收缩（删除项）

### 1. 终端写盘监听（前次决策，维持）

- `src/command-windows.ts` + 装配/持久化、`src/client/deleted-paths.ts` + 消费点、
  `attribution.ts` 窗口证据分支、`commandWindow*` 配置、相关测试。
- 代价（如实）：命令级归因与 fs 条目命令意图摘要消失；live 轮终端删除退为
  live-tail 兜底（秒级延迟）；README 第三节改写。
- 写入闸对终端工具调用的**执行拦截**原随闸移除（见下）。

### 2. 写入闸整体移除（本轮决策：彻底移除，恢复也不等空闲）

- 删除：`src/write-gate.ts`、`/shadow-rewind/gate` 端点、`writeGate`/
  `writeGateAllow` 配置、侧栏运行时开关、`partitionRunningSessions` 阻塞分诊、
  恢复预览的 `restoreBlocked`/`blockingSessionIds` 与客户端「被阻塞静默重试」、
  write-gate.test 与混沌套件的占用分诊/所有权翻转用例。
- 语义后果（如实）：**永久对称模式**——并行写不限制，失去「同一时刻只允许
  一个会话写」；恢复不再等待运行中会话，安全网 = 恢复前 rescue 备份 +
  逐路径哈希/mode 验证 + 失败回滚。多主路径仍按网格归属保守剔除出单会话视图。
- 决策依据（已核实）：「得知哪会话哪轮改了哪文件」由工具事件 + 检查点网格
  完整承担，与闸无关；移除闸是放弃 current-wins 策略，不是消除矛盾——自用
  下双会话真并发写同一文件的场景可接受恢复收敛兜底。
- **随之消灭的冲突组**：D 组全部；I-1（闸开过滤不再存在，归属回归纯建议）、
  I-4（两份清单的差异源是闸过滤）、I-6（claim 顺序随闸消失）。
- README 第四节（两种恢复语义）改写为单一对称叙事。

### 3. 不实施项

- 文件广播器（A-1 完整总线、A-2 挂靠最小版）均不实施。
- **A 组按现状接受**：工具视图与 fs 检查点两套管线并存，客户端合并规则
  （工具优先、fs 跳过）不改。

## 二、修复清单（按依赖与批次排序）

### 批次 1：P0 功能级坏点（互不依赖，可一批上）

| 项 | 决策 | 改动 |
| --- | --- | --- |
| F-1 | **补 4 个 optional 字段 + request 层加 `.strict()`**（用户选择含 strict，防再发；代价：两端须同步发版，自用同仓可控） | 一个文件几行 + 走 codec 往返的测试 |
| G-1 | fetchSubsetPlan 去 `details=1` | 一行 + 端到端用例 |
| G-2 | plan.restorePointId 与请求 checkpointId 比对，不匹配抛 PLAN_STALE | 一行 + 错配用例 |
| G-3 | plan 记录铸造时闸语义（闸移除后此条转为**删除对应分支**，随批次 1 一起走） | 随闸删除 |
| H-9 | restore-undo 两入口补 rev bump；fs-changes 先读 rev 后读列表 | 几行 |
| H-5 | undo 部分成功不销毁记录（覆盖全部请求路径才 delete） | 一行条件 |
| H-6 | fork 补偿跳过/清除 undoRecords | 引擎一个内部参数 |
| H-8 | rescue 修剪纳入 undoRecords 引用检查（引擎半边）+ file-review/rescue 目录数量上限 | 小 |
| H-4 | run_code 录制 LF 归一 | 一行 + CRLF 用例 |
| E-2 | 录制形状白名单收紧（与 H-4 同段代码一次改） | 一处判断 |
| I-7 | capture 前置 parentSession 跳过（先核对宿主是否对子代理发 agent/pre-step） | 一行 |
| I-8 | 启动断言 agent.id === session.id | 一行级 |

### 批次 2：归一化（用户明确要求「同一套 CAS / 同一个事实」）

1. **H-3 统一 CAS helper**：一套比较/写回规则供 file-review 两条路径共用——
   比较 = LF 归一文本相等 + mode 相等（mode-only 条目比的就是 mode）；
   写回 = 按当前文件行尾风格还原 + 显式写 mode。引擎 planFresh 字节级树哈希
   **保留**（职责不同：计划新鲜度，非条目适用性，代码注释注明边界）。
   如实记录的语义变化：hunk 路径从字节级放宽到归一级——仅行尾漂移的文件
   不再报冲突，纯行尾改动会被回滚吞掉。
2. **H-1/H-2 服务端单一事实**：一个 `evaluateEntry`（内部用统一 CAS helper）
   同时服务 status 巡检与 apply 前检；客户端删两套 isReversible/reversiblePaths，
   按钮状态由服务端结果驱动（首帧乐观渲染 + 巡检修正）；状态键 = path +
   diff 集签名，消除两写入者互相覆盖。**排在 F-1 之后**（服务端判定先变对）。

### 批次 3：存储正确性（K 组）

- K-1：**重建即清该工作区 store manifests**（用户选择极简分支；历史列表一次
  性消失，语义诚实）。
- K-6：捕获中断 try/finally 清理镜像半写文件。
- K-8：hashTree/checksumOf 等逐字双份合并单一实现（合并后必须全量测试）+
  containment 统一到 path-utils + live 读补符号链接拒绝（安全面）。
- K-2：sqlite 路径补字节闸 + 手动恢复点错误分类修正。
- K-4：turn/rescue 修剪补 GC 两行 + GC 挪到 rescue 修剪后。
- K-5：可读性抽样 1 → 3 个（全量化不做，大检查点会变慢）。
- K-9：陈旧注释/硬编码中文跳过原因/死文案键，零风险清理。
- **接受现状**：K-3（rescue 配额牵连，注释注明）、K-7（只读无锁竞态，多开
  窗口时再上锁）。

### 批次 4：客户端与时间线

- J 全包：J-4 路径归一（列表层 toPosix + win32 小写）、J-5 行数口径统一 +
  UnifiedDiff 去硬编码 'M'、J-6 ensuredFs 失效 + 侧栏接 warm 广播、
  J-7 run_code 空文件保留、J-8 dedupe 覆盖侧栏。
- B-1：轨迹重放用最近轮起检查点补基线。

## 三、随删除消灭的冲突组（总账）

| 组 | 结局 |
| --- | --- |
| A | 现状接受（两套管线并存，广播器不实施） |
| B | B-1 修复，双轨保留 |
| C | 随词法删除管线删除，全灭 |
| D | 随写入闸删除，全灭 |
| E | E-2 修复；重复记账按现状接受（A 组现状的一部分） |
| F | F-1 修复（含 strict） |
| G | G-1/G-2 修复；G-3 随闸删除转化 |
| H | H-3 归一 + H-1/H-2 单一事实；H-4/5/6/8/9 修复 |
| I | I-1/I-4/I-6 随闸灭；I-2/I-3/I-5 随终端监听灭；I-7/I-8 修复 |
| J | 全包修复 |
| K | 修 7 条，接受 2 条 |

## 四、README 需改写的叙事

- 第三节「终端写盘审计（检查点窗口归属对比）」→ 检查点轮 diff 兜底，
  归属只到会话级。
- 第四节「多会话并行：两种恢复语义」→ 单一对称叙事（并行写不限制、
  恢复不等空闲、归属标签辅助勾选）。
- 边界清单补：命令级归因已移除；恢复不等空闲的安全网是 rescue + 验证。

---

## 五、实施状态（2026-09 定稿当日全部完成）

> 回归基线：`pnpm run check` — 105 测试 / 101 通过 / 0 失败
> （4 skip = 本机无 jj 的双后端用例），typecheck 干净。

| 项 | 状态 | 验证 |
| --- | --- | --- |
| 删除批：终端监听（command-windows / deleted-paths / attribution 窗口分支） | ✅ | 全量回归 + 混沌套件改写为对称语义 |
| 删除批：写入闸全链（write-gate / /gate / 配置 / 开关 / 阻塞分诊 / 恢复不等空闲） | ✅ | write-gate.test 删除；applyGuarded 不再分诊 |
| F-1 schema 补字段 + request 层 strict（zod v4 用 `z.strictObject`） | ✅ | wire 往返 + strict 两条测试 |
| G-1 fetchSubsetPlan 去 details=1 | ✅ | 「带 paths 铸出子集计划」端到端测试 |
| G-2 plan.restorePointId 比对（getRestorePlan + applyGuarded） | ✅ | 错配 409 PLAN_STALE 测试 |
| H-9 rev 补全（restore-undo 端点 + /shadow-undo 命令 bump；fs-changes 先读 rev） | ✅ | 撤销后 rev 递增测试 |
| H-5 undo 部分成功不销毁记录 | ✅ | 部分成功 → 二次 undo = UNDO_CONFLICT（非 NOT_FOUND）；全成功照常销毁 |
| H-6 fork 补偿 skipUndoRecord | ✅ | 补偿后 undo 被 CAS 拒、文件保持补偿结果 |
| H-8 引擎：rescue 修剪纳入 undoRecords 引用；file-review/rescue 目录上限 50 | ✅ | 配额压力下 undo 仍可用的测试 |
| H-4+E-2 录制 LF 归一 + 空文件保留 + 工具名白名单 | ✅ | CRLF hunk / 空文件两条测试（新开 client-recorded-diffs 测试入口） |
| I-7 capture 跳过子代理；I-8 agent.id≠session.id 告警一次 | ✅ | 两条协调器测试 |
| H-3 统一 CAS（新模块 src/file-review/cas.ts；hunk CAS 放宽为 LF 归一；写回按重读行尾风格） | ✅ | contentMatches / 行尾漂移测试 |
| H-1/H-2 reversibleOf 单点 + 状态键 path+diff 签名（子集/全量两槽不互覆） | ✅ | typecheck + 全量回归（客户端逻辑） |
| K-1 重建即清 manifests（store.purgeManifests） | ✅ | 全量回归 |
| K-2 sqlite 字节闸（与 jj 后端同一配额语义） | ✅ | 全量回归 |
| K-4 修剪补 GC + rescue 修剪先于 GC | ✅ | 全量回归 |
| K-5 可读性抽样 3 个（最小/中位/最大） | ✅ | 全量回归 |
| K-6 jj 捕获中断 `jj restore` 复位镜像 | ✅ | 全量回归（jj 机器上生效） |
| K-8 hashTree/checksumOf 单一实现；containment 统一 isWithin；live 读拒软链（readLiveFile 单点） | ✅ | 全量回归 |
| K-9 陈旧注释/死文案键/undo 跳过原因英文化 | ✅ | typecheck |
| J-4 路径比较键 pathKey（反斜杠归一，四处合并点） | ✅ | 全量回归 |
| J-5 diffContentLines LF 归一 + UnifiedDiff 状态字母 A/D/M 推导 | ✅ | 全量回归 |
| J-6 侧栏 ensuredFs 随清单更新失效 + 接入 warm 广播 | ✅ | typecheck |
| J-8 侧栏 status 接入 dedupeStatus | ✅ | typecheck |
| B-1 traceRangeDiff 接受 baseline；宿主只为触碰路径取基线内容 | ✅ | baseline modified / drift 两条测试 |
| README / package.json 叙事改写 | ✅ | — |

**遗留如实说明**：
- I8 断言为「告警一次 + 按 agent.id 归档」的可观察行为，不是修复宿主（插件侧无从修复）。
- J-5 的 diffContentLines 归一影响渲染行文本（CRLF 文件的行不再带 ）——展示更干净，与计数同源。
- tsdown 新增三个 node 测试入口（client-recorded-diffs / client-session-changes / client-fs-diff-utils），不影响发布产物语义。
