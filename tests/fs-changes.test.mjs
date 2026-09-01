/**
 * fs-changes 端点测试：服务端行数统计、live-tail 跨会话归属过滤、工作区
 * 数据版本（rev）。真实临时目录 + 真实引擎 + 模拟 webServer（install 注册的
 * handler 直接驱动，不起网络）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'
import { installShadowRewindHttp, TurnCheckpointCoordinator } from '../lib/rewind-host.js'
import { WorkspaceWriteGate } from '../lib/write-gate.js'
import { CommandWindowRegistry } from '../lib/command-windows.js'
import { canonicalDirectory } from '../lib/path-utils.js'

/** 直接驱 installShadowRewindHttp 注册的 handler（免网络）。 */
function makeHandlers(liveSessions, engine, coordinator, writeGate, commandWindows) {
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
  }, engine, coordinator, writeGate, commandWindows)
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

// ── 写盘归因（闸关多会话并发）──────────────────────────────────────────

/** 关闸 + 可选命令窗口注册表的装配。 */
function closedGateHandlers(liveSessions, engine, registry) {
  const coordinator = new TurnCheckpointCoordinator(engine)
  const writeGate = new WorkspaceWriteGate(
    { canonicalDirectory, agents: { list: () => [] } },
    { enabled: false },
  )
  return makeHandlers(liveSessions, engine, coordinator, writeGate, registry)
}

