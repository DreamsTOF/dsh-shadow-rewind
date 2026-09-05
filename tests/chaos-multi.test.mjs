/**
 * 多会话混沌归属测试：A-G 七个会话，轮数各不相同（5/2/7/3/6/1/4），
 * 完成顺序受偏置控制（轮数多的先完成 / 轮数少的先完成两种相反剧本），
 * 每轮执行 1-4 次随机操作（建/改/删文件、建/删空目录、嵌套目录、共享热文件）。
 *
 * 核心断言：每个会话每一轮的 fs-changes 识别结果，必须与该会话该轮真实
 * 产生的净变更**精确相等**（路径+类型+目录标记全对齐，含「目录被掏空/
 * 被填实」引发的隐式目录条目）。这直接回答「检查点 diff 能否在对应
 * 对话中准确识别该对话产生的更改」——在「会话只在自己开轮捕获之后、
 * 下一个会话开轮捕获之前写盘」的事件模型下（即写入闸现实），答案是
 * 精确成立，与轮数多少、完成先后无关。
 *
 * 固定种子，失败可复现。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'
import { installShadowRewindHttp, TurnCheckpointCoordinator } from '../lib/rewind-host.js'
import { WorkspaceWriteGate } from '../lib/write-gate.js'
import { canonicalDirectory } from '../lib/path-utils.js'

const pause = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms))

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

const SESSIONS = [
  { id: 'sA', turns: 5 },
  { id: 'sB', turns: 2 },
  { id: 'sC', turns: 7 },
  { id: 'sD', turns: 3 },
  { id: 'sE', turns: 6 },
  { id: 'sF', turns: 1 },
  { id: 'sG', turns: 4 },
]

/** 构造全局开轮序列（确定性，完成顺序相反可证）：
 *  - 'high-first'：按轮数降序分段串联——轮数最多的 sC 最先跑完全部 7 轮，
 *    轮数最少的 sF 排在最后（最后完成）；
 *  - 'low-first'：低轮数会话的单轮拆成「开场」散布在高轮数会话的长跑之间——
 *    sF 第 1 个事件即完成（最先完成），sC 的 7 轮贯穿全场最后收尾。 */
function buildSchedule(bias) {
  const events = []
  const push = (sessionId, count, from = 1) => {
    for (let turn = from; turn < from + count; turn += 1) events.push({ sessionId, turn })
  }
  if (bias === 'high-first') {
    // 交错但保证 sC（7 轮）最先完成：sC 的轮散布开场，其它会话各让 1 轮
    // 穿插其中；sF 的单轮被押后到 sC 收尾之后，随后按序收束。
    for (const [sessionId] of [
      ['sC', 1], ['sA', 1], ['sC', 2], ['sE', 1], ['sC', 3], ['sC', 4],
      ['sB', 1], ['sC', 5], ['sD', 1], ['sC', 6], ['sG', 1], ['sC', 7],
    ]) {
      events.push({ sessionId, turn: events.filter((e) => e.sessionId === sessionId).length + 1 })
    }
    push('sF', 1)
    push('sA', 4, 2)
    push('sE', 5, 2)
    push('sB', 1, 2)
    push('sG', 3, 2)
    push('sD', 2, 2)
  } else {
    const sF = SESSIONS.find((s) => s.id === 'sF')
    const sB = SESSIONS.find((s) => s.id === 'sB')
    const sD = SESSIONS.find((s) => s.id === 'sD')
    const sG = SESSIONS.find((s) => s.id === 'sG')
    const sA = SESSIONS.find((s) => s.id === 'sA')
    const sE = SESSIONS.find((s) => s.id === 'sE')
    const sC = SESSIONS.find((s) => s.id === 'sC')
    push(sF.id, sF.turns)            // sF 开场即完成（最先）
    push(sC.id, 2)                   // sC 起跑
    push(sB.id, sB.turns)            // sB 完成
    push(sC.id, 2, 3)
    push(sD.id, sD.turns)            // sD 完成
    push(sC.id, 2, 5)
    push(sG.id, sG.turns)            // sG 完成
    push(sA.id, sA.turns)            // sA 完成
    push(sE.id, sE.turns)            // sE 完成
    push(sC.id, 1, 7)                // sC 最后收尾（最后完成）
  }
  return events
}

