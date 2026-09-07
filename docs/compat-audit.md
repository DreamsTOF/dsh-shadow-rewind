# compat 台账：官方 API 耦合点矩阵

> 仿 dsh-recall-plugin/docs/compat-audit.md（ABSORB-RECALL 5.5）。本文是
> 「一直成立的事实」底稿：把插件对 dsh 宿主的全部结构类型假设收进一张
> 「耦合点 × 出处 × 探针」矩阵，供 **dsh 升级后定点复查**——升级后先过本表，
> 逐条核对「出处」是否漂移。机器化盯防由两道探针承担：`tests/probe.test.mjs`
> （钉 .d.ts 声明文本）与 `tests/verify-host.test.mjs`（钉真实装配行为）。
>
> 核验基线：@deepseek-ai/* devDeps 0.1.2-rc.1（2026-09-06）。每次升级后：
> 1) `pnpm install --frozen-lockfile` 更新 lockfile；
> 2) `pnpm test`（探针红 = 该条假设失效，先改 `src/host/types.ts` / 相关
>    出处再发版）；
> 3) 在本节追加一行核验记录。

## 核验记录

- **2026-09-06（0.1.2-rc.1 基线）**：矩阵初建，134 测试全绿（含探针 4 + verify-host 1）。

## 矩阵

| # | 耦合点 | 插件出处 | 探针 | 失效症状 | 复查动作 |
| --- | --- | --- | --- | --- | --- |
| I1 | Session 事件读取双态：0.1.1 `events` 数组 / 0.1.2 `snapshotEvents()` 方法 | `src/host/types.ts` `sessionEvents`（数组优先） | probe「snapshotEvents 签名」「负向 events:」 | 会话事件读空 → 轮检查点全部 skipped（找不到 turn/start） | 升级后核对 `dsh-session/lib/types/index.d.ts` |
| I2 | SessionHeader：`cwd?` / `parentSession?` / `isSeeded` | coordinator 子代理判定（`parentSession`）、工作区定位（`cwd`） | probe SessionHeader 三字段 | 子代理检查点误建污染归属网格；会话定位失败 | 同上 + `dsh-session/lib/types/types.d.ts` |
| I3 | sessionController 直连 `create(request)` / `fork(request)`（0.1.2 移除 apiProxy） | `src/host/session-resolve.ts` createConversationRestart | probe create/fork 签名 + 负向 apiProxy | 「恢复并从新会话继续」fork 失败（补偿回滚触发） | `dsh-api-session-controller/lib/types/index.d.ts` |
| I4 | `conversation.chat.turnTail` 链槽位：kind=chain、scope=session、owner=TurnTailOwnerProps；priority -2 认领 | `src/client/file-review.tsx`（register -2） | probe turnTail 形状 | 轮尾产物卡片不渲染或与 better-sidebar 双行 | `dsh-client-ui-chat/.../contract/slots.d.ts`；核对生态内更低 priority 占用 |
| I5 | `conversation.session.header.actions` 槽位（时间线入口，order 101） | `src/client/timeline-panel.tsx` timelineApply | 无机器探针（运行时观察） | 时间线按钮消失 | 升级后目测会话头 |
| I6 | webServer.register exact 路由 + 回环边界（非回环 403） | `src/host/endpoints.ts`、`http-utils.isLoopback` | verify-host 端点注册清单 | 端点 404 / 跨源暴露 | 核对 dsh webServer 路由 kind 语义 |
| I7 | cordis inject 门禁：未声明服务不可解析（兄弟 fiber 拓扑） | `src/index.ts` 分组 inject（agents / webServer… / commands） | verify-host 真实装配 | 对应子系统 pending 不启动（fail-closed） | 装配断言常青；新增 inject 记得同步本表 |
| I8 | **cordis 4 effect 形态**：`ctx.effect(() => disposer)` ——接「返回 disposer 的函数」；传 disposer 本身静默无效（2026-09-06 实证：端点注册卸载不清零） | `src/host/endpoints.ts` installShadowRewindHttp | verify-host 卸载清零断言 | 插件禁用/HMR 后路由残留（幽灵端点） | cordis 升级重看 `fiber.effect` 签名 |
| I9 | settings namespace 三版本分派：`installSection` 方法（0.1.2-alpha.2+）/ `register` 核心 API（老）/ dsh-settings 独立函数（最老）；schemasty 缺席 → 降级只读 | `src/host/settings-bridge.ts` | verify-host 降级断言（本机无 schemasty 时） | 设置卡片缺席（降级）、写配置 409 CONFIG_UNAVAILABLE | 升级后实测 installSection 路径（活体冒烟） |
| I10 | `settings.plugin.item` keyed slot 不在本地 SlotMap 声明（ui-settings 包未安装）——client 侧以声明合并补型 | `src/client/settings-card.tsx` 顶部 declare module | typecheck（slot 名报错即漂移） | 设置卡片不渲染 | 升级后核对 SlotMap 真名与 kind/scope |
| I11 | sessionQuery.readSession 冷读形状（`{ session, inheritedEventCount, events }`） | `src/host/session-resolve.ts` readSession | verify-host 桩（弱） | 冷会话消息寻址失败 | `dsh-client-store` 声明 |
| I12 | conversation 服务名迁移面（0.1.1 `conversationEvents` / 0.1.2 `uiConversation.events`）——**动态解析，不进静态 inject** | `src/client/file-review.tsx` registerDeliverables | 无（行为级） | 轮尾 fs 卡片缺归属面板 | 升级后核 dsh-client-ui-conversation apply 声明 |
| I13 | betterSidebar 可选：静态声明会让未装宿主永久 pending——动态解析 | `src/client/file-review.tsx` | typecheck 之外无 | 侧边栏 tab 缺席（其余可用） | 保持不进 inject 数组的纪律 |
| I14 | client inject 门禁（0.1.2 guard facade）：ctx.<name> 仅限声明的服务 | `src/client/index.tsx` inject 数组 | 无 | UI 全灭（slots 拿不到） | 新增服务记得同步 inject 数组 |
| I15 | npm peer 区间 prerelease 坑：跨元组 prerelease 需显式 `>=X-0` 比较器 | `package.json` peerDependencies | pnpm install / DSH-Store 安装 | 0.1.3-alpha.x 上 peer 判越界 | dsh 发新元组后重跑区间验证（node npm 内置 semver） |

## 已知非耦合点（刻意不做机器盯防）

- **jj CLI 版本**：`jjAvailable()` 只探测可用性（`src/jj-backend.ts`），`jj file show` 双子命令兼容（0.40 起 cat → file show）已有运行时回退，不钉版本号。
- **dsh-settings 包不进 devDeps**：其自身依赖区间（dsh-llm `>=0.1.2 <0.2.0-0`）在 npm 上为空解，pnpm 重解析硬失败（官方踩了 I15 同款坑）——运行时动态 import + 宿主解析，类型用 `src/types/host-modules.d.ts` 最小声明。升级 dsh 后若官方修好区间，可考虑补回类型。
