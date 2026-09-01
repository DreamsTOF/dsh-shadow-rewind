# AGENTS.md —— dsh-shadow-rewind 协作与修改指南

写给要接手本插件的 AI 协作者。你可以读到全部源码，这篇文档只讲**读代码读不出来的东西**：不变量、跨端契约、历史决策的原因、验证流程和坑。改任何代码之前先读完第 0 节。

---

## 0. 铁律（违反任何一条都是事故）

1. **恢复必须走全套安全闸。** 任何把文件写回磁盘的路径，必须经由 `engine.planRestore`（限时计划 + 确认串逐字回显）→ `engine.applyRestore`（rescue 自动备份 → 持久操作日志 → 事后哈希/权限校验 → 失败自动回滚）。禁止绕过管线直接写文件，禁止"简化"确认串或 TTL。
2. **影子仓库与工作区完全隔离。** 引擎对工作区只做目录扫描与文件写回，绝不读写工作区的 `.git`、`.jj`、HEAD、分支。快照字节只进 `$DSH_HOME/shadow-rewind/v1` 下的影子 jj 仓库。
3. **`tests/engine.test.mjs` 是"文件恢复无损"的直接证明。** 任何改动后 `pnpm check` 必须全绿；**提交态基线 34 pass / 0 fail / 3 skipped**（Windows 上 3 个 POSIX-only 测试跳过是正常的）。⚠ 当前工作树不在此基线：用户 WIP 的 `src/engine.ts` 引入 8 个 engine 失败（见 §7-8），fs/审查半边（`tests/fs-changes.test.mjs` + `tests/file-review.test.mjs`，共 13 个）全绿。测试断言不许动；若 lib 产物形式变化导致导入失败，只调导入路径。
4. **最短有效 diff。** 手术式修改，不顺手重构、不动无关格式；注释是刻意的中文风格、记录约束与历史原因（很多坑的答案就写在注释里，grep 中文注释常比读实现更快），改代码时同步迁移注释。
5. **协议改动两端同步。** HTTP 端点、Typert remote、深链 meta 属于宿主↔浏览器契约，改任何一侧必须同步另一侧，且旧字段保持兼容（浏览器 bundle 与宿主可能不同步升级）。
6. **fs 撤销的删除必须留可找回副本。** fs-added 撤销（=删除文件）与 fs-deleted 重做（=再次删除）走 `applyFsChange` 的 `rm` 分支，**不在引擎的恢复安全闸内**——必须先把当前内容落 `<storageDir>/file-review/rescue/` 一份（落盘失败则拒绝删除）。这条轻量路径是宿主唯一兜底，别图省事去掉。
7. **fs 条目的全文按需取，绝不预热。** 卡片/侧栏/live 条先用服务端行数（`/fs-changes` 的 `added`/`removed`）渲染行与统计；全文（整文件 diff）只在悬停浮层、展开行、撤销提交、恢复窗口统计时经 `fs-diff-utils.ensureFsFileDiff` 按需拉取并模块级记忆（缓存条目被 warm 替换时记忆随该轮失效）。任何"为渲染先把全文拉好"的回归都会复活 HTTP 风暴。

---

## 1. 一分钟理解本插件

对 DeepSeek Harness（DSH）的双能力文件安全插件，两个**互补不复刻**的面：

| 面 | 机制 | 粒度 | 代码位置 |
|---|---|---|---|
| 会话回退 | 影子 jj 仓库整树快照（每轮第一步自动 checkpoint） | 整个工作区（或对称模式下勾选的路径） | `src/engine.ts` + `src/rewind-host.ts` + `src/client/rewind.ts` |
| 文件审查 | hunk 文本逆放（逐块还原 + 行锚点 + 字节级 CAS） | 改动块 / 文件 / 轮 | `src/file-review/*` + `src/client/FileReviewTab.tsx` 等 |

**为什么两套并存**：hunk 撤销提供块级粒度但不感知 VCS 外的整树状态；jj 快照提供"回到任意时点"但粒度是整树。它们从不互相代替——给 hunk 撤销加 jj、或给快照恢复做行级 diff，都是错误方向。

