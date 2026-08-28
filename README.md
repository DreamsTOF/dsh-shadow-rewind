# dsh-shadow-rewind

针对 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的会话级文件快照与回退插件。

**核心设计：影子仓库平行线。** 工作区自身的任何 VCS（git / jj / 无）与本插件的影子 jj 仓库完全隔离——插件枚举文件只走目录扫描，快照字节只写入存储根下的隐藏 jj 仓库；恢复时只改写文件内容，绝不触碰工作区的 `.git`、`.jj`、HEAD、分支或提交。

```text
你的项目目录（随便怎么折腾）          插件存储根（$DSH_HOME/shadow-rewind/v1）
├── src/...                          └── workspaces/<key>/
├── .git/   ← 插件从不读写               ├── manifests/        恢复点清单
└── ...                                  ├── shadow-repos/<key>/   影子 jj 仓库（快照字节）
                                         └── ...
```

## 工作方式

1. **自动检查点**：每轮对话在 Agent 第一步之前自动把工作区（可配置排除的目录除外）快照进影子 jj 仓库——每个检查点是一条显式 commit。
2. **回退入口**：每条直发用户消息下出现「恢复到发送之前」按钮；对话框预览将恢复的文件清单与快照时显式跳过的路径，并提供两种模式：
   - **恢复文件并从这里继续** —— 恢复文件后分叉新会话（原会话保留）；
   - **只恢复文件** —— 当前对话不动。
3. **恢复安全闸**（全部强制）：限时计划 + 确认串逐字回显 → 恢复前自动 rescue 备份 → 持久操作日志 → 事后哈希/权限验证；任何失败自动从备份回滚，绝不留半恢复状态。

## 与文件工具无关的覆盖面

快照是磁盘级目录扫描，因此无论文件是被 AI 的 write/edit 工具、命令行、git 操作还是外部编辑器修改的，都能恢复到检查点时的状态。超大、类型不支持或读取失败的路径会被**显式记录**（预览中展示「恢复不会碰它们」），而不是静默失败。

## 安装

```sh
pnpm install
pnpm run check          # 构建 + 测试（jj 可用时自动加测影子后端）
dsh plugin --profile web add dsh-shadow-rewind
```

依赖：Node ≥ 22.19；`jj` CLI **可选**——缺失时自动检查点降级为内置 blob 存储，功能不中断（启动日志会提示降级）。

## 配置（cordis.patch.yml）

```yaml
- insert:
    - id: shadow-rewind
      name: 'dsh-shadow-rewind'
      config:
        turnCheckpointMode: jj          # jj（默认）/ legacy / off
        excludePatterns:                # 工作区相对 glob；字面路径=任意层级同名目录
          - .git
          - .jj
          - node_modules
          - dist
        maxFileBytes: 16777216          # 超限文件跳过并显式记录
        maxFiles: 20000
        maxSnapshotBytes: 536870912
        maxTurnCheckpointsPerSession: 30
        maxRestorePoints: 50
        planTtlMs: 900000
        turnCheckpointTimeoutMs: 5000
        turnCheckpointMaxNewBytes: 33554432
        turnCheckpointTrust: fast       # fast=stat 缓存增量；strict=全量重读
```

HTTP 端点为同源 `/shadow-rewind`（仅接受回环请求），浏览器半边随包分发。

## 测试

`pnpm test` 使用真实临时目录跑完整回退链路：修改/删除/新增文件的恢复、排除规则、超大文件跳过、计划过期拒绝、删除确认闸、无变更短路；宿主机装有 `jj` 时自动加测影子后端往返。

## 边界（当前版本）

- 恢复的是**文件内容**：不回滚任何 VCS 历史（工作区 git 的提交不受影响）；
- 空目录结构不单独追踪（按需在恢复时重建/回收）；
- 跨机共享存储未设计（锁判活按单机 pid）。

## License

MIT
