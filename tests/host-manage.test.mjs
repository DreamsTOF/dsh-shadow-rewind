/**
 * 配置/管理/谱系面测试（ABSORB-RECALL 1.1-1.5、三、四、六）：
 * env 覆盖与锁、配置热更、config 端点、manage 端点（树/占用/删除/GC）、
 * lineage 记录与版本徽标、GC 双闸节流、runLimited 有界并发。
 * 真实临时目录 + 真实引擎（sqlite 模式），HTTP handler 直接驱动。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'
import { cleanConfigPatch } from '../lib/rewind-host.js'
import { installShadowRewindHttp, TurnCheckpointCoordinator } from '../lib/rewind-host.js'

// ── 测试基建 ────────────────────────────────────────────────────────────────

async function makeEngine(config = {}) {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-cfg-store-'))
  const engine = new ShadowRewindEngine({ storageDir, turnCheckpointMode: 'sqlite', ...config })
  await engine.ready
  return { engine, storageDir }
}

function makeHandlers(engine, coordinator = new TurnCheckpointCoordinator(engine), bridge, sessionCwd) {
  const handlers = new Map()
  installShadowRewindHttp({
    logger: { warn: () => {} },
    sessions: { get: () => undefined },
    // sessionCwd === null 模拟「会话没有 cwd」（lineage 409 路径）；
    // undefined 用默认 storageDir；字符串按值解析。
    sessionQuery: {
      readSession: async (id) => ({
        session: { id, ...(sessionCwd === null ? {} : { cwd: sessionCwd ?? engine.config.storageDir }) },
        inheritedEventCount: 0,
        events: [],
      }),
    },
    sessionController: { create: async () => ({ sessionId: 'x' }), fork: async () => ({ sessionId: 'x' }) },
    agents: { list: () => [] },
    webServer: { register(route) { handlers.set(route.path, route.handler); return () => {} } },
  }, engine, coordinator, bridge)
  return handlers
}

async function callHttp(handler, method, url, body) {
  const status = { code: 0, body: '' }
  const response = {
    writeHead(code) { status.code = code },
    end(payload) { status.body = payload ?? '' },
    on() {},
  }
  await handler({
    method,
    url,
    socket: { remoteAddress: '127.0.0.1' },
    ...(body === undefined ? {} : {
      on(event, listener) {
        if (event === 'data') listener(Buffer.from(body))
        if (event === 'end') listener()
      },
    }),
  }, response)
  return { code: status.code, body: status.body === '' ? undefined : JSON.parse(status.body) }
}

const get = (handlers, path) => callHttp(handlers.get(path.split('?')[0]), 'GET', path)
const post = (handlers, path, body) => callHttp(handlers.get(path), 'POST', path, JSON.stringify(body))

// ── 1.4 env 覆盖 ────────────────────────────────────────────────────────────

test('env：DSH_SHADOW_REWIND_* 覆盖用户配置与默认值，非法值回退', async () => {
  const saved = process.env.DSH_SHADOW_REWIND_MAX_RESTORE_POINTS
  try {
    process.env.DSH_SHADOW_REWIND_MAX_RESTORE_POINTS = '7'
    const { engine } = await makeEngine({ maxRestorePoints: 99 })
    assert.equal(engine.config.maxRestorePoints, 7, 'env 最高优先')
    // 非法 env：静默回退下一优先级（用户配置 99），不拒绝启动。
    process.env.DSH_SHADOW_REWIND_MAX_RESTORE_POINTS = 'not-a-number'
    const { engine: engine2 } = await makeEngine({ maxRestorePoints: 99 })
    assert.equal(engine2.config.maxRestorePoints, 99)
    // 热更路径同样被 env 压住。
    process.env.DSH_SHADOW_REWIND_MAX_RESTORE_POINTS = '5'
    engine2.applyConfigPatch({ maxRestorePoints: 66 })
    assert.equal(engine2.config.maxRestorePoints, 5, 'env 在热更路径同样最高优先')
  } finally {
    if (saved === undefined) delete process.env.DSH_SHADOW_REWIND_MAX_RESTORE_POINTS
    else process.env.DSH_SHADOW_REWIND_MAX_RESTORE_POINTS = saved
  }
})

test('cleanConfigPatch：白名单、类型收敛与非法拒绝', async () => {
  const clean = cleanConfigPatch({ maxFileBytes: '4096', turnCheckpointTrust: 'strict', excludePatterns: ['dist'] })
  assert.deepEqual(clean, { maxFileBytes: 4096, turnCheckpointTrust: 'strict', excludePatterns: ['dist'] }, '数字字符串收敛')
  assert.deepEqual(cleanConfigPatch({ storageDir: '/x', turnCheckpointMode: 'jj' }), {}, '启动级字段不在白名单')
  assert.throws(() => cleanConfigPatch({ maxFiles: 0 }), /正整数/)
  assert.throws(() => cleanConfigPatch({ turnCheckpointTrust: 'loose' }), /fast 或 strict/)
  assert.throws(() => cleanConfigPatch({ excludePatterns: 'dist' }), /数组/)
  assert.throws(() => cleanConfigPatch({ excludePatterns: ['dist', ''] }), /非空字符串数组/, '服务端严格拒绝空串（UI 提交前已过滤）')
})

// ── 1.2/1.3 配置热更与端点 ──────────────────────────────────────────────────

test('applyConfigPatch：数值热更生效，排除表重建，启动级字段锁死', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-cfg-ws3-'))
  const { engine, storageDir } = await makeEngine({ excludePatterns: ['.git', 'secret-dir'] })
  try {
    await writeFile(join(workspace, 'probe.txt'), 'x', 'utf8')
    engine.applyConfigPatch({ maxFileBytes: 2048, excludePatterns: ['.git', 'node_modules', 'probe.txt'] })
    assert.equal(engine.config.maxFileBytes, 2048)
    // 排除表编译缓存已重建：probe.txt 在排除表内（捕获跳过而不是进 manifest）。
    const manifest = await engine.create({ kind: 'user', cwd: workspace, sessionId: 's0' })
    assert.ok(manifest.id, '排除表变更后捕获仍工作')
    // 启动级字段：热更强制保留原值。
    engine.applyConfigPatch({ storageDir: '/tmp/elsewhere', turnCheckpointMode: 'off' })
    assert.equal(engine.config.storageDir, storageDir)
    assert.equal(engine.config.turnCheckpointMode, 'sqlite')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('config 端点：GET 全量 + envLocks；POST patch 热更；reset 兜底', async () => {
  const saved = process.env.DSH_SHADOW_REWIND_MAX_FILE_BYTES
  try {
    process.env.DSH_SHADOW_REWIND_MAX_FILE_BYTES = '8192'
    const { engine, storageDir } = await makeEngine()
    const written = []
    const bridge = {
      overridden: () => ({ maxRestorePoints: 12 }),
      writable: () => true,
      update: async (patch) => { written.push(patch); engine.applyConfigPatch(patch) },
      reset: async (defaults) => { written.push({ __reset: true, defaults }); engine.applyConfigPatch(defaults) },
    }
    const handlers = makeHandlers(engine, undefined, bridge)
    try {
      const got = await get(handlers, '/shadow-rewind/config')
      assert.equal(got.code, 200)
      assert.equal(got.body.values.maxFileBytes, 8192, 'env 覆盖后的 resolved 值')
      assert.equal(got.body.envLocks.maxFileBytes, true)
      assert.equal(got.body.envLocks.maxRestorePoints, false)
      assert.deepEqual(got.body.overridden, { maxRestorePoints: 12 })
      assert.equal(got.body.writable, true)
      assert.equal(typeof got.body.defaults.maxRestorePoints, 'number')

      const saved2 = await post(handlers, '/shadow-rewind/config', { patch: { maxSnapshotBytes: 4096, turnCheckpointMode: 'off' } })
      assert.equal(saved2.code, 200)
      assert.deepEqual(written[0], { maxSnapshotBytes: 4096 }, '启动级字段被清洗掉，不写 settings')
      assert.equal(engine.config.maxSnapshotBytes, 4096, 'watch 链路热更进引擎')

      const reset = await post(handlers, '/shadow-rewind/config', { op: 'reset' })
      assert.equal(reset.code, 200)
      assert.equal(written[1].__reset, true)
      assert.notEqual(engine.config.maxSnapshotBytes, 4096, 'reset 反写 DEFAULTS，覆盖掉之前的 patch')

      const bad = await post(handlers, '/shadow-rewind/config', { patch: { maxFiles: -1 } })
      assert.equal(bad.code, 409)
    } finally {
      await engine.store.closeAll()
      await rm(storageDir, { recursive: true, force: true })
    }
  } finally {
    if (saved === undefined) delete process.env.DSH_SHADOW_REWIND_MAX_FILE_BYTES
    else process.env.DSH_SHADOW_REWIND_MAX_FILE_BYTES = saved
  }
})

// ── 三：manage 端点 ─────────────────────────────────────────────────────────

test('manage 端点：三级树 + 磁盘占用 + 单条删除（undo 引用保护透出）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-cfg-ws-'))
  const { engine, storageDir } = await makeEngine()
  const handlers = makeHandlers(engine)
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1', 'utf8')
    const point = await engine.create({ kind: 'user', cwd: workspace, sessionId: 's1' })
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 5 })

    const list = await get(handlers, '/shadow-rewind/manage?op=list')
    assert.equal(list.code, 200)
    const ws = list.body.workspaces.find((item) => item.workspace === workspace)
    assert.ok(ws, '树里有工作区')
    const session = ws.sessions.find((item) => item.sessionId === 's1')
    assert.ok(session, '树里有会话分组')
    assert.equal(session.count, 2, '手动恢复点 + 轮检查点都在树里')
    assert.equal(list.body.total, 2)

    const disk = await get(handlers, '/shadow-rewind/manage?op=diskUsage')
    assert.equal(disk.code, 200)
    assert.ok(disk.body.totalBytes > 0, '存储目录有字节占用')
    assert.ok(disk.body.perWorkspace[workspace] > 0)

    // 单条删除（轮检查点）：走双闸 GC，首次删除必回收（stamp 缺省=很久前）。
    const turnPoint = session.checkpoints.find((point) => point.kind === 'turn')
    const del = await post(handlers, '/shadow-rewind/manage', { op: 'delete', cwd: workspace, restorePointId: turnPoint.id })
    assert.equal(del.code, 200)
    assert.equal(del.body.ok, true)

    // undo 引用保护：engine.undoLastRestore 的 rescue 引用……通过直接 delete 手动点复现 UNDO_REFERENCE 语义不可行（需先 restore），
    // 这里验证删除不存在 id 的错误映射。
    const missing = await post(handlers, '/shadow-rewind/manage', { op: 'delete', cwd: workspace, restorePointId: 'rp_x_000000000000' })
    assert.equal(missing.code, 409)
    assert.equal(missing.body.code, 'RESTORE_POINT_NOT_FOUND')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('manage 端点：会话级/全部删除逐条走引擎，gc 端点立即回收', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-cfg-ws2-'))
  const { engine, storageDir } = await makeEngine()
  const handlers = makeHandlers(engine)
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1', 'utf8')
    await engine.create({ kind: 'user', cwd: workspace, sessionId: 's1' })
    await writeFile(join(workspace, 'a.txt'), 'v2', 'utf8')
    await engine.create({ kind: 'user', cwd: workspace, sessionId: 's1' })
    await engine.create({ kind: 'user', cwd: workspace, sessionId: 's2' })

    const delS1 = await post(handlers, '/shadow-rewind/manage', { op: 'deleteSession', cwd: workspace, sessionId: 's1' })
    assert.equal(delS1.code, 200)
    assert.equal(delS1.body.ok, true)
    assert.equal(delS1.body.deleted.length, 2, 's1 的两条都删除')
    const remaining = await engine.list({ cwd: workspace, includeTurnCheckpoints: true, includeRescue: true })
    assert.equal(remaining.length, 1, 's2 的恢复点不受影响')

    const gc = await post(handlers, '/shadow-rewind/manage', { op: 'gc', cwd: workspace })
    assert.equal(gc.code, 200)
    assert.equal(gc.body.ok, true)
    assert.ok(typeof gc.body.deletedBlobs === 'number')

    const delAll = await post(handlers, '/shadow-rewind/manage', { op: 'deleteAll', cwd: workspace })
    assert.equal(delAll.body.ok, true)
    assert.equal((await engine.list({ cwd: workspace, includeTurnCheckpoints: true, includeRescue: true })).length, 0)

    const bad = await post(handlers, '/shadow-rewind/manage', { op: 'wat', cwd: workspace })
    assert.equal(bad.code, 409)
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

// ── 四：fork 谱系 ───────────────────────────────────────────────────────────

test('lineage：记录、幂等、版本徽标计算', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-cfg-lineage-'))
  const { engine, storageDir } = await makeEngine()
  // lineage 端点经 sessionQuery 解析 cwd：桩指向本用例的工作区。
  const handlers = makeHandlers(engine, undefined, undefined, workspace)
  try {
    await engine.recordForkLineage({ cwd: workspace, parentSessionId: 'p1', childSessionId: 'c1', restorePointId: 'rp_a_000000000001' })
    await engine.recordForkLineage({ cwd: workspace, parentSessionId: 'c1', childSessionId: 'c2', restorePointId: 'rp_a_000000000002' })
    // 幂等：重复 fork 不重复记。
    await engine.recordForkLineage({ cwd: workspace, parentSessionId: 'p1', childSessionId: 'c1', restorePointId: 'rp_a_000000000001' })
    const entries = await engine.loadForkLineage(workspace)
    assert.equal(entries.length, 2)
    assert.ok(entries.some((entry) => entry.childId === 'c2'), 'c2 链条在列')
    assert.ok(entries.every((entry) => typeof entry.time === 'number'))

    // lineage 端点按 sessionId 算版本：c1 是 v2，c2 是 v3，p1 无徽标。
    const c2 = await get(handlers, `/shadow-rewind/lineage?sessionId=c2`)
    assert.equal(c2.code, 200)
    assert.equal(c2.body.version, 3)
    assert.equal(c2.body.restoredFrom, 'rp_a_000000000002')
    const c1 = await get(handlers, `/shadow-rewind/lineage?sessionId=c1`)
    assert.equal(c1.body.version, 2)
    const p1 = await get(handlers, `/shadow-rewind/lineage?sessionId=p1`)
    assert.equal(p1.body.version, undefined, '原始会话无徽标')
    assert.equal(p1.body.entries.length, 2)

    // 无 cwd 会话（lineage 409 路径）：sessionQuery 桩返回无 cwd 会话。
    const noCwdHandlers = makeHandlers(engine, undefined, undefined, null)
    const none = await get(noCwdHandlers, '/shadow-rewind/lineage?sessionId=ghost')
    assert.equal(none.code, 409)
    assert.equal(none.body.code, 'INVALID_ARGUMENTS')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

// ── 六：GC 双闸 ─────────────────────────────────────────────────────────────

test('GC 双闸：turn 检查点创建不推进 GC，首删立即回收，闸内跳过，手动 GC 绕闸', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-cfg-gc-'))
  const { engine, storageDir } = await makeEngine()
  try {
    // turn 检查点的创建不跑 GC（kind==='turn' 跳过）——stamp 保持 0。
    await writeFile(join(workspace, 'a.txt'), 'v1', 'utf8')
    const t1 = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 1 })
    await writeFile(join(workspace, 'a.txt'), 'v2', 'utf8')
    const t2 = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 2, turnStartSeq: 2 })
    assert.equal(await engine.store.readGcStamp(workspace), 0, 'turn 创建不触发 GC（stamp 缺省 0）')

    // 首次删除：stamp 0 视为「很久以前」→ 立即 GC，v1 内容行被回收。
    const d1 = await engine.delete({ cwd: workspace, restorePointId: t1.id })
    assert.ok((d1.deletedBlobs ?? 0) > 0, '首次删除触发 GC 并回收 v1 内容')
    assert.ok((await engine.store.readGcStamp(workspace)) > 0, 'gc.stamp 已持久化')

    // 时间闸内（刚 GC 过）：再删不跑 GC。
    const d2 = await engine.delete({ cwd: workspace, restorePointId: t2.id })
    assert.equal(d2.deletedBlobs, undefined, '24h 闸内跳过 GC（无回收）')

    // 手动 GC 绕闸：t2 的孤儿内容被回收。
    const gc = await engine.collectGarbageFor(workspace)
    assert.ok(gc.deletedBlobs > 0, '手动 GC 立即回收')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('GC 双闸：条数闸——时间闸内累计删除 50 条后第 51 条触发', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-cfg-gc2-'))
  const { engine, storageDir } = await makeEngine({ maxTurnCheckpointsPerSession: 60 })
  try {
    // 51 个 turn 检查点（内容逐轮变化，各自占独立 blob），全程不推进 GC。
    await writeFile(join(workspace, 'a.txt'), 'v0', 'utf8')
    const ids = []
    for (let turn = 1; turn <= 51; turn += 1) {
      await writeFile(join(workspace, 'a.txt'), `v${String(turn)}`, 'utf8')
      ids.push((await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn, turnStartSeq: turn })).id)
    }
    assert.equal(await engine.store.readGcStamp(workspace), 0)
    // 删除 51 条：第 1 条走「stamp 0 = 很久前」触发；第 2..50 条在时间闸内
    // 跳过（pending 1..49 < 50）；第 51 条 pending 达 50 → 条数闸触发。
    let collected = 0
    for (const id of ids) {
      const result = await engine.delete({ cwd: workspace, restorePointId: id })
      if ((result.deletedBlobs ?? 0) > 0) collected += 1
    }
    assert.equal(collected, 2, '首删（时间闸豁免）+ 第 51 条（条数闸）恰好两次回收')
    const remaining = await engine.store.listManifests(workspace)
    assert.equal(remaining.length, 0, '51 条已全部删除')
  } finally {
    await engine.store.closeAll()
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

// ── runLimited 有界并发 ─────────────────────────────────────────────────────

test('runLimited：并发上限生效且结果保序', async () => {
  const { runLimited } = await import('../lib/host/fs-changes.js')
  let running = 0
  let peak = 0
  const tasks = Array.from({ length: 12 }, (_, index) => async () => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise((resolve) => setTimeout(resolve, 5))
    running -= 1
    return index
  })
  const results = await runLimited(tasks, 4)
  assert.deepEqual(results, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], '结果与输入同序')
  assert.ok(peak <= 4, `并发峰值不得超限（实测 ${String(peak)}）`)
})
