/**
 * 写入闸（「以当前为准」）测试：所有权登记与翻转、按工具的拒绝/放行、
 * 子代理谱系继承、所有者消失兜底，以及恢复占用闸的运行中会话分诊。
 * 不依赖 dsh 运行时——闸只消费注入的最小 deps（canonicalDirectory/sessions/agents）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { WorkspaceWriteGate, DEFAULT_READONLY_TOOLS } from '../lib/write-gate.js'
import { partitionRunningSessions } from '../lib/rewind-host.js'

const WORKSPACE = '/tmp/gate-workspace'

function agent(id, cwd = WORKSPACE, parentSession) {
  return {
    id,
    session: {
      header: { cwd, ...(parentSession === undefined ? {} : { parentSession }) },
    },
  }
}

/** 依 agent 集合构造闸 deps：canonicalDirectory 直接返回原路径。 */
function makeDeps(list = []) {
  const byId = new Map(list.map(entry => [entry.id, entry]))
  return {
    canonicalDirectory: async (path) => path,
    sessions: { get: (id) => byId.get(id) },
    agents: { list: () => list },
  }
}

async function claimTurn(gate, entry) {
  await gate.claim(entry)
}

test('所有者可写；其它会话的可变工具被拒，只读工具放行', async () => {
  const a = agent('agent-a')
  const b = agent('agent-b')
  const gate = new WorkspaceWriteGate(makeDeps([a, b]))
  await claimTurn(gate, a)

  assert.deepEqual(await gate.check({ name: 'write', agent: a }), { kind: 'allow' })
  assert.deepEqual(await gate.check({ name: 'edit', agent: a }), { kind: 'allow' })

  const denied = await gate.check({ name: 'write', agent: b })
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /agent-a/, '拒绝理由必须点名当前所有者')
  assert.match(denied.reason, /write/, '拒绝理由必须点名被拒工具')

  // 终端类也在拒绝面内；白名单只读面放行。
  assert.equal((await gate.check({ name: 'bash', agent: b })).kind, 'deny')
  assert.equal((await gate.check({ name: 'run_code', agent: b })).kind, 'deny')
  for (const readonly of DEFAULT_READONLY_TOOLS) {
    assert.deepEqual(await gate.check({ name: readonly, agent: b }), { kind: 'allow' }, readonly)
  }
})

test('所有权随回合开始翻转：新所有者可写，旧所有者被拒', async () => {
  const a = agent('agent-a')
  const b = agent('agent-b')
  const gate = new WorkspaceWriteGate(makeDeps([a, b]))
  await claimTurn(gate, a)
  await claimTurn(gate, b)

  assert.deepEqual(await gate.check({ name: 'write', agent: b }), { kind: 'allow' })
  assert.equal((await gate.check({ name: 'write', agent: a })).kind, 'deny')
})

test('子代理不抢占所有权，且经谱系继承父会话的写权利', async () => {
  const parent = agent('agent-a')
  const child = agent('agent-child', WORKSPACE, 'agent-a')
  const outsider = agent('agent-b')
  const gate = new WorkspaceWriteGate(makeDeps([parent, child, outsider]))
  await claimTurn(gate, parent)

  // 子代理回合开始：不改变所有权。
  await claimTurn(gate, child)
  assert.deepEqual(await gate.check({ name: 'write', agent: parent }), { kind: 'allow' })

  // 子代理写文件：谱系上溯命中所有者 → 放行；旁观者 → 拒绝。
  assert.deepEqual(await gate.check({ name: 'write', agent: child }), { kind: 'allow' })
  assert.equal((await gate.check({ name: 'write', agent: outsider })).kind, 'deny')
})

test('谱系经 deps.sessions 上溯多层（孙代理也算所有者一方）', async () => {
  const parent = agent('agent-a')
  const child = agent('agent-child', WORKSPACE, 'agent-a')
  const grandchild = agent('agent-grandchild', WORKSPACE, 'agent-child')
  const gate = new WorkspaceWriteGate(makeDeps([parent, child, grandchild]))
  await claimTurn(gate, parent)

  assert.deepEqual(await gate.check({ name: 'write', agent: grandchild }), { kind: 'allow' })
})

