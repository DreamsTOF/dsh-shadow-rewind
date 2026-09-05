/**
 * 轨迹重放（A1）+ 意图标签（A2）+ trace 端点测试：
 * 纯函数（意图采集 / 节点提取 / 重放区间 diff / 漂移）、
 * intent 的 manifest 往返、/shadow-rewind/trace 的三种模式。
 * 真实临时目录 + 真实引擎（sqlite 后端），端点直接驱动免网络。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'
import { TurnCheckpointCoordinator } from '../lib/rewind-host.js'
import {
  collectTurnIntent,
  contentOps,
  MUTATING_CONTENT_TOOLS,
  toolResultError,
  traceNodes,
  traceRangeDiff,
  traceSpans,
  turnBoundaries,
} from '../lib/trace-replay.js'

/** 构造 tool/call 事件（arguments 为原始 JSON 串，与 0.1.2 宿主一致）。 */
function call(seq, name, args, turn = 1, step = 1, callId = `c${String(seq)}`) {
  return { type: 'tool/call', seq, data: { turn, step, callId, name, arguments: JSON.stringify(args) } }
}

/** 构造 tool/result 事件（isError 在 message.content[0]，0.1.2 无顶层 isError）。 */
function result(seq, callId, isError = false) {
  return {
    type: 'tool/result',
    seq,
    data: { callId, message: { content: [{ type: 'tool_result', toolCallId: callId, isError }] } },
  }
}

test('collectTurnIntent：三种工具的路径字段、窗口下界、上限', () => {
  const events = [
    call(10, 'write', { file_path: '/ws/a.ts', content: 'x' }),
    { type: 'user/message', seq: 11, data: {} },
    call(12, 'edit', { file_path: '/ws/b.ts', old_string: 'a', new_string: 'b' }),
    call(13, 'str_replace_editor', { command: 'str_replace', path: '/ws/c.ts', old_str: 'x', new_str: 'y' }),
    call(14, 'str_replace_editor', { command: 'view', path: '/ws/d.ts' }),
    call(15, 'bash', { command: 'echo hi' }),
    call(5, 'write', { file_path: 'before-window.ts', content: 'x' }),
  ]
  const intent = collectTurnIntent(events, 10)
  assert.deepEqual(intent.map((item) => item.seq), [12, 13], '窗口 (10, ∞) 且只含变更型调用；view/bash 排除')  // seq 10 的 write 在窗口下界之外
  assert.equal(intent[0].tool, 'edit')
  assert.equal(intent[0].path, '/ws/b.ts')
  assert.equal(intent[1].tool, 'str_replace_editor')
  // 上限：cap=2 时只保留前两条。
  assert.equal(collectTurnIntent(events, 10, 2).length, 2)
})

test('collectTurnIntent：arguments 损坏或路径缺失的调用被跳过', () => {
  const events = [
    { type: 'tool/call', seq: 10, data: { callId: 'c1', name: 'write', arguments: '{not json' } },
    call(11, 'edit', { old_string: 'a', new_string: 'b' }),
  ]
  assert.deepEqual(collectTurnIntent(events, 0), [])
})

test('traceNodes：错误标记从配对 result 合并；toolResultError 识别两种错误形态', () => {
  const events = [
    call(10, 'write', { file_path: '/ws/a.ts', content: 'x' }, 1, 1, 'ok-call'),
    result(11, 'ok-call', false),
    call(12, 'edit', { file_path: '/ws/a.ts', old_string: 'x', new_string: 'y' }, 1, 2, 'bad-call'),
    result(13, 'bad-call', true),
    { type: 'tool/result', seq: 14, data: { callId: 'x', error: { name: 'E', code: 'X' } } },
  ]
  const nodes = traceNodes(events)
  assert.equal(nodes.length, 2)
  assert.equal(nodes[0].error, undefined, '成功调用无错误标记')
  assert.equal(nodes[1].error, true, 'isError 合并进调用节点')
  assert.equal(nodes[1].mutating, true)
  assert.equal(toolResultError({ error: { name: 'E', code: 'X' } }), true, '顶层 error 也是失败')
  assert.equal(toolResultError({ message: { content: [] } }), false)
})

test('traceRangeDiff：write + edit 序列的重放与行数', () => {
  const events = [
    call(10, 'write', { file_path: '/ws/a.ts', content: 'one\ntwo\nthree\n' }),
    result(11, 'c10'),
    call(12, 'edit', { file_path: '/ws/a.ts', old_string: 'two', new_string: 'TWO' }),
    result(13, 'c12'),
    call(14, 'write', { file_path: '/ws/new.ts', content: 'a\nb\n' }),
    result(15, 'c14'),
  ]
  // (11, 15]：write(10) 在窗口前已入基线 → a.ts 被编辑（1 增 1 删）；new.ts 新增（2 行）。
  const { changes, notes } = traceRangeDiff(events, 11, 15)
  const byPath = Object.fromEntries(changes.map((change) => [change.path, change]))
  assert.equal(byPath['/ws/a.ts'].kind, 'modified')
  assert.equal(byPath['/ws/a.ts'].added, 1)
  assert.equal(byPath['/ws/a.ts'].removed, 1)
  assert.equal(byPath['/ws/a.ts'].after, 'one\nTWO\nthree\n')
  assert.equal(byPath['/ws/new.ts'].kind, 'added')
  assert.equal(byPath['/ws/new.ts'].added, 2)
  assert.ok(notes.some((note) => note.includes('终端命令')), '盲区必须诚实标注')
})

