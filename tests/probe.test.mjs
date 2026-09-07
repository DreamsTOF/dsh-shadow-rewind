/**
 * 探针测试（ABSORB-RECALL 5.4，仿 dsh-recall-plugin tests/probe）：读本机
 * dsh 包的 .d.ts 把「官方字段假设」钉死。影子插件对宿主全是结构类型
 * （host/types.ts 的 SessionFace / SessionControllerLike 等），dsh 升级
 * 破坏假设只能运行时炸——这里以声明文本为准做编译期事实巡检，含负向
 * 断言（确认不存在的字段：运行时守卫不能补救错误的字段假设）。
 *
 * 钉死的假设（升级 dsh devDeps 后本文件红了 = 假设失效，先改 host/types.ts
 * 再发版；正向/负向各一条注释说明出处）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const requireFromHere = createRequire(import.meta.url)
const pkgRoot = (name) => requireFromHere.resolve(`${name}/package.json`).replace(/package\.json$/, '')

async function readTypes(name, file) {
  return readFile(joinTypes(name, file), 'utf8')
}
function joinTypes(name, file) {
  return new URL(`file://${pkgRoot(name)}lib/${file}`).pathname.replace(/^\/([A-Za-z]):/, '$1:')
}

test('probe：Session 的官方读取面是 snapshotEvents() 方法，header 带 cwd/parentSession/isSeeded', async () => {
  const source = await readTypes('@deepseek-ai/dsh-session', 'types/index.d.ts')
  // 正向（index.d.ts Session class）：host/types.ts sessionEvents 的双态兼容
  // 之一（0.1.2 起核心 Session 用方法面）。
  assert.match(source, /snapshotEvents\(fromSeq\?\s*:\s*SessionLogOffset,\s*toSeqExclusive\?\s*:\s*SessionLogOffset\)\s*:\s*readonly SessionEvent\[\]/,
    'Session.snapshotEvents 签名假设失效')
  assert.match(source, /readonly header: SessionHeader/, 'Session.header 字段假设失效')
  // SessionHeader 字段（types.d.ts 定义文件）：coordinator 的 cwd/parentSession
  // 判定与 session.header.id 的假设来源。
  const headerSource = await readTypes('@deepseek-ai/dsh-session', 'types/types.d.ts')
  assert.match(headerSource, /readonly cwd\?: string/, 'SessionHeader.cwd 假设失效')
  assert.match(headerSource, /readonly parentSession\?: SessionId/, 'SessionHeader.parentSession 假设失效')
  assert.match(headerSource, /readonly isSeeded: boolean/, 'SessionHeader.isSeeded 假设失效')
})

test('probe：负向——0.1.2 的 Session 不再有 events 数组属性（守卫不能救错误假设）', async () => {
  const source = await readTypes('@deepseek-ai/dsh-session', 'types/index.d.ts')
  // SessionFace.events（host/types.ts）只为 0.1.1 旧 runtime 保留；若官方
  // 声明里出现 `events:` 属性说明形状回归，sessionEvents 的分支优先级
  // （数组优先于方法）会静默读错数据源。
  assert.doesNotMatch(source, /^\s+events\s*:/m, 'Session.events 数组属性不应存在（0.1.2 已被 snapshotEvents 取代）')
})

test('probe：sessionController 的 create/fork 是直连方法（apiProxy 已移除）', async () => {
  const source = await readTypes('@deepseek-ai/dsh-api-session-controller', 'types/index.d.ts')
  // 正向：SessionControllerLike 的两态假设（0.1.2 起直连方法、错误 throw）。
  assert.match(source, /create\(request: SessionCreateRequest\)\s*:\s*Promise<SessionCreateValue>/, 'sessionController.create 签名假设失效')
  assert.match(source, /fork\(request: SessionForkRequest\)\s*:\s*Promise<SessionForkValue>/, 'sessionController.fork 签名假设失效')
  // 负向：0.1.2 移除了 apiProxy——宿主半边不得再假设它存在（EXPECTED-DESIGN
  // 装配注释的迁移依据）。
  assert.doesNotMatch(source, /apiProxy/, 'apiProxy 不应存在于 0.1.2 会话网关声明中')
})

test('probe：turnTail 链槽位与 owner 面（轮尾行认领的形状来源）', async () => {
  const source = await readTypes('@deepseek-ai/dsh-client-ui-chat', 'types/client/contract/slots.d.ts')
  assert.match(source, /'conversation\.chat\.turnTail':\s*\{\s*kind: 'chain';\s*scope: 'session';\s*owner: TurnTailOwnerProps;/,
    'conversation.chat.turnTail 槽位形状假设失效（kind/scope/owner 任一变动都会影响 priority -2 认领）')
  assert.match(source, /export interface TurnTailOwnerProps \{\s*turn: TurnLocation;/, 'TurnTailOwnerProps.turn 假设失效')
})