/** 完成顺序画像：每个会话最后一轮在全局序列中的位置。 */
function completionProfile(events) {
  const profile = {}
  events.forEach((event, index) => { profile[event.sessionId] = index })
  return profile
}

/** 扫描同构的空目录判定：显式创建的目录中，子树无任何活文件者。 */
function dirEntries(trackedDirs, liveFiles) {
  const entries = new Set()
  for (const dir of trackedDirs) {
    const prefix = `${dir}/`
    let hasFile = false
    for (const file of liveFiles) {
      if (file.startsWith(prefix)) { hasFile = true; break }
    }
    if (!hasFile) entries.add(dir)
  }
  return entries
}

function entryKey(path, kind, dir) {
  return `${path}|${kind}${dir === true ? '|dir' : ''}`
}

// ── 端点脚手架（免网络直驱） ─────────────────────────────────────────────

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

// ── 主场景 ───────────────────────────────────────────────────────────────

async function runMultiScenario(bias, seed) {
  const workspace = await mkdtemp(join(tmpdir(), `chaos7-${bias}-`))
  const storageDir = await mkdtemp(join(tmpdir(), `chaos7-${bias}-store-`))
  const engine = new ShadowRewindEngine({ storageDir, turnCheckpointMode: 'sqlite' })
  await engine.ready
  const rand = mulberry32(seed)

  // 全局事实模型。
  const liveFiles = new Set(['hot.txt'])
  const trackedDirs = new Set()
  // 期望表：`${sessionId}|${turn}` → Map<path, entryKey>。
  const expected = new Map()
  // 触碰日志：每个事件改变了哪些树事实（路径粒度，含目录条目）。
  // 用于 live 轮断言：某会话末轮之后被其它会话再触碰的路径，归属上
  // 不再是该会话独有，端点会正确剔除——期望集必须同样剔除。
  const touchLog = []
  const lastEventIndex = new Map()
  let seqCounter = 0
  let eventIndex = -1

  try {
    await writeFile(join(workspace, 'hot.txt'), 'hot v0\n', 'utf8')

    const schedule = buildSchedule(bias)
    for (const event of schedule) {
      eventIndex += 1
      const { sessionId, turn } = event
      // 开轮捕获（全局唯一 seq；2ms 间隔保证 createdAt 有序）。
      seqCounter += 1
      await engine.createTurnCheckpoint({ cwd: workspace, sessionId, turn, turnStartSeq: seqCounter })
      await pause()

      // 轮内 n 次操作：全部发生在下一次开轮捕获之前（写入闸现实）。
      // 期望 = 本轮净变更：文件增/改/删 + 空目录条目的出现/消失。
      const dirsBefore = dirEntries(trackedDirs, liveFiles)
      const turnStartFiles = [...liveFiles]
      const turnExpected = new Map()
      const usedDirs = new Set()
      const nOps = 1 + Math.floor(rand() * 4)

      for (let op = 0; op < nOps; op += 1) {
        const tag = `${sessionId}-t${turn}-${op}`
        const roll = rand()
        if (roll < 0.34) {
          // 建文件：根目录或某个已跟踪目录内（每轮每个目录至多交互一次）。
          const candidates = [...trackedDirs].filter((dir) => !usedDirs.has(dir))
          const intoDir = rand() < 0.4 && candidates.length > 0
          const rel = intoDir
            ? `${candidates[Math.floor(rand() * candidates.length)]}/f-${tag}.txt`
            : `f-${tag}.txt`
          if (intoDir) usedDirs.add(rel.split('/').slice(0, -1).join('/'))
          const segments = rel.split('/')
          if (segments.length > 1) await mkdir(join(workspace, ...segments.slice(0, -1)), { recursive: true })
          await writeFile(join(workspace, ...segments), `content ${tag}\n`, 'utf8')
          liveFiles.add(rel)
          turnExpected.set(rel, entryKey(rel, 'added', false))
        } else if (roll < 0.56 && turnStartFiles.length > 0) {
          // 改文件：只动轮起时就存在的（含共享热文件，跨会话跨轮反复改）。
          const victim = turnStartFiles[Math.floor(rand() * turnStartFiles.length)]
          if (victim !== undefined && !turnExpected.has(victim)) {
            await writeFile(join(workspace, ...victim.split('/')), `mutated ${tag}\n`, 'utf8')
            turnExpected.set(victim, entryKey(victim, 'modified', false))
          }
        } else if (roll < 0.72 && turnStartFiles.length > 1) {
          // 删文件：可能把目录掏空（隐式目录条目由 before/after 差集自动算出）。
          const victims = turnStartFiles.filter((file) => !turnExpected.has(file))
          const victim = victims[Math.floor(rand() * victims.length)]
          if (victim !== undefined && victim !== 'hot.txt') {
            await rm(join(workspace, ...victim.split('/')))
            liveFiles.delete(victim)
            turnExpected.set(victim, entryKey(victim, 'deleted', false))
          }
        } else if (roll < 0.88) {
          // 建空目录（可能嵌套两层；两层都进跟踪集）。
          // 新建目录本轮内禁止再交互：若同轮往里写文件，目录条目会净消失，
          // 与「新增目录」的期望相矛盾（保持每轮每路径单一净效果）。
          const nested = rand() < 0.35
          const rel = nested ? `d-${tag}/leaf` : `d-${tag}`
          await mkdir(join(workspace, ...rel.split('/')), { recursive: true })
          for (const dir of nested ? [rel.split('/')[0], rel] : [rel]) {
            usedDirs.add(dir)
            if (!trackedDirs.has(dir)) {
              trackedDirs.add(dir)
              turnExpected.set(dir, entryKey(dir, 'added', true))
            }
          }
        } else {
          // 删空目录：只挑轮起时空、本轮没交互过、且没有子目录的叶子层
          // （rmdir 拒绝含子目录的目录，哪怕子目录也是空的）。
          const victims = [...dirsBefore].filter((dir) => !usedDirs.has(dir)
            && !turnExpected.has(dir)
            && ![...trackedDirs].some((other) => other.startsWith(`${dir}/`)))
          const victim = victims[Math.floor(rand() * victims.length)]
          if (victim !== undefined) {
            // 嵌套目录先删子再删父（只删当前仍是空的层级）。
            await rmdir(join(workspace, ...victim.split('/')))
            trackedDirs.delete(victim)
            turnExpected.set(victim, entryKey(victim, 'deleted', true))
          }
        }
      }

      // 隐式目录条目差集：掏空 → added(dir)，填实 → deleted(dir)。
      const dirsAfter = dirEntries(trackedDirs, liveFiles)
      for (const dir of dirsAfter) {
        if (!dirsBefore.has(dir)) turnExpected.set(dir, entryKey(dir, 'added', true))
      }
      for (const dir of dirsBefore) {
        if (!dirsAfter.has(dir) && !turnExpected.has(dir)) turnExpected.set(dir, entryKey(dir, 'deleted', true))
      }
      expected.set(`${sessionId}|${turn}`, turnExpected)
      for (const path of turnExpected.keys()) touchLog.push({ eventIndex, sessionId, path })
      lastEventIndex.set(sessionId, eventIndex)
    }

    // 端点核对：每个会话每一轮的识别结果与期望精确相等。
    const liveSessions = new Map(SESSIONS.map((session) => [
      session.id,
      { id: session.id, status: 'idle', session: { id: session.id, header: { cwd: workspace }, inheritedEventCount: 0, snapshotEvents: () => [] } },
    ]))
    const coordinator = new TurnCheckpointCoordinator(engine)
    const writeGate = new WorkspaceWriteGate({ canonicalDirectory, agents: { list: () => [] } })
    const handlers = makeHandlers(liveSessions, engine, coordinator, writeGate)

    // 归属感知的精确核对：端点结果 == 该会话该轮的真实净变更，减去归属
    // 范围（本会话相邻两次捕获之间的开区间；末轮延伸到时间线终点）内被
    // 其它会话再触碰过的路径——那些路径多主/它主，端点保守剔除是正确的。
    // 三条性质同时成立：无中生有零容忍（精度）、独占变更必上报（召回）、
    // 每一项剔除都能用「它主触碰」解释（剔除可解释）。
    const captureIndexOf = new Map()
    for (const [index, event] of schedule.entries()) {
      captureIndexOf.set(`${event.sessionId}|${event.turn}`, index)
    }
    const otherTouchInRange = (path, sessionId, lo, hi) => touchLog.some((touch) => touch.path === path
      && touch.sessionId !== sessionId
      && touch.eventIndex > lo
      && touch.eventIndex < hi)

    for (const session of SESSIONS) {
      const body = await callFsChanges(handlers, session.id)
      let expectedCount = session.turns
      for (let turn = 1; turn <= session.turns; turn += 1) {
        const wantRaw = expected.get(`${session.id}|${turn}`)
        const lo = captureIndexOf.get(`${session.id}|${turn}`) ?? -1
        const hi = turn < session.turns
          ? (captureIndexOf.get(`${session.id}|${turn + 1}`) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER
        const want = new Map()
        for (const [path, key] of wantRaw ?? []) {
          if (!otherTouchInRange(path, session.id, lo, hi)) want.set(path, key)
        }
        if (want.size === 0) {
          // 归属滤空：该轮的独占变更为空（全部路径被它主/多主触碰），
          // 端点不产出条目是正确行为。
          const absent = body.turns.find((entry) => entry.turn === turn)
          assert.ok(absent === undefined, `${session.id} 轮 ${turn}：滤空后不应有条目`)
          expectedCount -= 1
          continue
        }
        const turnEntry = body.turns.find((entry) => entry.turn === turn)
        if (turnEntry === undefined) {
          const diag = [...want.keys()].map((path) => {
            const touches = touchLog.filter((touch) => touch.path === path)
              .map((touch) => `${touch.sessionId}@${touch.eventIndex}`)
              .join(',')
            return `${path}（range ${lo},${hi}；touches: ${touches}）`
          }).join(' | ')
          assert.fail(`${session.id} 轮 ${turn}：端点必须有条目；want=[${diag}]；body.turns=[${body.turns.map((entry) => `${entry.turn}${entry.live === true ? 'L' : ''}`).join(',')}]`)
        }
        const got = new Map(turnEntry.changes.map((change) => [
          change.path,
          entryKey(change.path, change.kind, change.dir === true),
        ]))
        assert.deepEqual(
          [...got.entries()].sort(),
          [...want.entries()].sort(),
          `${session.id} 轮 ${turn}${turnEntry.live === true ? '（live）' : ''}：识别结果必须与该会话该轮的独占净变更精确相等`,
        )
      }
      assert.equal(body.turns.length, expectedCount, `${session.id}：条数 = 轮数（滤空的 live 轮除外）`)
    }

    return completionProfile(schedule)
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
  }
}

test('混沌（7 会话）：轮数多者先完成——每会话每轮变更被精确识别', async () => {
  await runMultiScenario('high-first', 777001)
})

test('混沌（7 会话）：轮数少者先完成——每会话每轮变更被精确识别', async () => {
  await runMultiScenario('low-first', 777002)
})

test('混沌（7 会话）：两种剧本的完成顺序确实相反', () => {
  const high = completionProfile(buildSchedule('high-first'))
  const low = completionProfile(buildSchedule('low-first'))
  // 轮数最多的 sC 与轮数最少的 sF：两种剧本里谁先完成必须互换。
  assert.ok(high['sC'] < high['sF'], 'high-first 剧本：7 轮的 sC 应先于 1 轮的 sF 完成')
  assert.ok(low['sF'] < low['sC'], 'low-first 剧本：1 轮的 sF 应先于 7 轮的 sC 完成')
})