test('traceRangeDiff：old_string 未命中记漂移、绝不静默', () => {
  const events = [
    call(10, 'write', { file_path: '/ws/a.ts', content: 'hello\n' }),
    result(11, 'c10'),
    call(12, 'edit', { file_path: '/ws/a.ts', old_string: 'MISSING', new_string: 'x' }),
    result(13, 'c12'),
  ]
  // (11, 13]：write(10) 已入基线；漂移的 edit 被跳过 → 该文件内容无变化，不出现。
  const { changes, notes } = traceRangeDiff(events, 11, 13)
  assert.equal(changes.length, 0, '漂移操作被跳过，内容不变')
  assert.ok(notes.some((note) => note.includes('未找到')), '漂移必须出现在 notes')
})

test('traceRangeDiff：str_replace_editor 的 create/str_replace/insert 与状态外目标', () => {
  const events = [
    call(10, 'str_replace_editor', { command: 'create', path: '/ws/f.ts', file_text: 'l1\nl2\n' }),
    result(11, 'c10'),
    call(12, 'str_replace_editor', { command: 'insert', path: '/ws/f.ts', insert_line: 1, new_str: 'l1.5' }),
    result(13, 'c12'),
    call(14, 'str_replace_editor', { command: 'str_replace', path: '/ws/ghost.ts', old_str: 'a', new_str: 'b' }),
    result(15, 'c14'),
  ]
  const { changes, notes } = traceRangeDiff(events, 9, 15)
  const byPath = Object.fromEntries(changes.map((change) => [change.path, change]))
  assert.equal(byPath['/ws/f.ts'].after, 'l1\nl1.5\nl2\n')
  assert.ok(notes.some((note) => note.includes('不在重放状态中')), '状态外目标记漂移')
})

test('contentOps：失败调用与结果缺失的处置', () => {
  const events = [
    call(10, 'write', { file_path: '/ws/a.ts', content: 'x' }, 1, 1, 'failed'),
    result(11, 'failed', true),
    call(12, 'write', { file_path: '/ws/b.ts', content: 'y' }, 1, 2, 'pending'),
  ]
  const { ops, notes } = contentOps(events)
  assert.equal(ops.length, 1, '失败调用不进重放队列')
  assert.equal(ops[0].path, '/ws/b.ts')
  assert.ok(notes.some((note) => note.includes('结果未返回')), '进行中的调用按成功但计数')
})

test('MUTATING_CONTENT_TOOLS 与宿主内置工具名一致', () => {
  assert.deepEqual([...MUTATING_CONTENT_TOOLS].sort(), ['edit', 'str_replace_editor', 'write'])
})

test('traceSpans / turnBoundaries：三泳道投影与刻度', () => {
  const events = [
    { type: 'turn/start', seq: 5, data: { turn: 1 } },
    { type: 'user/message', seq: 6, data: {} },
    { type: 'assistant/chunk', seq: 7, data: {} },
    { type: 'assistant/message', seq: 8, data: {} },
    call(9, 'write', { file_path: '/ws/a.ts', content: 'x' }, 1, 1, 'c9'),
    result(10, 'c9', true),
    { type: 'assistant/chunk', seq: 11, data: {} },
  ]
  const spans = traceSpans(events)
  assert.deepEqual(spans.map((span) => [span.kind, span.lane]), [
    ['user', 0], ['assistant', 1], ['tool', 2],
  ], '三泳道投影；chunk 噪声与 turn/start 不成 span')
  assert.equal(spans[2].mutating, true)
  assert.equal(spans[2].error, true, '失败标记合并进 tool span')
  assert.deepEqual(turnBoundaries(events), [5])
})

