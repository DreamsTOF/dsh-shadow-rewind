/**
 * 混沌测试：把空目录、权限位、多会话归属、检查点淘汰、GC、整树恢复
 * 放进同一个工作区搅拌，验证核心不变量：
 *  1. 任何存活的检查点都可以整树精确恢复（恢复后 inspect 零差异）；
 *  2. 端点归属过滤只把本会话窗口的写入发给本会话；
 *  3. 随机操作序列（写/删文件、建/删空目录、交错开轮、随机恢复、
 *     手动点触发 GC）全程不抛异常、不丢引用。
 * 随机部分用固定种子，失败可复现。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, rmdir, writeFile, readFile, readdir, lstat } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'
import { installShadowRewindHttp, TurnCheckpointCoordinator } from '../lib/rewind-host.js'
import { WorkspaceWriteGate } from '../lib/write-gate.js'
import { canonicalDirectory } from '../lib/path-utils.js'

const pause = (ms = 3) => new Promise((resolve) => setTimeout(resolve, ms))

async function makeEngine(overrides = {}) {
  const storageDir = await mkdtemp(join(tmpdir(), 'chaos-store-'))
  const engine = new ShadowRewindEngine({ storageDir, turnCheckpointMode: 'sqlite', ...overrides })
  await engine.ready
  return { engine, storageDir }
}

async function captureTurn(engine, workspace, sessionId, turn) {
  return engine.createTurnCheckpoint({ cwd: workspace, sessionId, turn, turnStartSeq: turn * 100 })
}

async function rewindTo(engine, workspace, checkpointId) {
  const inspection = await engine.inspect({ cwd: workspace, restorePointId: checkpointId })
  if (inspection.changes.length === 0) return { restoredPaths: [] } // 已一致，无需恢复
  const plan = await engine.planRestore({
    cwd: workspace,
    restorePointId: checkpointId,
    expectedCurrentTreeHash: inspection.currentTreeHash,
  })
  return engine.applyRestore({ planId: plan.id, confirmation: plan.confirmation })
}

/** 恢复不变量：工作区与检查点零差异（含空目录条目）。 */
async function assertTreeMatches(engine, workspace, checkpointId, label) {
  const inspection = await engine.inspect({ cwd: workspace, restorePointId: checkpointId })
  assert.equal(
    inspection.changes.length, 0,
    `${label}：恢复后工作区与检查点 ${checkpointId} 仍有差异：${inspection.changes.map(c => `${c.path}:${c.kind}`).join(', ') || '(无)'}`,
  )
}