test('fs-changes 闸关：归因三态（唯一命令/重叠歧义/外部）与 writtenAt', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsattr3-'))
  const { engine, storageDir } = await makeEngine()
  const registry = new CommandWindowRegistry({
    canonicalDirectory: (path) => canonicalDirectory(path).catch(() => undefined),
  })
  // 各写入阶段间拉开时间，保证每条窗口只覆盖自己阶段内的 mtime（宁模糊不错的反面测试需要精确边界）。
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20))
  try {
    await writeFile(join(workspace, 'base.txt'), 'v0\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 1, 10)

    // cmd.txt：恰 1 条 bash 窗口覆盖 mtime → command。
    let startedAt = Date.now() - 5
    await writeFile(join(workspace, 'cmd.txt'), 'A\n', 'utf8')
    let endedAt = Date.now() + 5
    await registry.record(workspace, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt, endedAt })
    await pause()

    // amb.txt：两条重叠窗口都覆盖 mtime → ambiguous（宁模糊不错）。
    // 采样带 ±5ms 安全边距（相位间隔 20ms），不会误覆盖相邻阶段的 mtime。
    startedAt = Date.now() - 5
    await writeFile(join(workspace, 'amb.txt'), 'B\n', 'utf8')
    endedAt = Date.now() + 5
    await registry.record(workspace, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt, endedAt })
    await registry.record(workspace, { sessionId: 's1', agentId: 's1', tool: 'run_code', startedAt, endedAt })
    await pause()

    // ext.txt：无命令窗口 → external（窗口归属回本会话）。
    await writeFile(join(workspace, 'ext.txt'), 'C\n', 'utf8')

    await captureTurn(engine, workspace, 's1', 2, 20)

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
    ])
    const handlers = closedGateHandlers(liveSessions, engine, registry)
    const body = await callFsChanges(handlers, 's1')
    const turn1 = body.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(turn1, '轮 1 必须有配对条目')
    const byPath = Object.fromEntries(turn1.changes.map((change) => [change.path, change]))

    const cmd = byPath['cmd.txt']
    assert.deepEqual(
      { owner: cmd.owner, autoSelect: cmd.autoSelect, attribution: cmd.attribution },
      { owner: 'target', autoSelect: true, attribution: 'command' },
    )
    assert.equal(cmd.command?.tool, 'bash')
    assert.equal(cmd.command?.sessionId, 's1')
    assert.equal(typeof cmd.writtenAt, 'number')

    const amb = byPath['amb.txt']
    assert.equal(amb.attribution, 'ambiguous', '重叠窗口不得给出命令级置信')
    assert.equal(amb.command, undefined)
    assert.equal(amb.owner, 'target')

    const ext = byPath['ext.txt']
    assert.equal(ext.attribution, 'external', '无窗口命中 + 本会话窗口 = 外部写入')
    assert.equal(ext.owner, 'target')
    assert.equal(ext.autoSelect, true)

    // writtenAt = 快照落盘的 mtimeNs，与磁盘 mtime 同源（文件此后未再变）。
    const { lstat } = await import('node:fs/promises')
    const disk = await lstat(join(workspace, 'cmd.txt'), { bigint: true })
    assert.ok(
      Math.abs(cmd.writtenAt - Number(disk.mtimeNs / 1000000n)) < 1000,
      `writtenAt 必须贴近磁盘 mtime（${String(cmd.writtenAt)} vs ${String(disk.mtimeNs)}）`,
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs-changes 闸关：保留其它会话窗口的写入并附归属（不再丢弃）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsattr4-'))
  const { engine, storageDir } = await makeEngine()
  const pause = () => new Promise((resolve) => setTimeout(resolve, 5))
  try {
    await writeFile(join(workspace, 'base.txt'), 'v0\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 1, 10)
    await pause()
    await writeFile(join(workspace, 's1-wrote.txt'), 'A\n', 'utf8')
    await captureTurn(engine, workspace, 's2', 1, 11)
    await pause()
    await writeFile(join(workspace, 's2-wrote.txt'), 'B\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 2, 20)

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
      ['s2', { id: 's2', status: 'idle', session: { id: 's2', header: { cwd: workspace }, events: [] } }],
    ])
    const handlers = closedGateHandlers(liveSessions, engine, undefined)
    const body = await callFsChanges(handlers, 's1')
    const turn1 = body.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(turn1, 's1 轮 1 必须有配对条目')
    const byPath = Object.fromEntries(turn1.changes.map((change) => [change.path, change]))

    // 本会话写入：归属本会话、默认勾选。
    assert.deepEqual(
      { owner: byPath['s1-wrote.txt'].owner, autoSelect: byPath['s1-wrote.txt'].autoSelect },
      { owner: 'target', autoSelect: true },
    )
    // 其它会话写入：闸关不再丢弃——附会话归属、不默认勾选。
    const s2file = byPath['s2-wrote.txt']
    assert.ok(s2file, '闸关必须保留其它会话窗口的路径')
    assert.equal(s2file.owner, 's2')
    assert.equal(s2file.autoSelect, false)
    assert.equal(s2file.attribution, 'window', '无命令窗口注册表 → 窗口级归属')
    assert.equal(typeof s2file.writtenAt, 'number', 'mtime 落盘的写入时间仍透出')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs-changes 闸关：旧清单无 mtimeNs 降级（无 writtenAt、归因落回窗口层）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsattr5-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'base.txt'), 'v0\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 1, 10)
    await writeFile(join(workspace, 'legacy.txt'), 'L\n', 'utf8')
    const turn2 = await captureTurn(engine, workspace, 's1', 2, 20)

    // 模拟旧清单：剥掉配对终点清单里的 mtimeNs（树哈希内容寻址，校验仍通过）。
    const key = createHash('sha256').update(await realpath(workspace), 'utf8').digest('hex').slice(0, 16)
    const manifestPath = join(storageDir, 'workspaces', key, 'manifests', `${turn2.id}.json`)
    const raw = JSON.parse(await readFile(manifestPath, 'utf8'))
    for (const entry of Object.values(raw.entries)) delete entry.mtimeNs
    await writeFile(manifestPath, JSON.stringify(raw), 'utf8')

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
    ])
    const handlers = closedGateHandlers(liveSessions, engine, undefined)
    const body = await callFsChanges(handlers, 's1')
    const turn1 = body.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(turn1, '旧清单配对必须照常返回')
    const legacy = turn1.changes.find((change) => change.path === 'legacy.txt')
    assert.ok(legacy, '变更必须保留')
    assert.equal(legacy.writtenAt, undefined, '无 mtimeNs 不得伪造写入时间')
    assert.equal(legacy.attribution, 'external', '无 mtime 落回窗口归属（本会话窗口）')
    assert.equal(legacy.owner, 'target')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs-changes 闸关：包围轮内的他会话写入降级 multi（不默认归属本会话）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-enclosed-'))
  const { engine, storageDir } = await makeEngine()
  const registry = new CommandWindowRegistry({
    canonicalDirectory: (path) => canonicalDirectory(path).catch(() => undefined),
  })
  // 各写入阶段间拉开时间，保证每条命令窗口只覆盖自己阶段内的 mtime。
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20))
  try {
    await writeFile(join(workspace, 'base.txt'), 'v0\n', 'utf8')
    // s2 先开轮且此后不再捕获：它的轮完全包住随后 s1 的轮 1——
    // s1 的窗口 (轮起, 下一轮起] 内没有 s2 的检查点，快照网格看不见 s2。
    await captureTurn(engine, workspace, 's2', 1, 5)
    await pause()
    await captureTurn(engine, workspace, 's1', 1, 10)
    await pause()
    // 对照组：s1 自己窗口内的写入 + 自己的命令窗口 → 命令级归属不受降级影响。
    let startedAt = Date.now() - 5
    await writeFile(join(workspace, 's1-wrote.txt'), 'A\n', 'utf8')
    let endedAt = Date.now() + 5
    await registry.record(workspace, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt, endedAt })
    await pause()
    // 包围轮写入：s2 在 s1 窗口内写盘，命令窗口归 s2。网格会误判为本会话，
    // 终值证据（mtime ∈ s2 命令窗口）必须把它降级为 multi、交出勾选权。
    startedAt = Date.now() - 5
    await writeFile(join(workspace, 'enclosed.txt'), 'B\n', 'utf8')
    endedAt = Date.now() + 5
    await registry.record(workspace, { sessionId: 's2', agentId: 's2', tool: 'bash', startedAt, endedAt })
    await pause()
    await captureTurn(engine, workspace, 's1', 2, 20)

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
      ['s2', { id: 's2', status: 'idle', session: { id: 's2', header: { cwd: workspace }, events: [] } }],
    ])
    const handlers = closedGateHandlers(liveSessions, engine, registry)
    const body = await callFsChanges(handlers, 's1')
    const turn1 = body.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(turn1, 's1 轮 1 必须有配对条目')
    const byPath = Object.fromEntries(turn1.changes.map((change) => [change.path, change]))

    assert.deepEqual(
      { owner: byPath['s1-wrote.txt'].owner, autoSelect: byPath['s1-wrote.txt'].autoSelect, attribution: byPath['s1-wrote.txt'].attribution },
      { owner: 'target', autoSelect: true, attribution: 'command' },
      '本会话自己的命令窗口写入不得被降级误伤',
    )
    assert.deepEqual(
      { owner: byPath['enclosed.txt'].owner, autoSelect: byPath['enclosed.txt'].autoSelect, attribution: byPath['enclosed.txt'].attribution },
      { owner: 'multi', autoSelect: false, attribution: 'ambiguous' },
      '包围轮内的他会话写入必须降级（绝不以本会话名义默认勾选）',
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs-changes 闸开：包围轮内的他会话写入同样被剔除', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-enclosed-open-'))
  const { engine, storageDir } = await makeEngine()
  const registry = new CommandWindowRegistry({
    canonicalDirectory: (path) => canonicalDirectory(path).catch(() => undefined),
  })
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20))
  try {
    await writeFile(join(workspace, 'base.txt'), 'v0\n', 'utf8')
    await captureTurn(engine, workspace, 's2', 1, 5)
    await pause()
    await captureTurn(engine, workspace, 's1', 1, 10)
    await pause()
    let startedAt = Date.now() - 5
    await writeFile(join(workspace, 's1-wrote.txt'), 'A\n', 'utf8')
    let endedAt = Date.now() + 5
    await registry.record(workspace, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt, endedAt })
    await pause()
    startedAt = Date.now() - 5
    await writeFile(join(workspace, 'enclosed.txt'), 'B\n', 'utf8')
    endedAt = Date.now() + 5
    await registry.record(workspace, { sessionId: 's2', agentId: 's2', tool: 'bash', startedAt, endedAt })
    await pause()
    await captureTurn(engine, workspace, 's1', 2, 20)

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
      ['s2', { id: 's2', status: 'idle', session: { id: 's2', header: { cwd: workspace }, events: [] } }],
    ])
    const coordinator = new TurnCheckpointCoordinator(engine)
    const writeGate = new WorkspaceWriteGate({ canonicalDirectory, agents: { list: () => [] } })
    const handlers = makeHandlers(liveSessions, engine, coordinator, writeGate, registry)
    const body = await callFsChanges(handlers, 's1')
    const turn1 = body.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(turn1, 's1 轮 1 必须有配对条目')
    const paths = turn1.changes.map((change) => change.path)
    assert.ok(paths.includes('s1-wrote.txt'), '本会话写入必须保留')
    assert.ok(!paths.includes('enclosed.txt'), '包围轮内的他会话写入必须被剔除（网格看不见它，靠终值证据降级）')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs-changes 重启等价：包围轮降级证据随注册表重启存活', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-restart-'))
  const { engine, storageDir } = await makeEngine()
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20))
  try {
    // 与包围轮例同形状：s2 先开轮，完全包住随后 s1 的轮 1。
    await writeFile(join(workspace, 'base.txt'), 'v0\n', 'utf8')
    await captureTurn(engine, workspace, 's2', 1, 5)
    await pause()
    await captureTurn(engine, workspace, 's1', 1, 10)
    await pause()
    const registry1 = new CommandWindowRegistry({
      canonicalDirectory: (path) => canonicalDirectory(path).catch(() => undefined),
      storageDir,
    })
    let startedAt = Date.now() - 5
    await writeFile(join(workspace, 's1-wrote.txt'), 'A\n', 'utf8')
    let endedAt = Date.now() + 5
    await registry1.record(workspace, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt, endedAt })
    await pause()
    startedAt = Date.now() - 5
    await writeFile(join(workspace, 'enclosed.txt'), 'B\n', 'utf8')
    endedAt = Date.now() + 5
    await registry1.record(workspace, { sessionId: 's2', agentId: 's2', tool: 'bash', startedAt, endedAt })
    await pause()
    await captureTurn(engine, workspace, 's1', 2, 20)

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
      ['s2', { id: 's2', status: 'idle', session: { id: 's2', header: { cwd: workspace }, events: [] } }],
    ])

    // 重启前第一遍归因。
    const before = await callFsChanges(closedGateHandlers(liveSessions, engine, registry1), 's1')

    // 模拟宿主重启：冲刷落盘，新注册表实例从磁盘加载（同一存储目录）。
    await registry1.flushPending()
    const registry2 = new CommandWindowRegistry({
      canonicalDirectory: (path) => canonicalDirectory(path).catch(() => undefined),
      storageDir,
    })
    const after = await callFsChanges(closedGateHandlers(liveSessions, engine, registry2), 's1')

    // 重启等价：归因结果逐字段一致（窗口不再因重启丢失）。
    assert.deepEqual(after.turns, before.turns, '重启前后归因必须逐字段一致')
    const turn1 = after.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(turn1, 's1 轮 1 必须有配对条目')
    const enclosed = turn1.changes.find((change) => change.path === 'enclosed.txt')
    assert.deepEqual(
      { owner: enclosed.owner, autoSelect: enclosed.autoSelect, attribution: enclosed.attribution },
      { owner: 'multi', autoSelect: false, attribution: 'ambiguous' },
      '包围轮降级证据在重启后不得丢失',
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs-changes 闸关：窗口内容（detail）随命令级归因透出', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsdetail-'))
  const { engine, storageDir } = await makeEngine()
  const registry = new CommandWindowRegistry({
    canonicalDirectory: (path) => canonicalDirectory(path).catch(() => undefined),
  })
  const pause = () => new Promise((resolve) => setTimeout(resolve, 20))
  try {
    await writeFile(join(workspace, 'base.txt'), 'v0\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 1, 10)
    await pause()
    // 窗口带内容：终端命令文本（录制器经 captureDetail 采集的形态）。
    const startedAt = Date.now() - 5
    await writeFile(join(workspace, 'cmd.txt'), 'A\n', 'utf8')
    const endedAt = Date.now() + 5
    await registry.record(workspace, {
      sessionId: 's1', agentId: 's1', tool: 'bash',
      detail: '{"command":"echo A"}', startedAt, endedAt,
    })
    await pause()
    await captureTurn(engine, workspace, 's1', 2, 20)

    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, events: [] } }],
    ])
    const handlers = closedGateHandlers(liveSessions, engine, registry)
    const body = await callFsChanges(handlers, 's1')
    const turn1 = body.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(turn1, '轮 1 必须有配对条目')
    const cmd = turn1.changes.find((change) => change.path === 'cmd.txt')
    assert.equal(cmd.attribution, 'command')
    assert.equal(cmd.command?.detail, '{"command":"echo A"}', '窗口内容必须随归因透出到端点')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})
