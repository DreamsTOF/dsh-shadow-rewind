/**
 * B1 恢复撤销测试：
 * undoLastRestore 的 CAS 语义（撤销/部分跳过/全跳过 409/新建文件删除/无记录）、
 * restore-undo 端点（真实引擎 + sqlite 后端，直接驱动免网络）。
 * 命令面（/shadow-diff、/shadow-inplace）已整体移除——就地回退改走
 * /shadow-rewind/inplace 端点（见 inplace-command.test.mjs）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'
import { TurnCheckpointCoordinator, installShadowRewindHttp } from '../lib/rewind-host.js'

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
  return engine.applyRestore({ planId: plan.id, sessionId: 's1' })
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

// ── EXPECTED-DESIGN 1.2：两段式撤销（probe / force / paths 子集） ──────────

test('undo probe：只读比对 CAS，冲突清单如实返回、磁盘不动', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
      await writeFile(join(workspace, 'b.txt'), 'new\n', 'utf8')
    })
    await writeFile(join(workspace, 'a.txt'), 'manual\n', 'utf8')
    const probe = await engine.undoLastRestore({ cwd: workspace, mode: 'probe' })
    assert.deepEqual([...probe.clean].sort(), ['b.txt'], '未被动过的路径在 clean 侧')
    assert.deepEqual([...probe.conflicted.map(entry => entry.path)], ['a.txt'], '被改过的路径在 conflicted 侧')
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'manual\n', 'probe 绝不动磁盘')
    await assert.rejects(readFile(join(workspace, 'b.txt')), 'probe 绝不动磁盘（恢复后的删除态保持）')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('undo force：全部回滚覆盖后续修改；恢复新建文件的强制撤销 = 删除', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
      await writeFile(join(workspace, 'b.txt'), 'new\n', 'utf8')
    })
    // 恢复后：a 被手动改、b（恢复时删掉的）被手动重建。
    await writeFile(join(workspace, 'a.txt'), 'manual\n', 'utf8')
    await writeFile(join(workspace, 'b.txt'), 'recreated\n', 'utf8')
    const undo = await engine.undoLastRestore({ cwd: workspace, force: true })
    assert.equal(undo.skippedPaths.length, 0, 'force 下没有跳过')
    assert.equal(undo.undonePaths.length, 2)
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v2\n', 'a 被强制回滚（覆盖 manual）')
    assert.equal(await readFile(join(workspace, 'b.txt'), 'utf8'), 'new\n', 'b 被强制回写恢复前内容')
    // 记录全部撤销完 → 销毁。
    await assert.rejects(engine.undoLastRestore({ cwd: workspace, mode: 'probe' }), (error) => {
      assert.equal(error.code, 'UNDO_NOT_FOUND')
      return true
    })
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('undo paths：子集撤销收缩记录，二次回滚后销毁', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
      await writeFile(join(workspace, 'b.txt'), 'new\n', 'utf8')
    })
    await writeFile(join(workspace, 'a.txt'), 'manual\n', 'utf8')
    // 第一段：只回滚正常部分（缺省 apply 跳过冲突）。
    const first = await engine.undoLastRestore({ cwd: workspace })
    assert.deepEqual(first.undonePaths, ['b.txt'])
    assert.equal(first.skippedPaths[0].path, 'a.txt')
    // 第二段：对剩余文件做确认的二次回滚（force + paths）。
    const second = await engine.undoLastRestore({ cwd: workspace, force: true, paths: ['a.txt'] })
    assert.deepEqual(second.undonePaths, ['a.txt'])
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v2\n', '二次回滚覆盖手动修改')
    await assert.rejects(engine.undoLastRestore({ cwd: workspace, mode: 'probe' }), (error) => {
      assert.equal(error.code, 'UNDO_NOT_FOUND', '记录收缩清空后销毁')
      return true
    })
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('undo paths：未知路径拒绝（防拼出半个撤销）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    })
    await assert.rejects(
      () => engine.undoLastRestore({ cwd: workspace, paths: ['nope.txt'] }),
      (error) => error.code === 'INVALID_ARGUMENTS',
    )
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('applyRestore：其它会话执行同工作区恢复照常生效（归属不影响执行）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-undo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    const baseline = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
    await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    const plan = await engine.planRestore({ cwd: workspace, restorePointId: baseline.id, sessionId: 's1' })
    // 其它会话执行：不拒绝（归属只是信息徽标）。
    const result = await engine.applyRestore({ planId: plan.id, sessionId: 'other' })
    assert.deepEqual([...result.restoredPaths], ['a.txt'])
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v1\n', '恢复照常生效')
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
  }, engine, new TurnCheckpointCoordinator(engine))
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

// ── G1：子集计划铸造——fetchSubsetPlan 的服务端通路（paths + 不带 details）──

/** 驱动 GET /shadow-rewind（恢复预览/计划铸造）。 */
async function callPreview(handlers, query) {
  const handler = handlers.get('/shadow-rewind')
  const status = { code: 0, body: '' }
  const response = {
    writeHead(code) { status.code = code },
    end(body) { status.body = body ?? '' },
    on() {},
  }
  await handler({
    method: 'GET',
    url: `/shadow-rewind?${query}`,
    socket: { remoteAddress: '127.0.0.1' },
  }, response)
  return { code: status.code, body: JSON.parse(status.body) }
}

