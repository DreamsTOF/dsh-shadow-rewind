<p align="center">
  <img src="assets/logo.svg" alt="dsh-shadow-rewind" width="180">
</p>

<h1 align="center">dsh-shadow-rewind</h1>

<p align="center">
  <strong>DeepSeek Harness 的会话级文件快照与回退插件。<br>
  每一轮对话一个检查点 —— 行级 diff 审查、块级撤销、整树回退。</strong>
</p>

<p align="center">
  <a href="#功能全景">功能全景</a> •
  <a href="#安装">安装</a> •
  <a href="#配置cordispatchyml">配置</a> •
  <a href="#测试">测试</a> •
  <a href="#边界当前版本">已知边界</a>
</p>

<p align="center">
  <a href="https://github.com/DreamsTOF/dsh-shadow-rewind/releases"><img src="https://img.shields.io/badge/version-0.9.2-blue.svg" alt="Version"></a>
  <a href="https://github.com/DreamsTOF/dsh-shadow-rewind/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT License"></a>
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img src="https://img.shields.io/badge/DeepSeek_Harness-Plugin-blueviolet.svg" alt="DeepSeek Harness Plugin"></a>
  <a href="https://www.npmjs.com/package/dsh-shadow-rewind"><img src="https://img.shields.io/npm/v/dsh-shadow-rewind" alt="npm version"></a>
  <a href="https://github.com/DreamsTOF/dsh-shadow-rewind/stargazers"><img src="https://img.shields.io/github/stars/DreamsTOF/dsh-shadow-rewind?style=social" alt="GitHub Stars"></a>
</p>

<p align="center">
  <b>⭐ GitHub 仓库：<a href="https://github.com/DreamsTOF/dsh-shadow-rewind">DreamsTOF/dsh-shadow-rewind</a></b> —— 觉得有用就点个 Star；问题与需求请提 <a href="https://github.com/DreamsTOF/dsh-shadow-rewind/issues">Issue</a>
</p>

---

针对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的**会话级文件快照与回退 + 改动文件审查**插件。

**单一事实来源**：不管文件是被 AI 的 write/edit 工具、Code Mode 的嵌套派发、终端命令（PowerShell / bash / git）、还是外部进程修改的——每轮的全部变更都由**检查点 diff**（轮起快照 vs 轮末快照）算出。没有第二套数学，行数、diff、撤销与回退全部同源。

## 功能全景

| 面 | 机制 | 粒度 | 入口 |
| --- | --- | --- | --- |
| **会话回退** | 检查点整树恢复 + 就地遮蔽 | 整个工作区（内容 + 权限位 + 空目录）+ 对话行 | 每条直发用户消息旁的「恢复到发送之前」 |
| **文件审查** | 检查点轮 diff（逐轮） | 文件 / hunk | live 条 + 全屏审查界面 |
| **会话累计视图** | 检查点净变化（跨轮合并） | 文件 | 输入框上方的 live 条 |
| **时间线审计** | 检查点 + 轨迹重放 | 任意两节点 | 会话头部「时间线」面板 + 命令面 |

**会话回退（唯一语义）**：恢复到该消息所属回合的**轮起检查点**，丢弃其后的一切写盘——含终端/外部进程的改动与你自己手动做的修改；消息入口同时**就地遮蔽**该消息及其后的对话行，并把文本放回输入框。没有「只回滚 AI 更改」，没有子集勾选，没有分叉新会话。

**文件审查**：live 条（输入框上方）列出本会话仍生效的全部改动——每行文件名 + 净 `+/−` 行数 + 归属徽标（本会话/其它会话/双方/未知，仅作信息展示），悬停弹行级 diff 浮层，点行或头部「审查」打开全屏审查界面（逐轮 diff、hunk 勾选撤销/重做、文件级时间线、每轮「从快照恢复」）。

**核心设计：影子仓库平行线。** 工作区自身的任何 VCS（git / jj / 无）与本插件的影子 jj 仓库完全隔离——插件枚举文件只走目录扫描，快照字节只写入存储根下的隐藏 jj 仓库；恢复时只改写工作区文件，绝不触碰工作区的 `.git`、`.jj`、HEAD、分支或提交。