test('A2：intent 写入轮末 manifest 并经 listTurnCheckpoints 往返', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-intent-ws-'))
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-intent-store-'))
  const engine = new ShadowRewindEngine({ storageDir, turnCheckpointMode: 'sqlite' })
  await engine.ready
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
    await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    const summary = await engine.createTurnCheckpoint({
      cwd: workspace,
      sessionId: 's1',
      turn: 1,
      turnStartSeq: 10,
      phase: 'end',
      intent: [{ tool: 'edit', path: 'a.txt', seq: 12 }],
    })
    assert.deepEqual(summary.intent, [{ tool: 'edit', path: 'a.txt', seq: 12 }])
    const listed = await engine.listTurnCheckpoints({ cwd: workspace, sessionId: 's1' })
    const end = listed.find((point) => point.phase === 'end')
    assert.deepEqual(end?.intent, [{ tool: 'edit', path: 'a.txt', seq: 12 }])
    const start = listed.find((point) => point.phase !== 'end')
    assert.equal(start?.intent, undefined, '轮起检查点不携带 intent')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

// ── /shadow-rewind/trace 端点 ────────────────────────────────────────────

function makeHandlers(liveSessions, engine) {
  const handlers = new Map()
  const webServer = {
    register(route) {
      handlers.set(route.path, route.handler)
      return () => handlers.delete(route.path)
    },
  }
  // 复用 installShadowRewindHttp 的注册面（trace 路由与其余端点同源注册）。
  return import('../lib/rewind-host.js').then(({ installShadowRewindHttp }) => {
    installShadowRewindHttp({
      logger: { warn: () => {}, info: () => {}, error: () => {} },
      sessions: { get: (id) => liveSessions.get(id) },
      sessionQuery: {
        readSession: async (id) => {
          const live = liveSessions.get(id)
          return live === undefined
            ? { session: { id }, inheritedEventCount: 0, events: [] }
            : { session: { id: live.id, cwd: live.session.header.cwd }, inheritedEventCount: 0, events: live.events }
        },
      },
      sessionController: { create: async () => ({ sessionId: 'x' }), fork: async () => ({ sessionId: 'x' }) },
      agents: { list: () => [] },
      webServer,
    }, engine, new TurnCheckpointCoordinator(engine), { isEnabled: true, ownerOf: async () => undefined, setGate() {} })
    return handlers
  })
}

async function callTrace(handlers, query) {
  const handler = handlers.get('/shadow-rewind/trace')
  const status = { code: 0, body: '' }
  const response = {
    writeHead(code) { status.code = code },
    end(body) { status.body = body ?? '' },
    on() {},
  }
  await handler({
    method: 'GET',
    url: `/shadow-rewind/trace?${query}`,
    socket: { remoteAddress: '127.0.0.1' },
  }, response)
  return { code: status.code, body: JSON.parse(status.body) }
}

test('trace 端点：时间线面（节点 + 检查点摘要）与轨迹区间面', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-trace-ws-'))
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-trace-store-'))
  const engine = new ShadowRewindEngine({ storageDir, turnCheckpointMode: 'sqlite' })
  await engine.ready
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
    const events = [
      call(10, 'write', { file_path: join(workspace, 'a.ts'), content: 'one\n' }),
      result(11, 'c10'),
      call(12, 'edit', { file_path: join(workspace, 'a.ts'), old_string: 'one', new_string: 'ONE' }),
      result(13, 'c12'),
    ]
    const liveSessions = new Map([
      ['s1', {
        id: 's1',
        status: 'idle',
        session: {
          id: 's1',
          header: { cwd: workspace },
          inheritedEventCount: 0,
          snapshotEvents: () => events,
        },
        events,
      }],
    ])
    const handlers = await makeHandlers(liveSessions, engine)
    const query = `sessionId=${encodeURIComponent('s1')}`

    // 时间线面：节点 + 检查点。
    const timeline = await callTrace(handlers, query)
    assert.equal(timeline.code, 200)
    assert.equal(timeline.body.nodes.length, 2)
    assert.equal(timeline.body.checkpoints.length, 1)
    assert.equal(timeline.body.checkpoints[0].degraded, undefined, '内容可读的检查点无 degraded 标注')

    // 轨迹区间面：(11, 13] 内只有 edit(12)；write(10) 已入基线 → modified。
    const range = await callTrace(handlers, `${query}&from=trace:11&to=trace:13`)
    assert.equal(range.code, 200)
    assert.equal(range.body.mode, 'trace')
    const aTs = range.body.changes.find((change) => change.path.endsWith('a.ts'))
    assert.equal(aTs.kind, 'modified')
    assert.equal(aTs.added, 1)
    assert.equal(aTs.removed, 1)
    assert.ok(range.body.notes.some((note) => note.includes('终端命令')))

    // 混用寻址必须拒绝。
    const mixed = await callTrace(handlers, `${query}&from=trace:10&to=${encodeURIComponent('rp_x')}`)
    assert.notEqual(mixed.code, 200)

    // 快照对比面：两个检查点（造第二对）。
    await writeFile(join(workspace, 'b.txt'), 'b\n', 'utf8')
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 2, turnStartSeq: 20 })
    const checkpoints = await engine.listTurnCheckpoints({ cwd: workspace, sessionId: 's1' })
    const start1 = checkpoints.find((point) => point.turn === 1 && point.phase !== 'end')
    const start2 = checkpoints.find((point) => point.turn === 2 && point.phase !== 'end')
    const pair = await callTrace(handlers, `${query}&from=${encodeURIComponent(start1.id)}&to=${encodeURIComponent(start2.id)}`)
    assert.equal(pair.code, 200)
    assert.equal(pair.body.mode, 'checkpoint')
    const bChange = pair.body.changes.find((change) => change.path === 'b.txt')
    assert.equal(bChange.kind, 'added')
    assert.equal(bChange.added, 1)
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})