**两种恢复语义模式**（`writeGate`，运行时可经 `/shadow-rewind/gate` 切换）：
- **以当前为准**（闸开，默认）：同一工作区只有"当前"会话可写；恢复=整树；占用检查放宽。
- **对称**（闸关）：并行写入合法；恢复=按归属勾选路径子集；任何运行中会话阻塞恢复。

版本史（语义见 git log 与 README）：0.2.0 融合 dsh-file-review-tab → 0.3.0 写入门 → 0.3.1 运行时开关 → 0.4.0 对称恢复+归因 → 0.5.0 文件级时间线 → 0.6.0 轮尾卡片单文件撤销 → 0.6.1 write-gate deps 修复。

**未发布 WIP（本目录工作树，尚未 commit）**：fs-changes 服务端行数统计 + 客户端懒加载全文；`reviewDiffs` 回退（result view 非 diff 卡时回退 callView，修"write 工具撤销按钮灰"）；live-tail 跨会话归属过滤（剔除其它会话窗口独有的路径，防 fs-added 撤销误删）；`origin:'fs'` 标记 + fs 删除 rescue 安全网；status 巡检 in-flight 去重 + 卡片 effect 内容签名依赖；工作区 `rev` 计数器（fs-changes 响应带 rev，客户端 warm 同 rev 跳过）；两个恢复对话框 blocked 时自动重查；fs 比较两侧 LF 规范化。详见 §4-4 / §5-7。

---

## 2. 目录地图

```
src/                        宿主（Node）半边
  index.ts                  入口：ShadowRewindService 装配（引擎+协调器+写入门+HTTP+文件审查宿主）。
                            ⚠ FileReviewService/transformFile 必须从这里 re-export（见 §5-3）
  engine.ts                 核心：快照/检查点/恢复管线。红线的家
  jj-backend.ts             影子 jj 仓库后端；jj 缺失时引擎降级 blob 后端
  rewind-host.ts            回合检查点协调器（agent/pre-step step 1 抢占）+ /shadow-rewind HTTP 端点
  write-gate.ts             写入门：所有权登记 + 工具拒绝裁决（tools/pre-execute）
  attribution.ts            对称模式归因：检查点窗口 [S_j,S_j+1) 的写者 = S_j 的会话 → 每路径归属
  capture.ts / capture-cache.ts / scan.ts   工作区扫描与快照捕获（stat 缓存增量）
  store.ts                  存储层：manifests / blobs / 操作日志 / turn-skip / GC
  manifest.ts / path-utils.ts / deadline.ts / errors.ts / types.ts
src/file-review/            文件审查宿主半边（自 dsh-file-review-tab 移植）
  host.ts                   装配：FileReviewService + system prompt 段 + Code Mode 录制器
  file-review-service.ts    hunk 撤销/重做服务 + 录制持久化（<storageDir>/file-review/recorded/）
                            + fs 撤销安全网（<storageDir>/file-review/rescue/，见铁律 6）
                            + fs 比较 LF 规范化（inspectFsChange/applyFsChange CAS）
  change-types.ts           协议类型（FileReviewRequest/Result、origin?:'fs'、counts? 等）
  typert.host.ts / typert-descriptors.ts / remote.ts   Typert `fileReview` 命名空间三件套
src/client/                 浏览器半边（单 bundle，见 §3）
  index.tsx                 合并入口：apply = rewindApply + applyFileReview；inject 并集
  rewind.ts                 会话回退面：消息旁按钮、恢复对话框（blocked 时 3s 静默重查）、srw-* 全局样式
  file-review.tsx           文件审查装配：轮尾卡片注册 + 侧边栏 tab 注册 + 文件提及 + status 巡检去重注入
  ProducedFiles.tsx         聊天轮尾卡片（含每文件 chip 的单文件撤销；fs 条目计数先行+懒加载+签名依赖）
  FileReviewTab.tsx         侧边栏 tab：逐轮分组 diff、hunk 勾选、快照恢复对话框、文件时间线
  UnifiedDiff.tsx           diff 渲染器（hunk 勾选、复制、折叠）
  fs-diff-utils.ts          fs-changes 客户端层：fetchAllFsChanges(带 rev)/warm(同 rev 跳过)/
                            fsTurnReviews(零全文占位)/ensureFsFileDiff(模块级记忆+失效联动) ← 懒加载核心
  status-dedupe.ts          status 巡检 in-flight 去重（apply 有副作用，绝不参与）
  diff-popover.tsx          卡片/live 条的悬停 diff 浮层（锚定本框架）
  live-bar.tsx              输入区上方的回合进行中实时读数（fs 条目计数先行，悬停懒加载）
  session-changes.ts        会话快照 → 逐轮逐文件改动（纯函数，客户端一切派生的源头）
  turn-deliverables.ts / recorded-diffs.ts / deleted-paths.ts / diff-text.ts / subset-plan.ts
  locales.ts / chat-locales.ts   两套词典（见 §5-5）
tests/                      node --test；engine.test.mjs 是红线证明，其余按功能域
```