```text
你的项目目录（随便怎么折腾）          插件存储根（$DSH_HOME/shadow-rewind/v1）
├── src/...                          └── workspaces/<key>/
├── .git/   ← 插件从不读写               ├── manifests/           恢复点清单
└── ...                                  ├── content.db           SQLite 内容库（降级后端）
                                         ├── file-review/rescue/  删除类撤销的找回副本
                                         └── shadow-repos/<key>/  影子 jj 仓库（快照字节）
```

## 一、会话回退（检查点整树）

1. **自动检查点**：每轮对话在 Agent 第一步之前自动快照轮起树状态，轮结束（`turn/end` 事件）时再快照轮末树状态——每轮 = 两个相位（轮起/轮末），各自计配额。默认走隐藏 `jj` 仓库；宿主机没有 `jj` CLI 时自动降级为内置 SQLite 内容库（`node:sqlite`，启动日志提示），功能不中断；`off` 可整体关闭（关闭后回退入口如实提示「没有快照」）。
2. **回退入口**：每条直发用户消息下出现「恢复到发送之前」：
   - **消息入口**（就地遮蔽）：文件按检查点整树恢复 → 宿主向会话日志追加空遮蔽标记（`surfaceOp.replace` + `sourceEventSeqs`）→ 客户端把该消息及其后的对话行隐藏（`data-dsh-rewind-hidden`），目标文本在输入框为空时回填；
   - **轮入口**（审查界面「快照恢复」）：只恢复文件，当前对话保持不变。
3. **恢复安全闸**：恢复前自动 rescue 备份 → 事后逐路径哈希/类型/权限验证 → 失败自动回滚——「要么恢复成功，要么整体回到操作前」的两态翻转，绝不留半恢复状态。
4. **增量捕获**：stat 指纹缓存 + 内容寻址去重——未变文件零重读；捕获到的超大/类型不支持/读取失败路径**显式记录**并在预览展示「恢复不会碰它们」，而不是静默失败；缓存被 GC/影子仓库丢失等意外波及后自动失效重读，不产生死引用。
5. **撤销冲突三选项**：撤销恢复时若部分文件在恢复后又被修改过（CAS 失配），弹窗列出清单并给三个选项——**拒绝回滚 / 全部回滚（覆盖后续修改）/ 只回滚正常部分**（跳过后可对剩余文件做确认的二次回滚）；恢复新建文件的强制回滚即删除。

## 二、文件审查（检查点 diff 单源）

- **live 条**（输入框上方）：本会话仍生效的全部文件改动；每行文件名 + 净 `+/−` + 归属徽标；悬停弹 diff 浮层（全文按需懒取）；行尾 ↶/↺ 做 hunk 级撤销/重做；点行 / 头部「审查」打开全屏审查界面。
- **全屏审查界面**（AuditOverlay）：逐轮分组 + 行级红绿 diff；**块级撤销/保留**（每个 hunk 可勾选，只撤销/重做选中的块）；**每轮「快照恢复」**（整树回到该轮开始之前，复用同一套安全闸）；**文件级时间线**（一个文件跨轮的改动历史）；面板拖动调宽。
- **行内文件提及**：注入系统提示引导模型用行内代码引用被修改文件，点击即可打开（路径词汇来自该轮工具结果，仅用于链接解析）。

hunk 撤销的安全语义：逐 hunk 逆序文本回放 + 行锚点匹配 + 提交前 CAS 复核 + 原子写 + 保留 CRLF 行尾风格；外部编辑造成的失配如实报告为「冲突」，绝不猜着改。

## 三、多会话并行

同一个项目目录跑多个会话时，并行写入不设限制；恢复是工作区级的整树操作：

- **归属只是徽标**：live 条与审查界面的每条变更按检查点窗口标注归属（本会话 / 其它会话 / 双方 / 未知）——仅作信息展示，**不影响可见性、不影响默认行为**，也不参与任何自动勾选（没有勾选清单）；
- **恢复不等空闲**：安全网是恢复前的自动 rescue 备份 + 逐路径哈希/类型/权限验证 + 失败自动回滚；
- 外部编辑器、IDE 与系统进程不受本插件限管（一直如此）。

## 安装

两种方式等价，都是一条 `dsh plugin` 命令：包声明了 `dsh.bundle.patch`，安装后会被自动追加进 profile 的 `dsh.profile.bundles`。

