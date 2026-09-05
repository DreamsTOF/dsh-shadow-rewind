/**
 * B1 恢复撤销 + A4 headless 命令面测试：
 * undoLastRestore 的 CAS 语义（撤销/部分跳过/全跳过 409/新建文件删除/无记录）、
 * restore-undo 端点、shadow-diff / shadow-undo 命令（真实引擎 + sqlite 后端，
 * 端点与命令直接驱动免网络）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'
import { TurnCheckpointCoordinator, installShadowRewindCommands, installShadowRewindHttp } from '../lib/rewind-host.js'

async function makeEngine() {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-store-'))
  const engine = new ShadowRewindEngine({ storageDir, turnCheckpointMode: 'sqlite' })
  await engine.ready
  return { engine, storageDir }
}

/** 造一个「恢复 + 撤销」场景：捕获基线 → mutate 制造改动 → 恢复到基线。 */
async function restoreToBaseline(engine, workspace, mutate) {
  const baseline = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
  await mutate()
  const current = await engine.inspect({ cwd: workspace, restorePointId: baseline.id })
  const plan = await engine.planRestore({
    cwd: workspace,
    restorePointId: baseline.id,
    sessionId: 's1',
    expectedCurrentTreeHash: current.currentTreeHash,
  })
  return engine.applyRestore({ planId: plan.id, confirmation: plan.confirmation, sessionId: 's1' })
}

test('undo：撤销恢复，文件回到恢复前状态', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    // 基线 = v1；改动 = v2；恢复 → v1；撤销 → v2。
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v1\n', '恢复已把 a.txt 打回基线')
    const undo = await engine.undoLastRestore({ cwd: workspace })
    assert.equal(undo.undonePaths.length, 1, '撤销成功的路径')
    assert.equal(undo.undonePaths[0], 'a.txt')
    assert.equal(undo.skippedPaths.length, 0)
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v2\n', '回到恢复前内容')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('undo：恢复新建的文件被撤销即删除（唯一删除例外）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    // 基线只有 a.txt；b.txt 是基线之后新建的 → 恢复删除它 → 撤销把它删回来。
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'b.txt'), 'new\n', 'utf8')
    })
    await assert.rejects(readFile(join(workspace, 'b.txt')), '恢复应已删除 b.txt')
    const undo = await engine.undoLastRestore({ cwd: workspace })
    assert.ok(undo.undonePaths.includes('b.txt'), '新建文件在撤销清单里')
    assert.equal(await readFile(join(workspace, 'b.txt'), 'utf8'), 'new\n', '撤销重新创建 b.txt')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('undo：被后续修改的路径跳过并如实报告', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
      await writeFile(join(workspace, 'b.txt'), 'new\n', 'utf8')
    })
    // 恢复后手动改 a.txt → 撤销跳过 a.txt、b.txt 正常撤销。
    await writeFile(join(workspace, 'a.txt'), 'manual\n', 'utf8')
    const undo = await engine.undoLastRestore({ cwd: workspace })
    assert.deepEqual(undo.undonePaths, ['b.txt'])
    assert.equal(undo.skippedPaths.length, 1)
    assert.equal(undo.skippedPaths[0].path, 'a.txt')
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'manual\n', '被改过的文件不动')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('undo：全部路径被修改 → UNDO_CONFLICT', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
      await writeFile(join(workspace, 'b.txt'), 'new\n', 'utf8')
    })
    await writeFile(join(workspace, 'a.txt'), 'manual\n', 'utf8')
    await writeFile(join(workspace, 'b.txt'), 'manual-b\n', 'utf8')
    await assert.rejects(engine.undoLastRestore({ cwd: workspace }), (error) => {
      assert.equal(error.code, 'UNDO_CONFLICT')
      return true
    })
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('undo：无记录 → UNDO_NOT_FOUND', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await assert.rejects(engine.undoLastRestore({ cwd: workspace }), (error) => {
      assert.equal(error.code, 'UNDO_NOT_FOUND')
      return true
    })
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

// ── A4 命令面 ────────────────────────────────────────────────────────────

function makeCommandHost() {
  const definitions = []
  return {
    definitions,
    commands: {
      register(definition) { definitions.push(definition); return () => {} },
    },
  }
}

function fakeAgent(cwd, events = []) {
  return {
    session: {
      id: 's1',
      header: { cwd },
      snapshotEvents: () => events,
    },
  }
}

test('命令：/shadow-diff 的用法错误、混用拒绝与轨迹区间输出', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-cmd-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    const host = makeCommandHost()
    installShadowRewindCommands(host, engine)
    assert.equal(host.definitions.length, 2, '注册 shadow-diff 与 shadow-undo')
    const diff = host.definitions.find((definition) => definition.name === 'shadow-diff')
    const undo = host.definitions.find((definition) => definition.name === 'shadow-undo')

    // 空参数 → 用法。
    const usage = await diff.handler({ agent: fakeAgent(workspace), rawInput: '' })
    assert.equal(usage.kind, 'error')
    assert.ok(usage.text.includes('用法'))

    // 混用 → 拒绝。
    const mixed = await diff.handler({ agent: fakeAgent(workspace), rawInput: `trace:1 ${'rp_1_000000000000'}` })
    assert.equal(mixed.kind, 'error')

    // 轨迹区间：事件流里 write + edit。
    const events = [
      { type: 'tool/call', seq: 10, data: { turn: 1, step: 1, callId: 'c10', name: 'write', arguments: JSON.stringify({ file_path: join(workspace, 'a.ts'), content: 'one\ntwo\n' }) } },
      { type: 'tool/result', seq: 11, data: { callId: 'c10', message: { content: [] } } },
      { type: 'tool/call', seq: 12, data: { turn: 1, step: 2, callId: 'c12', name: 'edit', arguments: JSON.stringify({ file_path: join(workspace, 'a.ts'), old_string: 'two', new_string: 'TWO' }) } },
      { type: 'tool/result', seq: 13, data: { callId: 'c12', message: { content: [] } } },
    ]
    const range = await diff.handler({ agent: fakeAgent(workspace, events), rawInput: 'trace:11 trace:13' })
    assert.equal(range.kind, 'success')
    assert.ok(range.text.includes('轨迹区间 #11 → #13'))
    assert.ok(range.text.includes('a.ts'))
    assert.ok(range.text.includes('+1 −1'))

    // shadow-undo 无记录 → 明确错误文案。
    const undoResult = await undo.handler({ agent: fakeAgent(workspace), rawInput: '' })
    assert.equal(undoResult.kind, 'error')
    assert.ok(undoResult.text.includes('没有可撤销'))
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('命令：/shadow-diff 单轮与 /shadow-undo 撤销输出', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-cmd-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
    await writeFile(join(workspace, 'a.txt'), 'v2\nmore\n', 'utf8')
    await writeFile(join(workspace, 'b.txt'), 'b\n', 'utf8')
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 2, turnStartSeq: 20 })

    const host = makeCommandHost()
    installShadowRewindCommands(host, engine)
    const diff = host.definitions.find((definition) => definition.name === 'shadow-diff')

    // 单轮模式：轮 1 → 轮 2（回退配对）。
    const turn1 = await diff.handler({ agent: fakeAgent(workspace), rawInput: '1' })
    assert.equal(turn1.kind, 'success', turn1.text)
    assert.ok(turn1.text.includes('a.txt'))
    assert.ok(turn1.text.includes('b.txt'))

    // 双轮号模式。
    const span = await diff.handler({ agent: fakeAgent(workspace), rawInput: '1 2' })
    assert.equal(span.kind, 'success', span.text)

    // shadow-undo：先造一次恢复再撤销（基线 v1 → 改 v2 → 恢复回 v1）。
    const baseline = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 10, turnStartSeq: 100 })
    await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    const current = await engine.inspect({ cwd: workspace, restorePointId: baseline.id })
    const plan = await engine.planRestore({
      cwd: workspace,
      restorePointId: baseline.id,
      sessionId: 's1',
      expectedCurrentTreeHash: current.currentTreeHash,
    })
    await engine.applyRestore({ planId: plan.id, confirmation: plan.confirmation, sessionId: 's1' })
    const undo = host.definitions.find((definition) => definition.name === 'shadow-undo')
    const undoResult = await undo.handler({ agent: fakeAgent(workspace), rawInput: '' })
    assert.equal(undoResult.kind, 'success', undoResult.text)
    assert.ok(undoResult.text.includes('a.txt'))
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