---

## 3. 构建与验证

```sh
pnpm typecheck   # tsc --noEmit（bundler 解析 + allowImportingTsExtensions）
pnpm build       # tsdown 双构建 + build:types（声明到 lib/types）
pnpm check       # build + node --test tests/*.test.mjs   ← 提交前的最小门槛
```

tsdown 双配置（`tsdown.config.ts`）的约束都有原因，别改：

- **node 配置必须 `unbundle: true`**：引擎测试直接驱动内部模块（scan/capture/capture-cache），打包会破坏导入。
- **client 配置产出 ModuleLoader CJS bundle**（banner/footer 注入 `window.__ModuleLoader__.load({id:'dsh-shadow-rewind',...})`）；`react` external、`diff`/`zod` 强制打进 bundle；**故意不产出 sourcemap**（map 比 js 大且 loader 环境无法按 map 回源）。
- **CSS Modules 走自写插件**：编译成运行时注入的 `<style>` 元素，`styleId = "dsh-shadow-rewind/<文件名>"`；类名哈希模式 `[hash]_[local]`。
- `PACKAGE_NAME` 常量贯穿 CSS styleId 与 client banner，改名等于改插件身份（Typert/CSS/ModuleLoader 全要跟着动），别动。

**lib/ 是发布物，要提交。** 重建后若只有 `lib/client.js` 里 CSS 导出映射的键序变化（哈希类名不变），属构建抖动，直接提交即可。

**双 git 仓库**：本目录有自己的 git（功能提交在这里）；根仓库 `../`（tauri-pp）直接跟踪本目录的文件内容——每次发布后在根仓库 `git add dsh-shadow-rewind && git commit` 同步一次。

---

## 4. 宿主半边修改规则

### 4-1 cordis 服务装配（`src/index.ts`）

- 服务以 `ctx.provide('shadowRewind', this)` 发布；对外方法全是引擎方法的薄代理。
- **cordis 访问保护**：未经 `inject` 声明就访问 `ctx.X` 会抛 "cannot get property X without inject"。本插件的通用模式是 `ctx.inject([...names], (scope) => {...})` 把服务从 scope 摘进闭包惰性读（写入门 deps、HTTP 端点 deps 都这样）；对"名字跨版本漂移"的服务（如 conversationEvents）用 `ctx.get ?? ctx.reflect.get` 动态解析（见 `file-review.tsx` 的 `resolveConversationEvents`）。
- 写入门**恒常构造**：所有权登记永远进行（`agent/pre-step` step 1），`config.writeGate` 只决定拒绝裁决的初始开关——保证运行时中途开闸立刻有据可依。别把它改成"关闭时不构造"。

### 4-2 HTTP 端点 `/shadow-rewind`（`rewind-host.ts`）