**从 npm 安装（发布版）**

```sh
dsh plugin --profile web add dsh-shadow-rewind
```

**链接本地 checkout（开发用）**

```sh
pnpm install
pnpm run check          # 构建 + 全量测试（jj 可用时自动加测影子后端）
dsh plugin --profile web add d:/dsh-pulgn/dsh-shadow-rewind
```

链接安装会写 `"dsh-shadow-rewind": "link:<目录>"`，并让 `node_modules/dsh-shadow-rewind` 指向本仓库——**dsh 不替你构建**，所以必须先 `pnpm install && pnpm build`（`lib/` 就是运行产物），改完代码重新构建并重启 DSH 即生效。链接指向的目录不要移动或删除，否则 profile 启动会因链接失效报错；此时用 `dsh plugin --profile web remove dsh-shadow-rewind` 清理。

两种方式互切：已存在 `link:` 条目时 `add dsh-shadow-rewind` 不会覆盖（pnpm 认为该名字已由本地链接满足）——先 `remove`，再按需 add 包名或目录路径。

依赖：Node ≥ 22.19；`jj` CLI **可选**——缺失时自动降级 blob 存储。不经过 pnpm 的兜底路径仍是 `pnpm apply`（构建 + 把 lib 与补丁文件直灌 profile 安装目录，依赖从 profile 顶层解析；目标目录可用 `DSH_PROFILE_DIR` 覆盖）。

## 配置（cordis.patch.yml）

```yaml
- id: ui-deliverables
  disabled: true # 内置产物卡片由本插件的 live 条接管

- insert:
    - id: shadow-rewind
      name: "dsh-shadow-rewind"
      config:
        turnCheckpointMode: jj # jj（默认）/ sqlite / off
        excludePatterns: # 工作区相对 glob；字面路径=任意层级同名目录
          - .git
          - .jj
          - node_modules
          - dist
        maxFileBytes: 16777216 # 超限文件跳过并显式记录
        maxFiles: 20000
        maxSnapshotBytes: 536870912
        maxTurnCheckpointsPerSession: 30 # 轮起/轮末各一份配额
        maxRestorePoints: 50
        turnCheckpointTimeoutMs: 5000
        turnCheckpointMaxNewBytes: 33554432
        turnCheckpointTrust: fast # fast=stat 缓存增量；strict=全量重读
```

HTTP 端点均为同源、仅接受回环请求：

| 端点 | 用途 |
| --- | --- |
| `GET/POST /shadow-rewind` | 回退预览（`?sessionId&messageSeq` 或 `?sessionId&turn`；逐文件带净行数）与整树恢复执行 |
| `GET /shadow-rewind/fs-changes?sessionId` | 该会话的逐轮检查点 diff（审查界面数据源）+ `cumulative` 会话累计净变化（live 条数据源） |
| `GET /shadow-rewind/trace?sessionId[&from&to]` | 时间线（轨迹节点 + 检查点摘要）与区间 diff：`from/to` 为 `trace:序号`（内容重放）或 `rp_…`（快照对比），二者不可混用 |
| `GET /shadow-rewind/file?checkpointId&path&cwd` | 按检查点读取文件内容（`checkpointId=live` 读当前磁盘，工作区围栏） |
| `POST /shadow-rewind/inplace` | 就地遮蔽回退（对话侧；文件侧由 `/shadow-rewind` POST 承担） |
| `POST /shadow-rewind/restore-undo` | 撤销该工作区最近一次恢复（进程内 undo 栈；body `{sessionId\|cwd, mode?: probe\|apply, force?, paths?}`） |
| `GET /shadow-rewind/status` / `GET/POST /shadow-rewind/config` / `GET/POST /shadow-rewind/manage` | 诊断 / 配置 / 检查点管理 |

### 命令面（headless）

- `/shadow-diff [起] [终]` — 两个时间节点的文件变更摘要。参数：轮号（如 `3`，单轮=轮起→轮末配对）、检查点 id（`rp_…`）、轨迹节点（`trace:序号`，内容重放区间）；快照与轨迹不可混用。

浏览器半边随包分发；宿主服务以 `ctx.shadowRewind`（cordis）与 Typert `fileReview` 命名空间暴露。

## 测试

`pnpm test` 使用真实临时目录跑完整链路（155 用例）：

