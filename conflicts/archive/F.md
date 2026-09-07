# 冲突组 F —— 线上契约剥掉了自己语义所需的字段（决策文档）

> 冲突描述：卷二 F1（typert schema 无 `origin/dirKind/oldMode/newMode`，
> zod strip 导致目录与纯 chmod 撤销在线上必然失效；README 的对应承诺不成立）。
> **这是当前功能不可用的直接原因之一，建议最先做。**

## 方案 F-1：schema 补 4 个 optional 字段 ★推荐

- **做法**：`typert-descriptors.ts` 的 `diffSchema` 补 `oldMode/newMode`
  （optional），`requestSchema` 的 file 补 `origin/dirKind`（optional）。
  完全符合该文件头自家守则「新增字段一律可选，避免旧 bundle 与新宿主互相
  判非法」。
- **改动面**：一个文件 4 行。
- **代价**：极小，无回归面——旧 bundle 发的字段少，不受影响；新字段补上后
  `fsChangeShape` 的目录/mode 分支从「线上不可达」变「正常工作」。
- **顺带**：H-1（可逆判定收敛）的服务端判定从此才正确；README 承诺与实现
  重新对齐。
- **验证**：现有多数单测直调 service 不经过 codec，测不出这条链路——建议补
  一条**走 typert 编解码往返**的用例（客户端形状的请求 → codec parse →
  service apply），这也是防再发的关键测试。

## 方案 F-2：顺手加 `.strict()`，让未来漂移变成显式报错

- **做法**：schema 加 `.strict()`，未知字段从 strip 变 reject。
- **代价**：要求两端发布严格同步——任何一端先发版，组合就开始报错。自用
  场景同仓同发布，风险可控；但与文件头的守则方向相反。
- **取舍**：只对 request 层加 strict、diff 层保持宽松，是折中点。
- **诚实评估**：F-1 修完后 strip 的实际危害已经很小（该发的字段都在 schema
  里了），F-2 是防再发措施，非必需。

## 推荐

F-1 必做，随时可上。F-2 可选。