- **仅回环**（127.0.0.1/::1），其余 403。`webServer.register({kind:'exact'})`。
- GET 预览：`?sessionId` + **`messageSeq` 与 `turn` 二选一**（互斥校验）；`&details=1&offset&limit`（≤200）翻页；对称模式下 `&paths=[...]` 铸造子集计划。定位不到检查点时回落：持久 skip 记录 → 内存 coordinator 状态（pending/skipped/failed/missing）。
- POST 执行：`{mode:'code'|'both', sessionId, checkpointId, planId, confirmation, messageSeq|turn}`。`turn` 分支强制 `mode:'code'`（按轮恢复绝不碰对话）；`both` = 恢复文件 + fork 新会话，**fork 失败自动把文件滚回 rescue 点**（补偿失败抛 RECOVERY_REQUIRED）。
- 错误码→HTTP：`RESTORE_POINT_NOT_FOUND`→404，其余（`PLAN_STALE`/`WORKSPACE_IN_USE`/`INVALID_ARGUMENTS`…）→409。浏览器按 `code` 字段分支（如 PLAN_STALE 触发"重新检查"UI），改错误语义要连浏览器一起改。
- fork 产物继承检查点：沿 `parentSession` 上溯，只有回合起点落在 `seedLength` 内才允许继承，且 `turnStartSeq` 必须逐字匹配；有环检测。改这段逻辑先读 `resolveTurnCheckpoint` 的注释。
- 占用检查（`sharedWorkspaceSessions`）：canonical realpath 比对活跃会话；写入门开启时只拦"请求者自己 + 当前所有者"，关闭时拦任何运行中会话。

### 4-3 文件审查宿主（`file-review/host.ts`）

- **Typert 契约**：`fileReview` 命名空间按 `exportName: 'FileReviewService'` 从**包主入口**解析服务类 → `src/index.ts` 的 re-export 绝不能删；`TYPERT.package` 等标识常量与包名绑定。
- Code Mode 录制器挂在 `tools/post-execute`：只录**嵌套派发**（`exec.parent && exec.agent` 都在）且结果形状为 `{path, before?, after}` 的调用——按形状识别而非工具名，这是刻意设计（也因此返回该形状的非文件工具会被误录，README 边界节有记录）。监听必须包在 `ctx.effect` 里，否则 HMR 后重复录制。
- 录制持久化：`<storageDir>/file-review/recorded/<agentKey>-<sha256前16>.json`，防抖原子写、懒加载、损坏静默自愈、条数上限。

### 4-4 fs-changes 端点与服务端行数统计（`rewind-host.ts`）

- **`/shadow-rewind/fs-changes?sessionId=`** 批量返回会话所有轮次的终端写盘变更：轮 N = `diffCheckpoints(轮N起, 轮N+1起)`；最后一轮无下一检查点 → live-tail = `inspect(最后检查点, 当前磁盘)`，`nextCheckpointId: 'live'`，after 内容经 `/shadow-rewind/file?checkpointId=live` 读盘。
- **服务端预算行数**：每条 change 带 `added`/`removed`（`diff` 包 `diffLines`，LF 规范化、UTF-8 往返校验、单侧 2MB 上限、整请求 600 条预算）。客户端据此渲染行与 +/−，**零全文 HTTP**（铁律 7）。超限/非 UTF-8/预算耗尽 → 省略行数字段（宽松解析，旧客户端不受影响）。
- **live-tail 跨会话归属过滤**：live-tail 的 after 内容就是当前磁盘，据此派生的整文件 diff 一旦撤销会删掉/覆盖别的会话刚写的工作（fs-added 撤销=真实 rm）。用 `engine.listSnapshotsAfter` + `attributePaths` 把非本会话窗口独有的路径（`owner.kind !== 'target'`）从 live-tail 剔除。**轮间窗口的同类混入暂不处理**——轮末内容来自检查点而非磁盘，撤销会在宿主 CAS 处以「冲突」安全失败，不误删。
- **工作区 rev 计数器**：`workspaceRevisions`（canonical realpath 键）在检查点捕获成功 / 恢复成功时 `bumpWorkspaceRevision`。fs-changes 响应带 `rev`；客户端 `warmFsChanges` 同 rev 直接跳过解析与通知（正确性不再靠 JSON 深比较）。rev 缺省（旧宿主）回退逐条 JSON 比较。
- **占用检查（`sharedWorkspaceSessions`）**：canonical realpath 比对活跃会话；写入门开启时只拦"请求者自己 + 当前所有者"，关闭时拦任何运行中会话。

---

## 5. 浏览器半边修改规则

### 5-1 入口与依赖注入

- `src/client/index.tsx` 的 `inject` 是两个子面的**并集**；`package.json` 的 `dsh.client.inject` 必须与之呼应（运行时可用的服务集）。加新服务两处一起改。
- `apply = rewindApply(ctx) + applyFileReview(ctx)`，两个面独立注册、互不依赖；每个注册都包 `ctx.effect`（HMR/禁用时干净卸载，泄漏=重复注册）。