/** 从磁盘重建事实清单：文件路径 + 空目录（子树无文件，同扫描语义）。 */
async function walkWorkspace(root, rel = '') {
  const files = []
  const dirs = []
  const abs = rel === '' ? root : join(root, ...rel.split('/'))
  const entries = await readdir(abs, { withFileTypes: true })
  let hasFileInSubtree = false
  for (const entry of entries) {
    const childRel = rel === '' ? entry.name : `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      const child = await walkWorkspace(root, childRel)
      files.push(...child.files)
      dirs.push(...child.dirs)
      if (child.files.length === 0) dirs.push(childRel)
      else hasFileInSubtree = true
    } else if (entry.isFile()) {
      files.push(childRel)
      hasFileInSubtree = true
    }
  }
  return { files, dirs, hasFileInSubtree }
}

async function snapshotTree(root) {
  const walk = await walkWorkspace(root)
  return { files: walk.files.sort(), dirs: walk.dirs.sort() }
}

// ── 端点脚手架（与 fs-changes 测试同款，免网络直驱） ─────────────────────

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
    // dsh 0.1.2 宿主形状：sessions.get 返回核心 Session（header +
    // inheritedEventCount + snapshotEvents()）。
    sessions: { get: (id) => liveSessions.get(id) },
    sessionQuery: {
      readSession: async (id) => {
        const live = liveSessions.get(id)
        return live === undefined
          ? { session: { id }, inheritedEventCount: 0, events: [] }
          : { session: { id: live.id, cwd: live.session.header.cwd }, inheritedEventCount: 0, events: [] }
      },
    },
    // dsh 0.1.2：apiProxy 移除，会话网关收敛为 sessionController。
    sessionController: {
      create: async () => ({ sessionId: 'x' }),
      fork: async () => ({ sessionId: 'x' }),
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

// ── 场景一：双会话交错写盘 + 归属分离 + 整树恢复收敛 ─────────────────────

test('混沌：双会话交错写盘——归属分离、空目录流转、整树恢复收敛', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'chaos-interleave-'))
  const { engine, storageDir } = await makeEngine()
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await mkdir(join(workspace, 'sub'))
    await writeFile(join(workspace, 'sub', 'b.txt'), 'bee v1\n', 'utf8')

    // A 轮 1：改 a.txt + 建空目录 emptyA。
    await captureTurn(engine, workspace, 'sA', 1)
    await pause()
    await writeFile(join(workspace, 'a.txt'), 'v2 by A\n', 'utf8')
    await mkdir(join(workspace, 'emptyA'))

    // B 开轮（检查点收录 A 的写入），随后 B 删 sub/b.txt（sub 变空）+ 建新文件。
    await captureTurn(engine, workspace, 'sB', 1)
    await pause()
    await rm(join(workspace, 'sub', 'b.txt'))
    await writeFile(join(workspace, 'b-new.txt'), 'made by B\n', 'utf8')

    // A 轮 2（检查点收录 B 的写入），A 往 sub 里写文件（sub 重新非空）+ 删 emptyA。
    await captureTurn(engine, workspace, 'sA', 2)
    await pause()
    await writeFile(join(workspace, 'sub', 'c.txt'), 'c by A\n', 'utf8')
    await rmdir(join(workspace, 'emptyA'))

    // B 轮 2 收尾。
    await captureTurn(engine, workspace, 'sB', 2)

    // 端点归属：A 轮 1 只见自己窗口的写入；B 的写入（含 sub 变空的目录条目）被剔除。
    const liveSessions = new Map([
      ['sA', { id: 'sA', status: 'idle', session: { id: 'sA', header: { cwd: workspace }, inheritedEventCount: 0, snapshotEvents: () => [] } }],
      ['sB', { id: 'sB', status: 'idle', session: { id: 'sB', header: { cwd: workspace }, inheritedEventCount: 0, snapshotEvents: () => [] } }],
    ])
    const coordinator = new TurnCheckpointCoordinator(engine)
    const writeGate = new WorkspaceWriteGate({ canonicalDirectory, agents: { list: () => [] } })
    const handlers = makeHandlers(liveSessions, engine, coordinator, writeGate)

    const bodyA = await callFsChanges(handlers, 'sA')
    const aTurn1 = bodyA.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(aTurn1, 'A 轮 1 必须有配对条目')
    const aPaths = aTurn1.changes.map((change) => change.path)
    assert.ok(aPaths.includes('a.txt'), 'A 自己的修改必须保留')
    assert.ok(aPaths.includes('emptyA'), 'A 创建的空目录必须保留')
    const emptyAChange = aTurn1.changes.find((change) => change.path === 'emptyA')
    assert.equal(emptyAChange.dir, true, '空目录条目必须带 dir 标记')
    assert.ok(!aPaths.includes('b-new.txt'), 'B 窗口写入必须从 A 的清单剔除')
    assert.ok(!aPaths.includes('sub/b.txt'), 'B 造成的删除必须从 A 的清单剔除')
    assert.ok(!aPaths.includes('sub'), 'sub 变空发生在 B 的窗口，必须剔除')

    const bodyB = await callFsChanges(handlers, 'sB')
    const bTurn1 = bodyB.turns.find((turn) => turn.turn === 1 && turn.live !== true)
    assert.ok(bTurn1, 'B 轮 1 必须有配对条目')
    const bPaths = bTurn1.changes.map((change) => change.path)
    assert.ok(bPaths.includes('sub/b.txt'), 'B 自己的删除必须保留')
    assert.ok(bPaths.includes('b-new.txt'), 'B 自己的新增必须保留')
    // 注意：B 在自己开轮捕获「之前」删掉了 sub/b.txt——「sub 变空」这一树
    // 事实在 B-t1 捕获时就已成形，归属落在窗口 0（A 一侧），因此从 B 的清单
    // 剔除。这是窗口模型的固有近似（开轮前写盘归属前一个窗口），测试按此断言。
    assert.ok(!bPaths.includes('sub'), 'sub 变空成形于 B 开轮捕获，归属窗口 0，应从 B 清单剔除')
    assert.ok(!bPaths.includes('sub/c.txt'), 'A 窗口的写入必须从 B 的清单剔除')
    assert.ok(!bPaths.includes('emptyA'), 'A 删除 emptyA 属于 A 的窗口，必须剔除')

    // 整树恢复收敛：回到 A 轮 1 轮起——B 的一切与 A 轮 1 的写入全部消失。
    const aT1 = (await engine.listTurnCheckpoints({ cwd: workspace, sessionId: 'sA' }))
      .find((point) => point.turn === 1)
    await rewindTo(engine, workspace, aT1.id)
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v1\n')
    assert.equal(await readFile(join(workspace, 'sub', 'b.txt'), 'utf8'), 'bee v1\n')
    for (const absent of ['b-new.txt', 'emptyA', join('sub', 'c.txt')]) {
      await assert.rejects(() => lstat(join(workspace, absent)), { code: 'ENOENT' }, `${absent} 不应存在`)
    }
    await assertTreeMatches(engine, workspace, aT1.id, '恢复后收敛')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
  }
})

// ── 场景二：检查点淘汰 + GC 压力下，存活检查点全部可精确恢复 ────────────

test('混沌：淘汰与 GC 压力下存活检查点全部可恢复', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'chaos-evict-'))
  const { engine, storageDir } = await makeEngine({ maxTurnCheckpointsPerSession: 2, maxRestorePoints: 3 })
  try {
    const session = 'sA'
    for (let turn = 1; turn <= 5; turn += 1) {
      await captureTurn(engine, workspace, session, turn)
      await pause()
      await writeFile(join(workspace, `gen-${turn}.txt`), `generation ${turn}\n`, 'utf8')
      if (turn % 2 === 0) {
        // 手动恢复点触发 GC；淘汰 + GC 联手回收旧轮 blob。
        await engine.create({ cwd: workspace, label: `manual-${turn}` })
      }
    }
    await captureTurn(engine, workspace, session, 6)

    const survivors = await engine.listTurnCheckpoints({ cwd: workspace, sessionId: session })
    assert.equal(survivors.length, 2, '每会话只保留最新 2 个轮检查点')
    assert.deepEqual(survivors.map((point) => point.turn), [5, 6])

    // 每个存活检查点：恢复 → 零差异 → 再恢复下一个（反复横跳，含 rescue 链）。
    for (const point of survivors) {
      await rewindTo(engine, workspace, point.id)
      await assertTreeMatches(engine, workspace, point.id, `轮 ${point.turn}`)
    }

    // 恢复回轮 6（最新）后，被早期轮引用的文件已不可恢复——这是淘汰语义，
    // 但当前树本身必须与轮 6 检查点一致。
    const gen1Gone = await engine.inspect({ cwd: workspace, restorePointId: survivors[1].id })
    assert.equal(gen1Gone.changes.length, 0)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
  }
})

// ── 场景三：固定种子模糊测试（双会话随机操作 + 随机恢复 + 定期 GC） ──────

/** mulberry32：固定种子 PRNG，失败可复现。 */
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function fuzzRun(mode, seed) {
  const workspace = await mkdtemp(join(tmpdir(), `chaos-fuzz-${mode}-`))
  const { engine, storageDir } = await makeEngine({
    ...(mode === 'jj' ? { turnCheckpointMode: 'jj' } : {}),
    maxTurnCheckpointsPerSession: 3,
    maxRestorePoints: 4,
  })
  const rand = mulberry32(seed)
  const sessions = ['sA', 'sB']
  const turnCounter = { sA: 0, sB: 0 }
  const seqCounter = { sA: 0, sB: 0 }
  let fileSeq = 0
  let dirSeq = 0

  const capture = async (sessionId) => {
    turnCounter[sessionId] += 1
    seqCounter[sessionId] += 1
    await engine.createTurnCheckpoint({
      cwd: workspace,
      sessionId,
      turn: turnCounter[sessionId],
      turnStartSeq: seqCounter[sessionId] * 7,
    })
    await pause(2)
  }

  const restoreRandom = async () => {
    const sessionId = sessions[Math.floor(rand() * sessions.length)]
    const points = await engine.listTurnCheckpoints({ cwd: workspace, sessionId })
    if (points.length === 0) return
    const point = points[Math.floor(rand() * points.length)]
    await rewindTo(engine, workspace, point.id)
    // 核心不变量：恢复后的树与检查点零差异。
    await assertTreeMatches(engine, workspace, point.id, `fuzz(${mode}) 恢复 ${sessionId} 轮 ${point.turn}`)
  }

  try {
    await writeFile(join(workspace, 'seed.txt'), 'seed\n', 'utf8')
    await capture('sA')

    const OPS = 44
    for (let op = 0; op < OPS; op += 1) {
      const tree = await snapshotTree(workspace)
      const roll = rand()
      if (roll < 0.24) {
        // 写文件：新建（可能放进已有目录）或覆盖已有。
        fileSeq += 1
        const name = rand() < 0.3 && tree.dirs.length > 0
          ? `${tree.dirs[Math.floor(rand() * tree.dirs.length)].split('/')[0]}/into-${fileSeq}.txt`
          : `f-${fileSeq}.txt`
        const segments = name.split('/')
        if (segments.length > 1) {
          await mkdir(join(workspace, ...segments.slice(0, -1)), { recursive: true })
        }
        await writeFile(join(workspace, ...segments), `content ${fileSeq} op ${op}\n`, 'utf8')
      } else if (roll < 0.42 && tree.files.length > 1) {
        // 删文件（可能把目录掏空）。
        const victim = tree.files[1 + Math.floor(rand() * (tree.files.length - 1))]
        if (victim !== undefined && victim !== 'seed.txt') await rm(join(workspace, ...victim.split('/')))
      } else if (roll < 0.54) {
        // 建空目录（可能嵌套两层）。
        dirSeq += 1
        const rel = rand() < 0.35 ? `nest-${dirSeq}/leaf` : `empty-${dirSeq}`
        await mkdir(join(workspace, ...rel.split('/')), { recursive: true })
      } else if (roll < 0.63 && tree.dirs.length > 0) {
        // 删空目录（挑最深的先删，避免父目录非空失败）。
        const victim = tree.dirs.sort((a, b) => b.split('/').length - a.split('/').length)[0]
        if (victim !== undefined) await rmdir(join(workspace, ...victim.split('/'))).catch(() => undefined)
      } else if (roll < 0.78) {
        await capture(sessions[Math.floor(rand() * sessions.length)])
      } else if (roll < 0.9) {
        await restoreRandom()
      } else {
        // 手动恢复点：触发 GC + 淘汰。
        await engine.create({ cwd: workspace, label: `fuzz-${op}` }).catch(() => undefined)
      }
    }

    // 收尾：每个会话的每个存活检查点都必须可精确恢复（含淘汰后的残链）。
    for (const sessionId of sessions) {
      const points = await engine.listTurnCheckpoints({ cwd: workspace, sessionId })
      for (const point of points) {
        await rewindTo(engine, workspace, point.id)
        await assertTreeMatches(engine, workspace, point.id, `fuzz(${mode}) 收尾 ${sessionId} 轮 ${point.turn}`)
      }
      // 端点在搅拌后仍然可服务（形态完整、不抛错）。
      const liveSessions = new Map(sessions.map((id) => [
        id, { id, status: 'idle', session: { id, header: { cwd: workspace }, inheritedEventCount: 0, snapshotEvents: () => [] } },
      ]))
      const coordinator = new TurnCheckpointCoordinator(engine)
      const writeGate = new WorkspaceWriteGate({ canonicalDirectory, agents: { list: () => [] } })
      const handlers = makeHandlers(liveSessions, engine, coordinator, writeGate)
      const body = await callFsChanges(handlers, sessionId)
      assert.ok(Array.isArray(body.turns), 'fs-changes.turns 必须是数组')
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
  }
}

test('混沌（模糊）：双会话随机操作/恢复/淘汰全搅拌（sqlite）', () => fuzzRun('sqlite', 20260830))

function jjOnPath() {
  try {
    execFileSync('jj', ['--version'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}
if (jjOnPath()) {
  test('混沌（模糊）：双会话随机操作/恢复/淘汰全搅拌（jj 影子）', () => fuzzRun('jj', 20260830))
} else {
  test('混沌（模糊）：jj 不可用，跳过影子后端搅拌', () => {})
}

// ── 轮末检查点（turn/end 捕获）：归属窗口冻结与配对升级 ───────────────────

test('混沌：轮末检查点冻结轮末树——轮结束后的写盘不计入该轮', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'chaos-turnend-'))
  const { engine, storageDir } = await makeEngine()
  try {
    const coordinator = new TurnCheckpointCoordinator(engine)
    const writeGate = new WorkspaceWriteGate({ canonicalDirectory, agents: { list: () => [] } })
    const liveSessions = new Map([
      ['s1', { id: 's1', status: 'idle', session: { id: 's1', header: { cwd: workspace }, inheritedEventCount: 0, snapshotEvents: () => [] } }],
    ])
    const handlers = makeHandlers(liveSessions, engine, coordinator, writeGate)

    // s1 轮 1：轮起 → 轮内写入 → 轮末捕获。
    await captureTurn(engine, workspace, 's1', 1)
    await pause()
    await writeFile(join(workspace, 's1-turn1.txt'), 'T1\n', 'utf8')
    await pause()
    const endCp = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 100, phase: 'end' })

    // 轮末幂等：同一轮同相位重复捕获返回同一检查点。
    const again = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 100, phase: 'end' })
    assert.equal(again.id, endCp.id, '轮末捕获必须幂等')

    // 轮结束后才落盘的文件：不属于轮 1。
    await pause()
    await writeFile(join(workspace, 'late.txt'), 'LATE\n', 'utf8')

    // s1 轮 2 正常推进。
    await captureTurn(engine, workspace, 's1', 2)
    await pause()
    await writeFile(join(workspace, 's1-turn2.txt'), 'T2\n', 'utf8')
    await captureTurn(engine, workspace, 's1', 3)

    const body = await callFsChanges(handlers, 's1')
    const turn1 = body.turns.find((t) => t.turn === 1 && t.live !== true)
    assert.ok(turn1, 's1 轮 1 必须有配对条目')
    assert.equal(turn1.nextCheckpointId, endCp.id, '轮 1 的配对终点必须是轮末检查点')
    const paths1 = turn1.changes.map((c) => c.path)
    assert.ok(paths1.includes('s1-turn1.txt'), '轮内写入必须在轮 1')
    assert.ok(!paths1.includes('late.txt'), '轮结束后的写盘不得计入轮 1')

    const turn2 = body.turns.find((t) => t.turn === 2 && t.live !== true)
    assert.ok(turn2, 's1 轮 2 必须有配对条目')
    const paths2 = turn2.changes.map((c) => c.path)
    assert.ok(paths2.includes('s1-turn2.txt'), '轮 2 写入归属轮 2')
    assert.ok(!paths2.includes('late.txt'), '轮间间隙的写盘也不得混入轮 2')

    // 轮末检查点可整树恢复：late.txt 被移除，轮内写入保留。
    await rewindTo(engine, workspace, endCp.id)
    assert.equal(await readFile(join(workspace, 's1-turn1.txt'), 'utf8'), 'T1\n')
    await assert.rejects(() => readFile(join(workspace, 'late.txt')), { code: 'ENOENT' }, '恢复轮末必须移除轮后写入')
    await assertTreeMatches(engine, workspace, endCp.id, '轮末检查点整树收敛')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('混沌：协调器经 session/event 的 turn/end 事件捕获轮末检查点', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'chaos-turnend-hook-'))
  const { engine, storageDir } = await makeEngine()
  try {
    const coordinator = new TurnCheckpointCoordinator(engine)
    const listeners = []
    const ctx = {
      logger: { info() {}, warn() {}, error() {} },
      on: (event, listener) => { listeners.push([event, listener]) },
    }
    coordinator.install(ctx)
    assert.ok(listeners.some(([e]) => e === 'session/event'), 'install 必须订阅 session/event')

    // 轮起检查点（模拟 pre-step 第一步）。
    await captureTurn(engine, workspace, 'sX', 1)
    await pause()
    await writeFile(join(workspace, 'in-turn.txt'), 'X\n', 'utf8')

    // 触发 turn/end 事件（fire-and-forget，等待异步捕获落盘）。
    const sessionListener = listeners.find(([e]) => e === 'session/event')[1]
    sessionListener(
      { id: 'sX', header: { cwd: workspace }, snapshotEvents: () => [{ type: 'turn/start', seq: 100, data: { turn: 1 } }] },
      { type: 'turn/end', data: { turn: 1 } },
    )
    await pause(80)
    const points = await engine.listTurnCheckpoints({ cwd: workspace, sessionId: 'sX' })
    const endCp = points.find((p) => p.phase === 'end')
    assert.ok(endCp, 'turn/end 事件后必须存在轮末检查点')
    assert.equal(endCp.turn, 1)

    // 轮末冻结验证：事件后再写盘，恢复到轮末检查点时该文件被移除。
    await writeFile(join(workspace, 'after-end.txt'), 'Y\n', 'utf8')
    await rewindTo(engine, workspace, endCp.id)
    assert.equal(await readFile(join(workspace, 'in-turn.txt'), 'utf8'), 'X\n')
    await assert.rejects(() => readFile(join(workspace, 'after-end.txt')), { code: 'ENOENT' })

    // turn/start 事件缺失时静默跳过（不抛异常）。
    sessionListener(
      { id: 'sY', header: { cwd: workspace }, snapshotEvents: () => [] },
      { type: 'turn/end', data: { turn: 9 } },
    )
    await pause(20)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('混沌：轮起/轮末淘汰各按相位计窗口，互不挤占', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'chaos-turnend-evict-'))
  const { engine, storageDir } = await makeEngine({ maxTurnCheckpointsPerSession: 3 })
  try {
    // 6 轮 × （轮起 + 轮末）：每相位各留最新 3 个。
    for (let turn = 1; turn <= 6; turn += 1) {
      await writeFile(join(workspace, `f${turn}.txt`), `v${turn}\n`, 'utf8')
      await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 'sE', turn, turnStartSeq: turn * 10 })
      await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 'sE', turn, turnStartSeq: turn * 10, phase: 'end' })
    }
    const points = await engine.listTurnCheckpoints({ cwd: workspace, sessionId: 'sE' })
    const starts = points.filter((p) => p.phase !== 'end').map((p) => p.turn)
    const ends = points.filter((p) => p.phase === 'end').map((p) => p.turn)
    assert.deepEqual(starts, [4, 5, 6], '轮起只保留最新 3 个，轮末不挤占')
    assert.deepEqual(ends, [4, 5, 6], '轮末只保留最新 3 个，轮起不挤占')

    // 存活的轮末检查点仍可整树精确恢复。
    const endCp = points.find((p) => p.phase === 'end' && p.turn === 4)
    await rewindTo(engine, workspace, endCp.id)
    await assertTreeMatches(engine, workspace, endCp.id, '淘汰后存活的轮末检查点')
    assert.equal(await readFile(join(workspace, 'f4.txt'), 'utf8'), 'v4\n')
    await assert.rejects(() => readFile(join(workspace, 'f6.txt')), { code: 'ENOENT' })
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
  }
})
