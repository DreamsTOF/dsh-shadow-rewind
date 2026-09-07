# 项目定位与核心思想

`dsh-shadow-rewind` 是 DeepSeek Harness（DSH）的会话级文件快照与回退插件。它要回答的问题是：

> AI 在一个会话的每一轮里改了什么文件？每一处改动能不能单独回滚？回滚错了能不能撤销？

## 三层 diff 来源

插件**没有**用单一的「上帝视角」解决问题，而是让三条互相补位的证据链并存：

| 层 | 数据源 | 粒度 | 覆盖范围 | 盲区 |
| --- | --- | --- | --- | --- |
| **快照配对** | 影子 jj 仓库 / SQLite 内容库 | 任意两个检查点之间的整树差异 | 终端命令、外部进程、一切落盘 | 轮内创建又删除的临时文件（两端检查点都不含）；排除清单内路径 |
| **轨迹重放** | 会话事件流（`tool/call` 参数） | 任意两个调用边界之间的内容重放 | `write` / `edit` / `str_replace_editor` | 终端与外部写盘不可见；会话首次写入前的基线不可知 |
| **工具 hunk** | 工具结果 + Code Mode 录制 | 单个文件内的 hunk 块 | 本轮工具改动 | 不覆盖终端写盘 |

三者的分工原则写在 `src/trace-replay.ts:13-19` 的模块注释里：**快照优先、轨迹兜底，两者并存不互相覆盖；盲区以 notes 诚实标注，而不是掩盖**。轨迹重放的历史会话可用性是它存在的核心理由——被配额淘汰的检查点无法再回答「那几轮改了什么」，但会话事件流还在，重放就能回答。

## 两条铁律

`src/engine.ts:4-9` 的模块注释把不变量放在了最前面：

1. **绝不调用工作区自身的任何 VCS。** 文件枚举只走目录扫描（`src/scan.ts` 是引擎唯一的枚举通道，见 `src/scan.ts:1-8` 注释），快照字节只落在存储根下的影子 jj 仓库或 SQLite 内容库。工作区里有没有 `.git`、`.jj`，插件一律不读不写。
2. **恢复 = 两态翻转（EXPECTED-DESIGN 1.4）。** 恢复前自动 rescue 备份 → 事后逐路径哈希/类型/权限验证 → 失败自动回滚到状态 A；流程性检查（计划过期、会话绑定）只作软警告，撤销冲突经三选项弹窗交用户裁决，绝不留半恢复状态。

## 影子仓库平行线

存储根默认在 `$DSH_HOME/shadow-rewind/v1`（`src/engine.ts:104-106`），与工作区物理隔离。每个工作区的 key 是 `SHA-256(规范化绝对路径) 截断 16 位 hex`（`src/store.ts:66-82`、`src/engine.ts:216-227`）——截断是为了 Windows MAX_PATH 下深层的 `.jj` 内部路径不触顶，身份的权威校验放在 `workspace.json` binding 文件上而不是靠 key 全长。

```text
你的项目目录（随便怎么折腾）            插件存储根（$DSH_HOME/shadow-rewind/v1）
├── src/...                            └── workspaces/<key>/
├── .git/   ← 插件从不读写                  ├── manifests/           恢复点清单（fail-closed 全量校验）
                                            ├── turn-outcomes/       检查点跳过记录
                                            ├── content.db           SQLite 内容库（降级后端）
                                            └── shadow-repos/<key>/  影子 jj 仓库（快照字节）
```

## 与宿主的四个接缝

插件以 cordis 服务 `ctx.shadowRewind` 装配（`src/index.ts:48-86`），在四个宿主接缝上挂载：

1. **`agent/pre-step` 瀑布**（prepend 抢在最前）：每轮第一步之前捕获轮起检查点 —— `src/rewind-host.ts:116-121`（子代理没有自己的用户回合，`parentSession` 非空直接跳过，`src/rewind-host.ts:183-186`）；
2. **`session/event` 订阅**：`turn/end` 事件时捕获轮末检查点并采集意图标签 —— `src/rewind-host.ts:123-126`；
3. **`webServer` 注册**：`/shadow-rewind` 系列同源 HTTP 端点（仅回环）—— `src/rewind-host.ts:457-481`；
4. **`tools/post-execute` 瀑布**：Code Mode（`run_code`）嵌套派发的文件修改录制 —— `src/file-review/host.ts:74-99`。

另有 Typert `fileReview` 命名空间（浏览器逐 hunk 撤销的服务端）与 `commands` 命令面（`/shadow-diff`、`/shadow-undo`），后者缺失时 inject 挂起即可、不影响其余装配（`src/index.ts:73-75`）。

## 一个重要的事实：写入闸已移除

README 第四节描述的「以当前为准 / 对称」双模式是**过时的**。`conflicts/DECISION-final-scope.md`（2026-09 定稿）拍板：`src/write-gate.ts`、`/shadow-rewind/gate` 端点、`writeGate` 配置整体移除，**永久对称模式**——并行写入不限制，恢复不再等待运行中的会话，安全网全部压在 rescue 备份 + 逐路径验证 + 失败回滚上。当前代码里已经没有 write-gate 模块，归因（`src/attribution.ts`）退化为纯建议标签。

接下来几章按「数据怎么流」的顺序展开：先看总体架构，再看每轮 diff 的生成管线、存储布局，然后是恢复执行与撤销的完整时序。