### 5-2 三个 UI 面的挂载

| 面 | 注册方式 | 关键约束 |
|---|---|---|
| 聊天轮尾卡片 | `slots.inject('conversation.chat.turnTail', …, priority -2)` | 链选举是**first-claim-wins 升序**：-2 抢在 better-sidebar 自带的 -1 之前，永远只有一行渲染。动 priority 前先理解这个机制 |
| 侧边栏 tab | `betterSidebar.registerTab({id:'file-review', …})` | `single: true`；badge 走结构指纹 memo（流式 flush 不重算） |
| 行内文件提及 | `ctx.provide('chatFileMentions', …)` | 与宿主 system prompt 段（order 190）的引导文案**配对**，改一侧要考虑另一侧 |

### 5-3 Typert remote 调用（唯一正确姿势）

会话 scope 由 client runtime 铸造，**不能静态 inject 后注册的命名空间**。正确写法（两处都在用，抄它们）：

```ts
const scope = sessions.scope(sessionId)
const remote = scope.get('remote.fileReview')   // 动态逃逸 hatch
const result = await remote.apply(request)       // RemoteResult：ok=false → throw result.error.message
```

### 5-4 撤销语义分工（改 UI 前必读）

| 位置 | 粒度 | 实现 |
|---|---|---|
| 轮尾卡片 chip 的 ↩ | **该文件本轮全部 hunks**（刻意不给子集） | `applyChanges({files:[{path, diffs: 全部}]})` |
| 侧边栏文件行的撤销 | 整文件；若 diff 里勾选了 hunk 子集则只提交子集 | `hunksForRequest` |
| 侧边栏 diff 的 hunk 勾选 | 任意子集；空选=按钮禁用 | `FileReviewRequest.files[].diffs` 天然支持子集，服务端无感 |
| 快照恢复对话框 | 整树（current-wins）或勾选路径（symmetric，子集计划） | 走 HTTP，与 hunk 撤销是两套机制 |

卡片与侧边栏共享同一 `fileReview.apply` 协议——任何文件子集都合法，这是"单文件/子集回滚"类需求零协议改动的原因。

### 5-5 文案（两套词典，键集必须对齐）

- `locales.ts`，命名空间 `fileReviewTab`（侧边栏 tab 用）：**zh 是键集事实源**（`en: Record<CopyKey, string>` 补齐）。
- `chat-locales.ts`，命名空间 `file-review`（轮尾卡片/审查用）：**en 是键集事实源**（zh 补齐）。
- 加键 = 两个语言文件各加一条，类型系统会强制；占位符 `{name}` 用 `t(key, params)` 插值。

### 5-6 深链与滚动（历史坑集中地）

- 深链协议：`tab.meta = { expandPaths: string[], turn?: number }`。带 `turn` 只展开该轮的行；不带则所有轮的同名路径都展开。**新 meta 引用才重放**（按引用相等去重），展开是合并进用户已展开集合、绝不覆盖。
- 打开链路的顺序是 `updateTab → openTab → activateTab`：updateTab 把 meta 送到已打开的 tab；openTab 的 meta 只在**创建**时落地（所以已打开时靠 updateTab）。
- 滚动**只准操作 tab 自己的 body 容器**（`getBoundingClientRect` 差值 + `container.scrollTo`，issue #4）：`scrollIntoView` 会按规范滚动所有可滚动祖先，会把侧边栏 tab 条滚出视野。
- 对话框统一复用 `rewind.ts` 注入的 `srw-*` 全局类（srw-overlay/srw-dialog/srw-foot…），组件自己的样式才走 CSS Module。CSS Module 一律用宿主 `--dsw-alias-*` 设计令牌，不写死颜色。

### 5-7 fs 懒加载、巡检去重与恢复死态（WIP 新增，改 UI 前必读）

