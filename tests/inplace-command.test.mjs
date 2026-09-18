/**
 * 就地遮蔽回退·宿主执行层测试（M2，HTTP 化后语义不变）。
 * 无真实 cordis agent：用结构性 Session 桩 + append/cancel/remove 记录 spy
 * 驱动 executeInPlaceMask，验证执行语义（append 形状 / 打断 / 丢插话 /
 * 幂等防并发闸）。命令入口（/shadow-inplace、__candidates、preview）已随
 * 命令面整体移除。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { executeInPlaceMask } from '../lib/host/inplace-http.js'

const ev = (seq, type, text, { sourceKind = 'user' } = {}) => ({
  seq,
  type,
  data: sourceKind === 'assistant'
    ? {}
    : { content: text === undefined ? [] : [{ type: 'text', text }], source: { kind: sourceKind } },
})

function makeAgent({ events, surface, status = 'idle', whenIdleResolves = true } = {}) {
  const spy = { cancel: 0, remove: 0, appended: [] }
  const agent = {
    id: 's1',
    status,
    inbox: {
      nextStep: [{ id: 'n1' }, { id: 'n2' }],
      remove(id) { spy.remove += 1; this.nextStep = this.nextStep.filter(m => m.id !== id) },
    },
    cancel() { spy.cancel += 1 },
    whenIdle() {
      return whenIdleResolves ? Promise.resolve(true) : new Promise(() => {})
    },
    session: {
      id: 's1',
      surface: { nodes: surface },
      snapshotEvents: () => events,
      append(type, data, options) {
        spy.appended.push({ type, data, options })
        return { seq: events.length + 1 }
      },
    },
  }
  return { agent, spy }
}

const sampleEvents = () => [
  ev(1, 'user/message', '你好'),
  ev(2, 'assistant/message', undefined, { sourceKind: 'assistant' }),
  ev(3, 'user/message', '第二次'),
  ev(4, 'assistant/message', undefined, { sourceKind: 'assistant' }),
  ev(5, 'user/message', '第三次'),
  ev(6, 'assistant/message', undefined, { sourceKind: 'assistant' }),
]
const sampleSurface = [1, 2, 3, 4, 5, 6]

test('idle 直接执行：append 一次、surfaceOp replace 覆盖 [目标..surface 尾]、sourceEventSeqs 含全部被遮蔽 seq', async () => {
  const { agent, spy } = makeAgent({ events: sampleEvents(), surface: sampleSurface })
  const result = await executeInPlaceMask(agent, 3)
  assert.equal(result.kind, 'ok')
  assert.equal(result.markerSeq, 7, '标记 seq = 追加后事件序号')
  assert.ok(result.text.includes('#3'))
  assert.equal(spy.cancel, 0, 'idle 不打断')
  assert.equal(spy.appended.length, 1)
  const call = spy.appended[0]
  assert.equal(call.type, 'user/message')
  assert.deepEqual(call.data.content, [], '标记为空内容')
  assert.equal(call.data.source.kind, 'plugin')
  assert.equal(call.data.source.plugin, 'dsh-shadow-rewind')
  assert.deepEqual(call.options.surfaceOp, { op: 'replace', start: 3, end: 6 })
  assert.deepEqual(call.options.sourceEventSeqs, [3, 4, 5, 6])
})

test('运行中：先 cancel(keepInbox) 等 idle，再丢弃 next-step 插话', async () => {
  const { agent, spy } = makeAgent({ events: sampleEvents(), surface: sampleSurface, status: 'running' })
  const result = await executeInPlaceMask(agent, 3)
  assert.equal(result.kind, 'ok')
  assert.equal(spy.cancel, 1, '运行中必须打断一次')
  assert.equal(spy.remove, 2, '两条 next-step 插话都被丢弃')
  assert.equal(spy.appended.length, 1)
})

test('目标 seq 不存在：报错且不 append', async () => {
  const { agent, spy } = makeAgent({ events: sampleEvents(), surface: sampleSurface })
  const missing = await executeInPlaceMask(agent, 99)
  assert.equal(missing.kind, 'error')
  assert.ok(missing.text.includes('直发用户消息'))
  assert.equal(spy.appended.length, 0)
})

test('append 抛错：错误透传为失败结果（不裸抛）', async () => {
  const { agent, spy } = makeAgent({ events: sampleEvents(), surface: sampleSurface })
  agent.session.append = () => {
    throw new TypeError("Cannot read properties of undefined (reading 'log')")
  }
  const result = await executeInPlaceMask(agent, 3)
  assert.equal(result.kind, 'error')
  assert.ok(result.text.includes('追加遮蔽标记失败'))
  assert.equal(spy.appended.length, 0)
})

test('同会话并发：第二个在第一个等待 idle 期间被 in-flight 闸拒', async () => {
  // 制造真实重叠：第一个在运行中分支 await whenIdle 挂起（inflight 已入闸），
  // 此时第二个同会话请求必须被拒；之后放行第一个完成。
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const { agent } = makeAgent({
    events: sampleEvents(),
    surface: sampleSurface,
    status: 'running',
    whenIdleResolves: undefined, // 用手动 gate 替代默认 whenIdle
  })
  agent.whenIdle = () => gate
  const first = executeInPlaceMask(agent, 3)
  const second = await executeInPlaceMask(agent, 1)
  assert.equal(second.kind, 'error')
  assert.ok(second.text.includes('就地回退在执行'))
  release(true)
  const settled = await first
  assert.equal(settled.kind, 'ok')
})