/** 驱动 POST /shadow-rewind（恢复执行）。 */
async function callPost(handlers, body) {
  const handler = handlers.get('/shadow-rewind')
  const status = { code: 0, body: '' }
  const response = {
    writeHead(code) { status.code = code },
    end(bodyText) { status.body = bodyText ?? '' },
    on() {},
  }
  await handler({
    method: 'POST',
    url: '/shadow-rewind',
    socket: { remoteAddress: '127.0.0.1' },
    on(event, listener) {
      if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') listener()
    },
  }, response)
  return { code: status.code, body: JSON.parse(status.body) }
}

function sessionWithTurns(workspace, turns) {
  return {
    id: 's1', status: 'idle',
    session: {
      id: 's1', header: { cwd: workspace }, inheritedEventCount: 0,
      snapshotEvents: () => turns.map((turn) => ({ type: 'turn/start', seq: turn * 10, data: { turn } })),
    },
  }
}

test('G1：预览铸出整树计划（含逐文件净行数），执行后全部路径回基线', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-preview-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await writeFile(join(workspace, 'b.txt'), 'v1\n', 'utf8')
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
    await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    await writeFile(join(workspace, 'b.txt'), 'v2\n', 'utf8')
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 2, turnStartSeq: 20 })

    const liveSessions = new Map([['s1', sessionWithTurns(workspace, [1, 2])]])
    const handlers = makeHandlers(liveSessions, engine)

    const preview = await callPreview(handlers, 'sessionId=s1&turn=1')
    assert.equal(preview.code, 200)
    assert.equal(typeof preview.body.planId, 'string', '预览必须铸出整树计划')
    assert.equal('confirmation' in preview.body, false, '确认串已废除')
    assert.deepEqual(
      preview.body.changes.map((change) => [change.path, change.added, change.removed]).sort(),
      [['a.txt', 1, 1], ['b.txt', 1, 1]],
      '预览逐文件带服务端净行数',
    )

    const applied = await engine.applyRestore({ planId: preview.body.planId, sessionId: 's1' })
    assert.deepEqual([...applied.restoredPaths].sort(), ['a.txt', 'b.txt'], '整树恢复覆盖全部变更路径')
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v1\n')
    assert.equal(await readFile(join(workspace, 'b.txt'), 'utf8'), 'v1\n')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('G2：计划与请求 checkpointId 错配必须拒绝（不静默恢复错误时点）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-mismatch-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    const turn1 = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
    await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    const turn2 = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 2, turnStartSeq: 20 })
    await writeFile(join(workspace, 'a.txt'), 'v3\n', 'utf8')

    const liveSessions = new Map([['s1', sessionWithTurns(workspace, [1, 2])]])
    const handlers = makeHandlers(liveSessions, engine)

    // 用轮 1 的预览铸计划，POST 却携带轮 2 的 checkpointId + turn=2——
    // checkpointId 本身合法（确实是轮 2 的检查点），错配必须被
    // applyGuarded 的 plan.restorePointId 比对拦下。
    const preview = await callPreview(handlers, `sessionId=s1&turn=1`)
    const post = await callPost(handlers, {
      mode: 'code',
      sessionId: 's1',
      turn: 2,
      checkpointId: turn2.id,
      planId: preview.body.planId,

    })
    assert.equal(post.code, 409, `错配必须 409（收到 ${String(post.code)}）`)
    assert.equal(post.body.code, 'PLAN_STALE', '错配的错误码必须是 PLAN_STALE')
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v3\n', '错配请求不得改动任何文件')
    void turn1
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