- **fs 条目计数先行、全文按需**（铁律 7）：`fs-diff-utils.fsTurnReviews` 产出零全文占位（带服务端 `counts`）；`ensureFsFileDiff(fsTurn, path, cwd)` 模块级记忆（key = `turnStartSeq\0path`），**缓存条目被 warm 替换时该轮记忆随 `invalidateLazyTurn` 失效**（live 条磁盘内容随回合推进而变，绝不能跨更新复用）。卡片/live 条/侧栏 tab 都走这套：悬停浮层、展开行、撤销提交、恢复窗口统计分别触发 ensure。
- **撤销提交前补齐**：卡片 `runToggle`/`runFileToggle`、侧栏 `runToggle` 遇到 fs 占位条目（`diffs:[]` + `origin:'fs'`）先 `ensureFsFileDiff` 补全文再提交；补齐结果回填占位条目，popover/整轮提交不再重复拉取。
- **status 巡检 in-flight 去重**（`status-dedupe.ts`）：同一（会话×请求）的并发巡检只发一次，所有调用方共享结果。`apply` 有副作用，**绝不参与去重**。注入点在 `file-review.tsx` 的 `inspectChanges` 闭包。
- **卡片巡检 effect 内容签名依赖**：`ProducedFiles` 的 inspect effect 依赖 `inspectKey`（`JSON.stringify(inspectFiles)`）+ `reversibleKey`，而非数组/函数身份——上游 slot 每次渲染都换 `inspectChanges` 与 `matched` 身份，按身份依赖会让巡检（连带按钮禁用窗口）反复重放。`inspectRef` 解身份抖动。
- **卡片 notify 守卫**：`refresh` 比较 `JSON.stringify(fsTurn)`，本卡无变化不 `setFsReviews`、不重渲染（warm 通知对所有挂载卡片广播）。
- **恢复死态自动重查**：`TurnRewindDialog`（侧栏）与 `RewindDialog`（消息旁）在 `restoreBlocked` 时每 3s 静默重取预览（`load(true)`，不动 loading/error/stale）；占用解除的瞬间 planId/confirmation 就位、按钮就地变活——否则 blocked 时的预览不带 plan，恢复按钮会一直死在禁用态。

---

## 6. 常见任务食谱

**加一段用户文案**：确定归哪个面 → 在对应词典（§5-5）zh+en 各加一键 → `pnpm typecheck` 会验证键集对齐。完。

**在侧边栏 tab 加控件/对话框**：动 `FileReviewTab.tsx`（+ `FileReviewTab.module.css`）；需要数据先看 `session-changes.ts` 的纯函数能不能派生（客户端派生优先于加 HTTP 参数）；浮层复用 `srw-*`。

**给 `/shadow-rewind` 加参数**：`rewind-host.ts` 改解析（复用 `requiredText`/`nonNegativeInteger` 等小工具，错误一律 `INVALID_ARGUMENTS`）→ 浏览器调用点同步 → 若影响预览形状，`decodeTurnPreview`（FileReviewTab）/`rewind.ts` 的宽松解析一起加字段（**宽松解析：新字段缺失不炸旧 UI**）。

**加引擎能力**：先在 `engine.ts` 加方法（类型进 `types.ts`）→ `src/index.ts` 的 `ShadowRewindService` 加薄代理 → 需要暴露就加 HTTP 分支 → `tests/` 加集成测试（现有测试用真实临时目录跑全链路，照抄结构）。引擎测试必须全绿。

**加一个被录制的工具**：不需要——录制按结果形状识别（§4-3）。要改识别规则才动 `host.ts` 的形状检测。

**验证任何改动**：`pnpm check` 全绿是底线；UI 改动另需在 DSH 里手动过（见 README 与各功能提交信息里的验收要点）。

## 7. 发布检查单

1. 改动 + 自测（§6 食谱的验证列）。

2. `pnpm check` 全绿。⚠ 当前因 §7-8 的 engine WIP 失败未达此条；发布前必须先修 engine。fs/审查半边（`tests/fs-changes.test.mjs` + `tests/file-review.test.mjs`）须保持全绿。

3. `package.json` 版本号：功能 +0.1.0（minor），修复 +0.0.1（patch）——沿用现有节奏。本次 WIP 若整体发布应跳到 0.7.0（fs-changes 行数+懒加载是协议/架构级改动）。

4. README 相应小节补一句（功能列表、边界、配置、HTTP 端点描述都维护得很细，保持）。fs-changes 响应新增 `rev`/每 change `added`/`removed` 字段、`FileReviewChange.origin`/`counts` 字段属协议新增，README 的 HTTP 端点描述需同步。

   