test('谱系环与断链安全：回到 false，不会误放行', async () => {
  const parent = agent('agent-a')
  const cyclic = agent('agent-c', WORKSPACE, 'agent-c')
  const orphan = agent('agent-d', WORKSPACE, 'agent-missing')
  const gate = new WorkspaceWriteGate(makeDeps([parent, cyclic, orphan]))
  await claimTurn(gate, parent)

  assert.equal((await gate.check({ name: 'write', agent: cyclic })).kind, 'deny')
  assert.equal((await gate.check({ name: 'write', agent: orphan })).kind, 'deny')
})

test('所有者消失（会话关闭）→ 工作区视为无主，放行直到下一次登记', async () => {
  const a = agent('agent-a')
  const b = agent('agent-b')
  const deps = makeDeps([a, b])
  const gate = new WorkspaceWriteGate(deps)
  await claimTurn(gate, a)
  assert.equal((await gate.check({ name: 'write', agent: b })).kind, 'deny')

  deps.agents.list = () => [b] // a 已被处置
  assert.deepEqual(await gate.check({ name: 'write', agent: b }), { kind: 'allow' })
  // 下一次登记后恢复正常裁决。
  await claimTurn(gate, b)
  assert.equal((await gate.check({ name: 'write', agent: a })).kind, 'deny')
})

test('无法归因的调用一律放行：无 agent、无 cwd、无所有者、未知工作区', async () => {
  const a = agent('agent-a')
  const gate = new WorkspaceWriteGate(makeDeps([a]))
  await claimTurn(gate, a)

  assert.deepEqual(await gate.check({ name: 'write' }), { kind: 'allow' })
  assert.deepEqual(await gate.check({ name: 'write', agent: { id: 'x', session: { header: {} } } }), { kind: 'allow' })
  assert.deepEqual(await gate.check({ name: 'write', agent: agent('agent-b', '/tmp/other-ws') }), { kind: 'allow' })
  assert.deepEqual(await gate.check({ name: 'write', agent: a }), { kind: 'allow' })
})

test('config.writeGateAllow 可扩充白名单；拒绝理由里的工具名用兜底文案', async () => {
  const a = agent('agent-a')
  const b = agent('agent-b')
  const gate = new WorkspaceWriteGate(makeDeps([a, b]), { allow: ['custom_readonly'] })
  await claimTurn(gate, a)

  assert.deepEqual(await gate.check({ name: 'custom_readonly', agent: b }), { kind: 'allow' })
  const denied = await gate.check({ agent: b })
  assert.equal(denied.kind, 'deny')
  assert.match(denied.reason, /该工具/)
})

test('partitionRunningSessions：闸开启只拦请求者与所有者，闸关闭保持旧行为', () => {
  assert.deepEqual(
    partitionRunningSessions(['req', 'owner', 'other'], 'req', 'owner', true),
    { blocking: ['req', 'owner'], gated: ['other'] },
  )
  assert.deepEqual(
    partitionRunningSessions(['req', 'other'], 'req', undefined, true),
    { blocking: ['req'], gated: ['other'] },
    '无所有者时只拦请求者自身',
  )
  assert.deepEqual(
    partitionRunningSessions(['a', 'b'], 'req', 'owner', false),
    { blocking: ['a', 'b'], gated: [] },
    '闸关闭：任何运行中的会话都阻塞（旧行为）',
  )
})

test('运行中途切换：关闭=软放行、登记照常；再开启=硬抢占', async () => {
  const a = agent('agent-a')
  const b = agent('agent-b')
  const gate = new WorkspaceWriteGate(makeDeps([a, b]), { enabled: false })
  assert.equal(gate.isEnabled, false)

  // 闸关闭但所有权登记照常进行（中途再开启时有据可依）。
  await claimTurn(gate, a)
  assert.deepEqual(await gate.check({ name: 'write', agent: b }), { kind: 'allow' })
  assert.deepEqual(await gate.check({ name: 'write', agent: a }), { kind: 'allow' })

  // 中途开启：立即对新调用生效（严格抢占），所有者不受影响。
  gate.setGate(true)
  assert.equal(gate.isEnabled, true)
  assert.deepEqual(await gate.check({ name: 'write', agent: a }), { kind: 'allow' })
  assert.equal((await gate.check({ name: 'write', agent: b })).kind, 'deny')

  // 中途再关闭：恢复全放行（进行中的调用本就不受影响）。
  gate.setGate(false)
  assert.deepEqual(await gate.check({ name: 'write', agent: b }), { kind: 'allow' })
})
