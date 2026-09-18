/**
 * 就地遮蔽回退·纯规划层测试（移植自 dsh-rewind/src/rewind.ts 语义）。
 * 只用事件日志 + 有序 surface 派生，无 I/O，可直接单测。
 * 候选表（listInPlaceCandidates/formatCandidateList）随命令面移除已删。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isHumanUserMessage,
  planInPlace,
  InPlacePlanError,
} from '../lib/inplace/plan.js'
import { INPLACE_MARKER_PLUGIN, buildInPlaceMarker } from '../lib/inplace/marker.js'

const user = (seq, text, time = seq * 1000) => ({
  seq,
  type: 'user/message',
  time,
  data: { content: [{ type: 'text', text }], source: { kind: 'user' } },
})
// 注入 context / compact 检查点 / 工具回填：以非 'user' source 到达 user/message。
const plugin = (seq, text) => ({
  seq,
  type: 'user/message',
  time: seq * 1000,
  data: { content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'compact' } },
})

test('isHumanUserMessage：只认直发用户（source.kind==user）', () => {
  assert.equal(isHumanUserMessage(user(1, 'hi')), true)
  assert.equal(isHumanUserMessage(plugin(2, 'checkpoint')), false)
  assert.equal(isHumanUserMessage({ seq: 3, type: 'assistant/message', data: {} }), false)
})

test('planInPlace：遮蔽区间含目标及其后全部 surface 节点', () => {
  const events = [user(10, 'a'), user(20, 'b'), user(30, 'c')]
  const surface = [10, 11, 12, 20, 21, 22, 30, 31]
  const plan = planInPlace({ events, surface, targetSeq: 20 })
  assert.equal(plan.targetSeq, 20)
  assert.equal(plan.targetIndex, 3)
  assert.deepEqual(plan.shadowedSeqs, [20, 21, 22, 30, 31], '含目标到 surface 尾')
  assert.equal(plan.surfaceStart, 20)
  assert.equal(plan.surfaceEnd, 31)
})

test('planInPlace：目标不是直发用户消息 / 不在 surface → 带码失败', () => {
  const events = [user(10, 'a'), plugin(20, 'ckpt')]
  assert.throws(
    () => planInPlace({ events, surface: [10, 20], targetSeq: 20 }),
    (error) => error instanceof InPlacePlanError && error.code === 'NOT_A_USER_MESSAGE',
  )
  assert.throws(
    () => planInPlace({ events, surface: [30], targetSeq: 10 }),
    (error) => error instanceof InPlacePlanError && error.code === 'NOT_ON_SURFACE',
  )
})

test('marker：每次构造新对象、source 带插件标识、内容为空', () => {
  const marker = buildInPlaceMarker()
  assert.deepEqual(marker.content, [])
  assert.equal(marker.source.kind, 'plugin')
  assert.equal(marker.source.plugin, INPLACE_MARKER_PLUGIN)
  const another = buildInPlaceMarker()
  assert.notEqual(marker, another, '禁止复用同一对象引用')
})
