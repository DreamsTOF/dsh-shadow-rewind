/**
 * fs-changes 端点测试：服务端行数统计、live-tail 跨会话归属过滤、工作区
 * 数据版本（rev）。真实临时目录 + 真实引擎 + 模拟 webServer（install 注册的
 * handler 直接驱动，不起网络）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'
import { installShadowRewindHttp, TurnCheckpointCoordinator } from '../lib/rewind-host.js'
import { WorkspaceWriteGate } from '../lib/write-gate.js'
import { canonicalDirectory } from '../lib/path-utils.js'

/** 直接驱 installShadowRewindHttp 注册的 handler（免网络）。 */
function makeHandlers(liveSessions, engine, coordinator, writeGate) {
  const handlers = new Map()
  const webServer = {
    register(route) {
      handlers.set(route.path, route.handler)
      return () => handlers.delete(route.path)
    },
  }
  installShadowRewindHttp({
    logger: { warn: () => {} },
    sessions: { get: (id) => liveSessions.get(id) },
    sessionQuery: {
      readSession: async (id) => {
        const live = liveSessions.get(id)
        return live === undefined
          ? { session: { id }, events: [] }
          : { session: { id: live.id, cwd: live.session.header.cwd }, events: [] }
      },
    },
    apiProxy: {
      sessions: {
        create: async () => ({ result: { ok: true, value: { sessionId: 'x' } } }),
        fork: async () => ({ result: { ok: true, value: { sessionId: 'x' } } }),
      },
    },
    agents: { list: () => [] },
    webServer,
  }, engine, coordinator, writeGate)
  return handlers
}

async function callFsChanges(handlers, sessionId) {
  const handler = handlers.get('/shadow-rewind/fs-changes')
  const status = { code: 0, body: '' }
  const response = {
    writeHead(code) { status.code = code },
    end(body) { status.body = body ?? '' },
    on() {},
  }
  await handler({
    method: 'GET',
    url: `/shadow-rewind/fs-changes?sessionId=${encodeURIComponent(sessionId)}`,
    socket: { remoteAddress: '127.0.0.1' },
  }, response)
  assert.equal(status.code, 200, `fs-changes 响应必须是 200（收到 ${status.code}）`)
  return JSON.parse(status.body)
}

async function makeEngine() {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-fs-store-'))
  const engine = new ShadowRewindEngine({ storageDir, turnCheckpointMode: 'legacy' })
  await engine.ready
  return { engine, storageDir }
}

async function captureTurn(engine, workspace, sessionId, turn, turnStartSeq) {
  return engine.createTurnCheckpoint({ cwd: workspace, sessionId, turn, turnStartSeq })
}