// ── H9/H5/H6/H8：undo 可靠性四件套 ───────────────────────────────────────

async function callFsChangesRev(handlers, sessionId) {
  const handler = handlers.get('/shadow-rewind/fs-changes')
  const status = { code: 0, body: '' }
  const response = { writeHead(c) { status.code = c }, end(b) { status.body = b ?? '' }, on() {} }
  await handler({
    method: 'GET',
    url: `/shadow-rewind/fs-changes?sessionId=${encodeURIComponent(sessionId)}`,
    socket: { remoteAddress: '127.0.0.1' },
  }, response)
  return JSON.parse(status.body)
}

test('H9：restore-undo 端点递增 rev（客户端缓存随撤销失效）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-revundo-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    })
    const liveSessions = new Map([['s1', sessionWithTurns(workspace, [1])]])
    const handlers = makeHandlers(liveSessions, engine)
    const before = (await callFsChangesRev(handlers, 's1')).rev
    const undoResponse = { code: 0, body: '' }
    const response = {
      writeHead(c) { undoResponse.code = c },
      end(b) { undoResponse.body = b ?? '' },
      on() {},
    }
    await handlers.get('/shadow-rewind/restore-undo')({
      method: 'POST', url: '/shadow-rewind/restore-undo',
      socket: { remoteAddress: '127.0.0.1' },
      on(event, listener) {
        if (event === 'data') listener(Buffer.from(JSON.stringify({ sessionId: 's1' })))
        if (event === 'end') listener()
      },
    }, response)
    assert.equal(undoResponse.code, 200)
    const after = (await callFsChangesRev(handlers, 's1')).rev
    assert.ok(after > before, `撤销后 rev 必须递增（${String(before)} → ${String(after)}）`)
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('H5：部分成功的 undo 保留记录（被跳过路径可重试，不再永久搁浅）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-partial-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    // 基线 a=v1, b=w1；改动 a=v2, b=w2；恢复回基线；随后改 a（b 不动）。
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await writeFile(join(workspace, 'b.txt'), 'w1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
      await writeFile(join(workspace, 'b.txt'), 'w2\n', 'utf8')
    })
    await writeFile(join(workspace, 'a.txt'), 'v3\n', 'utf8')
    const first = await engine.undoLastRestore({ cwd: workspace })
    assert.equal(first.undonePaths.length, 1, '只有 b 撤销成功（a 被改过跳过）')
    assert.equal(first.skippedPaths.length, 1)
    // 记录必须仍在：第二次 undo 返回 UNDO_CONFLICT 而非 UNDO_NOT_FOUND。
    await assert.rejects(
      engine.undoLastRestore({ cwd: workspace }),
      (error) => error.code === 'UNDO_CONFLICT',
      '部分成功后记录必须保留（可重试），不得 UNDO_NOT_FOUND',
    )
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('H5：全部路径撤销成功后记录照常销毁（第二次 undo = UNDO_NOT_FOUND）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fulldone-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    })
    await engine.undoLastRestore({ cwd: workspace })
    await assert.rejects(
      engine.undoLastRestore({ cwd: workspace }),
      (error) => error.code === 'UNDO_NOT_FOUND',
    )
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('H6：fork 失败的补偿回滚不覆盖 undo 槽（撤销不再被反转为重新应用）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-forkfail-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    const baseline = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
    await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    const current = await engine.inspect({ cwd: workspace, restorePointId: baseline.id })
    const plan = await engine.planRestore({
      cwd: workspace, restorePointId: baseline.id, sessionId: 's1',
      expectedCurrentTreeHash: current.currentTreeHash,
    })
    // 主恢复成功（undo 记录指向它）；随后模拟 fork 失败的补偿回滚
    // （skipUndoRecord: true——补偿不得覆盖单槽记录）。
    const restored = await engine.applyRestore({ planId: plan.id, sessionId: 's1' })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v1\n')
    // 补偿回滚 = 对恢复时自动创建的 rescue 点再做一次 applyRestore。
    const inspectRescue = await engine.inspect({ cwd: workspace, restorePointId: restored.rescuePointId })
    const rollbackPlan = await engine.planRestore({
      cwd: workspace, restorePointId: restored.rescuePointId,
      sessionId: 's1', expectedCurrentTreeHash: inspectRescue.currentTreeHash,
    })
    await engine.applyRestore({ planId: rollbackPlan.id, sessionId: 's1', skipUndoRecord: true })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v2\n', '补偿已把文件滚回恢复前')
    // undo 槽仍指向主恢复：其 CAS 基线 = 恢复后内容（v1），而磁盘已被补偿
    // 改回 v2 → 撤销必须被 CAS 拒绝。修复前槽被补偿覆盖，撤销会把刚回滚的
    // 文件再次恢复到目标时点（语义反转）。无论哪种情况，磁盘不得再被动。
    await assert.rejects(
      engine.undoLastRestore({ cwd: workspace }),
      (error) => error.code === 'UNDO_CONFLICT' || error.code === 'UNDO_NOT_FOUND',
      '撤销不得把补偿刚回滚的文件再次恢复回去',
    )
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v2\n', '撤销后文件保持补偿结果')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('H8：undo 引用的 rescue 点不被配额修剪（撤销按钮不再指向已删备份）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-rescuecap-ws-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await restoreToBaseline(engine, workspace, async () => {
      await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    })
    // 把 rescue 配额压到 1：后续恢复创建新 rescue 时旧的必须可被修剪——
    // 但当前 undo 正引用的 rescue 例外（isReferencedByRecovery 保护）。
    for (let round = 0; round < 3; round += 1) {
      // 每轮：先快照（含新内容），再改出新内容，恢复回快照 → 产生新 rescue。
      await writeFile(join(workspace, 'a.txt'), `v${String(round + 3)}\n`, 'utf8')
      const snapshot = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: round + 2, turnStartSeq: (round + 2) * 10 })
      await writeFile(join(workspace, 'a.txt'), `v${String(round + 4)}\n`, 'utf8')
      const inspection = await engine.inspect({ cwd: workspace, restorePointId: snapshot.id })
      const nextPlan = await engine.planRestore({
        cwd: workspace, restorePointId: snapshot.id, sessionId: 's1',
        expectedCurrentTreeHash: inspection.currentTreeHash,
      })
      await engine.applyRestore({ planId: nextPlan.id, sessionId: 's1' })
    }
    // undo 记录仍指向最初那次恢复的 rescue 点。
    const undo = await engine.undoLastRestore({ cwd: workspace })
    assert.ok(undo.undonePaths.length >= 1, 'undo 引用的 rescue 点必须存活（不被修剪）')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})