- **引擎**：修改/删除/新增恢复、空目录条目恢复、排除规则、超大文件跳过、计划过期拒绝、无变更短路、stat 缓存增量、死缓存自愈、影子仓库丢失自愈；`jj` 可用时双后端全测；
- **文件审查**：hunk 子集撤销、fs 语义（新增=删除 / 删除=写回 / 纯权限位翻转 / 空目录互逆 / 非空拒删）、删除前 rescue 副本、CRLF 不误报；
- **轨迹重放与意图标签**（`trace-replay.test.mjs`）：三种工具的意图采集（窗口下界/上限/只读命令排除）、节点错误合并、重放区间 diff（write+edit、漂移未命中、str_replace_editor 三命令、失败调用与结果缺失处置）、intent 的 manifest 往返、trace 端点三模式与混用拒绝；
- **恢复撤销与命令面**（`undo-commands.test.mjs`）：撤销回滚语义（回到恢复前/恢复新建文件删除/被改路径跳过/全跳过 UNDO_CONFLICT/无记录 UNDO_NOT_FOUND）、restore-undo 端点、预览整树计划与逐文件行数、计划与检查点错配拒绝；
- **归属与窗口**：跨会话窗口归属标签（target/它会话/multi）、逐轮净变更精确识别；
- **终端写盘端点**：轮配对行数与 `rev`、权限位透传、live-tail；
- **混沌套件（固定种子可复现）**：双会话交错写盘、检查点淘汰+GC 压力下存活检查点全部可恢复、7 会话（A-G）不对称轮数（5/2/7/3/6/1/4）+ 两种相反完成顺序下「每会话每轮变更被精确识别」的逐条断言。

## 边界（当前版本）

- 恢复的是**文件内容 + 权限位 + 空目录**：不回滚任何 VCS 历史（工作区 git 的提交不受影响）；非空目录不单独立条目（由子条目在恢复时隐式重建）；符号链接仅在 POSIX 环境验证；
- **恢复撤销是进程内 undo 栈**：重启即失效（持久兜底是恢复时自动创建的 rescue 备份点）；撤销冲突经三选项弹窗交用户裁决（拒绝 / 强制覆盖 / 只回滚正常部分 + 二次回滚）；
- **检查点缺失即如实报告**：没有「部分树」兜底——该轮快照被关闭/失败/修剪时，回退对话框显示「没有保存这条消息发送之前的文件」，不会用另一套恢复集合悄悄替代；
- **轨迹重放只覆盖会话内的内容型工具**（`write`/`edit`/`str_replace_editor`）：终端命令与外部进程的写盘不可见（由检查点对比补位）；早于会话首次写入的文件基线不可知（区间 diff 中表现为新增，notes 注明）；
- **排除清单内的写入完全不可见**（`.git`、`node_modules`、构建产物等默认排除）；超过大小/数量上限的路径显式跳过、不可恢复；
- 终端写盘不做命令级归因（哪条命令写的不可知），清单由检查点轮 diff 兜底：轮末检查点之后的轮间手动/外部修改不属于任何轮；同一路径被多会话触碰时归属标 multi（仅徽标）；
- Windows 上权限位语义受限（只读位有效）；
- 跨机共享存储未设计（锁判活按单机 pid）。

## 致谢

本插件的功能设计借鉴了两个优秀的同类插件：

- [**dsh-file-review-tab**](https://github.com/Lzh3070/dsh-file-review-tab)（Lzh3070）——「聊天轮尾审查卡片 + 侧边栏文件审查」的产品形态；本插件在此基础上补齐了 hunk 级撤销 / 重做与检查点单源的改动清单。
- [**dsh-turn-rewind**](https://github.com/Anionex/dsh-turn-rewind)（Anionex）——「按消息锚定恢复工作区、恢复后可从该请求重新出发」的会话回退语义；本插件改用影子 `jj` 仓库实现整树快照，并以就地遮蔽回退对话。

感谢原作者们的开源分享。

## License

MIT

---

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=DreamsTOF/dsh-shadow-rewind&type=Date)](https://star-history.com/#DreamsTOF/dsh-shadow-rewind&Date)

---

<p align="center">
  <strong>⭐ 如果影子快照帮你救回过一次改动，就给它一个 star 吧！</strong>
</p>