test('fs-changes：轮次配对的 added/removed 行数与 rev', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fs-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'hello v1\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 1, 10)
    // 模拟终端写盘：改一个、建一个。
    await writeFile(join(workspace, 'a.txt'), 'hello v2\nmore\n', 'utf8')
    await writeFile(join(workspace, 'new.txt'), 'x\ny\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 2, 20)

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
    ])
    const coordinator = new TurnCheckpointCoordinator(engine)
    const writeGate = new WorkspaceWriteGate({ canonicalDirectory, agents: { list: () => [] } })
    const handlers = makeHandlers(liveSessions, engine, coordinator, writeGate)

    const body = await callFsChanges(handlers, 's1')
    assert.equal(typeof body.rev, 'number', '响应必须带 rev')
    assert.equal(body.turns.length, 1, '只有轮 1 有配对（轮 2 无下一检查点且磁盘无变化）')
    const [turn1] = body.turns
    assert.equal(turn1.turn, 1)
    const byPath = Object.fromEntries(turn1.changes.map((change) => [change.path, change]))
    const aChange = byPath['a.txt']
    assert.equal(aChange.kind, 'modified')
    assert.equal(aChange.added, 2)
    assert.equal(aChange.removed, 1)
    // 权限位随条目透传（具体值依赖平台，只断言形态）。
    assert.equal(typeof aChange.oldMode, 'number')
    assert.equal(aChange.oldMode, aChange.newMode, '未 chmod 时两侧 mode 相同')
    const newChange = byPath['new.txt']
    assert.equal(newChange.kind, 'added')
    assert.equal(newChange.added, 2)
    assert.equal(newChange.removed, 0)
    assert.equal(newChange.oldMode, undefined, '新增文件没有旧侧 mode')
    assert.equal(typeof newChange.newMode, 'number')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs-changes：轮次配对归属过滤——剔除落在其它会话窗口的写入', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsattr-'))
  const { engine, storageDir } = await makeEngine()
  const pause = () => new Promise((resolve) => setTimeout(resolve, 5))
  try {
    await writeFile(join(workspace, 'base.txt'), 'v0\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 1, 10)
    await pause()
    // s1 轮 1 窗口内的写入。
    await writeFile(join(workspace, 's1-wrote.txt'), 'A\n', 'utf8')
    // s2 开轮：检查点把窗口切开；随后 s2 写自己的文件（属于 s2 的窗口）。
    await captureTurn(engine, workspace, 's2', 1, 11)
    await pause()
    await writeFile(join(workspace, 's2-wrote.txt'), 'B\n', 'utf8')
    // s1 下一轮轮起 = 轮 1 的归属终点。
    await captureTurn(engine, workspace, 's1', 2, 20)

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
      ['s2', { id: 's2', status: 'idle', session: { id: 's2', header: { cwd: workspace }, events: [] } }],
    ])
    const coordinator = new TurnCheckpointCoordinator(engine)
    const writeGate = new WorkspaceWriteGate({ canonicalDirectory, agents: { list: () => [] } })
    const handlers = makeHandlers(liveSessions, engine, coordinator, writeGate)

    const body = await callFsChanges(handlers, 's1')
    const turn1 = body.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(turn1, 's1 轮 1 必须有配对条目')
    const paths = turn1.changes.map((change) => change.path)
    assert.ok(paths.includes('s1-wrote.txt'), '本会话窗口内的写入必须保留')
    assert.ok(!paths.includes('s2-wrote.txt'), '属于 s2 窗口的写入必须被剔除')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs-changes：live-tail 行数 + 剔除其它会话写入的路径', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fs-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'base.txt'), 'v0\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 1, 10)
    // s1 的终端写盘（属于 s1 的 live-tail）。
    await writeFile(join(workspace, 's1-made.txt'), 'X\n', 'utf8')
    // s2 开轮（检查点捕获 s1 的写入作为基线），随后 s2 写了自己的文件。
    await captureTurn(engine, workspace, 's2', 1, 11)
    await writeFile(join(workspace, 's2-made.txt'), 'Y\n', 'utf8')

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
      ['s2', { id: 's2', status: 'idle', session: { id: 's2', header: { cwd: workspace }, events: [] } }],
    ])
    const coordinator = new TurnCheckpointCoordinator(engine)
    const writeGate = new WorkspaceWriteGate({ canonicalDirectory, agents: { list: () => [] } })
    const handlers = makeHandlers(liveSessions, engine, coordinator, writeGate)

    // s1 的 live-tail：只含 s1 自己写的文件（s2-made.txt 被归属过滤剔除）。
    const s1 = await callFsChanges(handlers, 's1')
    const live1 = s1.turns.find((turn) => turn.live === true)
    assert.ok(live1, 's1 必须有 live-tail 条目')
    const paths1 = live1.changes.map((change) => change.path)
    assert.ok(paths1.includes('s1-made.txt'), 's1 自己的写入必须在 live-tail 里')
    assert.ok(!paths1.includes('s2-made.txt'), '其它会话写入的路径必须被剔除')
    const s1made = live1.changes.find((change) => change.path === 's1-made.txt')
    assert.deepEqual(
      { kind: s1made.kind, added: s1made.added, removed: s1made.removed },
      { kind: 'added', added: 1, removed: 0 },
    )

    // s2 的 live-tail：s2 自己的文件照常返回（s1 的写入落在 s2 检查点基线之前）。
    const s2 = await callFsChanges(handlers, 's2')
    const live2 = s2.turns.find((turn) => turn.live === true)
    assert.ok(live2, 's2 必须有 live-tail 条目')
    const paths2 = live2.changes.map((change) => change.path)
    assert.ok(paths2.includes('s2-made.txt'))
    assert.ok(!paths2.includes('s1-made.txt'), 's1 更早的写入不属于 s2 的 live-tail')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs-changes：检查点捕获后 rev 递增，无变化时不递增', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fs-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 1, 10)

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
    ])
    const coordinator = new TurnCheckpointCoordinator(engine)
    const writeGate = new WorkspaceWriteGate({ canonicalDirectory, agents: { list: () => [] } })
    const handlers = makeHandlers(liveSessions, engine, coordinator, writeGate)

    const before = (await callFsChanges(handlers, 's1')).rev
    const unchanged = (await callFsChanges(handlers, 's1')).rev
    assert.equal(unchanged, before, '无检查点/恢复时 rev 不变')

    // 经协调器捕获新检查点（模拟回合开始）：rev 必须递增。
    const agent = {
      id: 's1',
      status: 'idle',
      session: {
        id: 's1',
        header: { cwd: workspace },
        events: [{ type: 'turn/start', seq: 20, data: { turn: 2 } }],
      },
    }
    await coordinator.capture(
      { logger: { info() {}, warn() {}, error() {} } },
      agent,
      2,
      new AbortController().signal,
    )
    const after = (await callFsChanges(handlers, 's1')).rev
    assert.ok(after > before, `捕获后 rev 必须递增（${String(before)} → ${String(after)}）`)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})