// ── restore-undo 端点 ────────────────────────────────────────────────────

function makeHandlers(liveSessions, engine) {
  const handlers = new Map()
  const webServer = {
    register(route) {
      handlers.set(route.path, route.handler)
      return () => handlers.delete(route.path)
    },
  }
  installShadowRewindHttp({
    logger: { warn: () => {}, info: () => {}, error: () => {} },
    sessions: { get: (id) => liveSessions.get(id) },
    sessionQuery: {
      readSession: async (id) => {
        const live = liveSessions.get(id)
        return live === undefined
          ? { session: { id }, inheritedEventCount: 0, events: [] }
          : { session: { id: live.id, cwd: live.session.header.cwd }, inheritedEventCount: 0, events: [] }
      },
    },
    sessionController: { create: async () => ({ sessionId: 'x' }), fork: async () => ({ sessionId: 'x' }) },
    agents: { list: () => [] },
    webServer,
  }, engine, new TurnCheckpointCoordinator(engine), { isEnabled: true, ownerOf: async () => undefined, setGate() {} })
  return handlers
}

async function callUndo(handlers, body) {
  const handler = handlers.get('/shadow-rewind/restore-undo')
  const status = { code: 0, body: '' }
  const response = {
    writeHead(code) { status.code = code },
    end(bodyText) { status.body = bodyText ?? '' },
    on() {},
  }
  const chunks = [Buffer.from(JSON.stringify(body), 'utf8')]
  const request = {
    method: 'POST',
    url: '/shadow-rewind/restore-undo',
    socket: { remoteAddress: '127.0.0.1' },
    on(event, listener) {
      if (event === 'data') queueMicrotask(() => listener(chunks[0]))
      if (event === 'end') queueMicrotask(() => listener())
    },
  }
  await handler(request, response)
  return { code: status.code, body: JSON.parse(status.body) }
}

test('restore-undo 端点：200 撤销与无记录 409', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    // 基线 v1 → 改 v2 → 恢复回 v1 → 撤销应回到 v2。
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    })
    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, inheritedEventCount: 0, snapshotEvents: () => [] } }],
    ])
    const handlers = makeHandlers(liveSessions, engine)
    const ok = await callUndo(handlers, { sessionId: 's1' })
    assert.equal(ok.code, 200)
    assert.deepEqual(ok.body.undonePaths, ['a.txt'])
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v2\n')
    // 再撤销一次：记录已消费 → 409。
    const again = await callUndo(handlers, { sessionId: 's1' })
    assert.equal(again.code, 409)
    assert.equal(again.body.code, 'UNDO_NOT_FOUND')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})
