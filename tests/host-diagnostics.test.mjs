/**
 * 宿主诊断面测试（ABSORB-RECALL 2.1/2.2/2.3）：环境错误分类、最近错误
 * 环形缓冲、/shadow-rewind/status 端点、检查点熔断与退避。
 * 熔断用注入失败的引擎桩驱动（不落盘）；status 端点用模拟 webServer
 * 直接驱动 handler（与 fs-changes.test.mjs 同一模式，不起网络）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ShadowRewindError } from '../lib/index.js'
import {
  classifyEnvError,
  ENV_HINTS,
  ERROR_BUFFER_MAX,
  HostErrorLog,
  fuseBackoffMs,
  installShadowRewindHttp,
  TurnCheckpointCoordinator,
} from '../lib/rewind-host.js'

test('diagnostics：五类环境错误识别与根因优先级', () => {
  // jj CLI 缺失：node spawn 与两平台 shell 措辞都要命中。
  assert.equal(classifyEnvError('jj status 在 "C:\\x" 失败：spawn jj ENOENT'), 'jj')
  assert.equal(classifyEnvError('sh: jj: command not found'), 'jj')
  assert.equal(classifyEnvError("'jj' is not recognized as an internal or external command"), 'jj')
  // 磁盘满：errno 与措辞。
  assert.equal(classifyEnvError('ENOSPC: no space left on device, write'), 'space')
  assert.equal(classifyEnvError('disk quota exceeded'), 'space')
  // 权限。
  assert.equal(classifyEnvError("EACCES: permission denied, open 'C:\\x\\y'"), 'permission')
  assert.equal(classifyEnvError('EPERM: operation not permitted'), 'permission')
  // 锁：SQLite 与 jj/git 措辞（注意 .lock 前必须有点——jj/git 锁文件惯名）。
  assert.equal(classifyEnvError('SQLITE_BUSY: database is locked'), 'lock')
  assert.equal(classifyEnvError("unable to create 'C:\\x\\repo\\index.lock': File exists"), 'lock')
  // mkdir。
  assert.equal(classifyEnvError("EEXIST: file already exists, mkdir 'C:\\x'"), 'mkdir')
  assert.equal(classifyEnvError('mkdir: cannot create directory'), 'mkdir')
  // 未识别回落 null（保现状原文，不误分类）。
  assert.equal(classifyEnvError('some unrelated failure'), null)
  assert.equal(classifyEnvError(''), null)
})

test('diagnostics：磁盘满优先于锁/权限（根因优先级）', () => {
  // 锁文件写入报 ENOSPC：磁盘满是根因，锁只是表象。
  assert.equal(classifyEnvError("unable to create '.jj/repo/index.lock': No space left on device"), 'space')
  assert.equal(classifyEnvError('EACCES: permission denied, write ... ENOSPC: no space left on device'), 'space')
})

test('diagnostics：每类提示都存在、简短且不带路径', () => {
  const kinds = ['jj', 'space', 'permission', 'lock', 'mkdir']
  for (const kind of kinds) {
    const hint = ENV_HINTS[kind]
    assert.equal(typeof hint, 'string')
    assert.ok(hint.length >= 8 && hint.length <= 140, `提示长度越界：${hint}`)
    assert.ok(!hint.includes('\\') && !hint.includes('/'), `提示不得嵌路径：${hint}`)
  }
})

test('error-log：相邻去重计数、间隔重复新建、上限淘汰、清空', () => {
  const log = new HostErrorLog()
  log.push('boom A')
  log.push('boom A')
  log.push('boom B')
  log.push('boom A')
  const list = log.list()
  assert.deepEqual(list.map((entry) => [entry.message, entry.count]), [
    ['boom A', 1],
    ['boom B', 1],
    ['boom A（×2）', 2],
  ], '最新在前；相邻重复合并为（×N），间隔重复不合并')
  assert.equal(list[0].hint, null, '未分类错误 hint 为 null')

  // 上限：超出淘汰最旧，只留最近 ERROR_BUFFER_MAX 条。
  for (let index = 0; index < ERROR_BUFFER_MAX + 5; index += 1) log.push(`unique-${String(index)}`)
  assert.equal(log.list().length, ERROR_BUFFER_MAX)
  assert.equal(log.list()[0].message, `unique-${String(ERROR_BUFFER_MAX + 4)}`, '最新条目在头部')

  log.clear()
  assert.deepEqual(log.list(), [])
  const sizeBeforeEmptyPush = log.list().length
  log.push('')
  assert.equal(log.list().length, sizeBeforeEmptyPush, '空串 push 是 no-op（不占条目）')
})

test('error-log：分类 hint 随条目富集', () => {
  const log = new HostErrorLog()
  // 先 push 未分类再 push 分类：list 最新在前，first 应为分类条目。
  log.push(' totally unknown ')
  log.push("EACCES: permission denied, open 'x'")
  const [first, unknown] = log.list()
  assert.equal(first.hint, ENV_HINTS.permission, '命中即给可行动提示')
  assert.equal(unknown.hint, null)
  assert.equal(unknown.message, ' totally unknown ', '未分类保原文（含空白，不静默改写）')
})

function makeStatusHandlers(engine, coordinator) {
  const handlers = new Map()
  installShadowRewindHttp({
    logger: { warn: () => {} },
    sessions: { get: () => undefined },
    sessionQuery: { readSession: async (id) => ({ session: { id }, inheritedEventCount: 0, events: [] }) },
    sessionController: { create: async () => ({ sessionId: 'x' }), fork: async () => ({ sessionId: 'x' }) },
    agents: { list: () => [] },
    webServer: { register(route) { handlers.set(route.path, route.handler); return () => {} } },
  }, engine, coordinator)
  return handlers
}

async function callStatus(handlers, method, body) {
  const handler = handlers.get('/shadow-rewind/status')
  const status = { code: 0, body: '' }
  const response = {
    writeHead(code) { status.code = code },
    end(payload) { status.body = payload ?? '' },
    on() {},
  }
  await handler({
    method,
    url: '/shadow-rewind/status',
    socket: { remoteAddress: '127.0.0.1' },
    ...(body === undefined ? {} : {
      on(event, listener) {
        if (event === 'data') listener(Buffer.from(body))
        if (event === 'end') listener()
      },
    }),
  }, response)
  return { code: status.code, body: JSON.parse(status.body) }
}

test('status 端点：GET 返回后端健康度与最近错误；POST clear 清空', async () => {
  const engine = { effectiveBackend: 'sqlite', downgradeReason: '宿主机没有可用的 jj CLI，自动检查点已降级为内置 SQLite 存储' }
  const coordinator = new TurnCheckpointCoordinator(engine)
  const handlers = makeStatusHandlers(engine, coordinator)

  const got = await callStatus(handlers, 'GET')
  assert.equal(got.code, 200)
  assert.equal(got.body.backend.effective, 'sqlite')
  assert.equal(got.body.backend.downgradeReason, engine.downgradeReason, '降级原因经 status 可见（2.4 的 UI 可见性缺口）')
  assert.equal(got.body.errors.length, 1, '降级原因进最近错误历史')
  assert.ok(got.body.errors[0].message.includes('jj CLI'))

  coordinator.errorLog.push('EACCES: permission denied, open')
  const afterPush = await callStatus(handlers, 'GET')
  assert.equal(afterPush.body.errors[0].hint, ENV_HINTS.permission)

  const cleared = await callStatus(handlers, 'POST', JSON.stringify({ op: 'clear' }))
  assert.equal(cleared.code, 200)
  assert.deepEqual(cleared.body.errors, [])
  const empty = await callStatus(handlers, 'GET')
  assert.deepEqual(empty.body.errors, [])

  const bad = await callStatus(handlers, 'POST', JSON.stringify({ op: 'other' }))
  assert.equal(bad.code, 409)
  assert.equal(bad.body.code, 'INVALID_ARGUMENTS')

  // 非回环一律 403（与其余端点同一安全边界）。
  const handler = handlers.get('/shadow-rewind/status')
  const status = { code: 0 }
  await handler({ method: 'GET', url: '/shadow-rewind/status', socket: { remoteAddress: '10.0.0.1' } }, {
    writeHead(code) { status.code = code },
    end() {},
    on() {},
  })
  assert.equal(status.code, 403)
})

/** 熔断测试的引擎桩：createTurnCheckpoint 可编程失败/成功。 */
function stubEngine(createTurnCheckpoint) {
  return {
    config: { turnCheckpointTimeoutMs: 5000 },
    turnCheckpointsDisabled: false,
    downgradeReason: undefined,
    recordTurnCheckpointSkip: async () => {},
    createTurnCheckpoint,
  }
}

function stubAgent(cwd) {
  return {
    id: 's1',
    status: 'idle',
    session: {
      id: 's1',
      header: { cwd },
      // turn 0..19 全部有 turn/start 事件：熔断测试用多轮编号，缺 start
      // 会走「找不到 turn/start」的失败分支而非真实捕获路径。
      snapshotEvents: () => Array.from({ length: 20 }, (_, index) => ({ type: 'turn/start', seq: index + 1, data: { turn: index } })),
    },
  }
}

const silentCtx = { logger: { info() {}, warn() {}, error() {} } }

test('熔断：fuseBackoffMs 退避数值（3 次起步翻倍、60min 封顶）', () => {
  assert.equal(fuseBackoffMs(0), 0)
  assert.equal(fuseBackoffMs(2), 0, '未达阈值不熔断')
  assert.equal(fuseBackoffMs(3), 5 * 60 * 1000, '第 3 次失败 5 分钟起步')
  assert.equal(fuseBackoffMs(4), 10 * 60 * 1000)
  assert.equal(fuseBackoffMs(5), 20 * 60 * 1000)
  assert.equal(fuseBackoffMs(10), 60 * 60 * 1000, '封顶 60 分钟')
})

test('熔断：连续 3 次失败后跳过捕获，冷却期满自动重试', async () => {
  let calls = 0
  const coordinator = new TurnCheckpointCoordinator(stubEngine(async () => {
    calls += 1
    throw new Error('EACCES: permission denied, write')
  }))
  const agent = stubAgent('C:\\ws\\fuse')

  await coordinator.capture(silentCtx, agent, 1, new AbortController().signal)
  await coordinator.capture(silentCtx, agent, 2, new AbortController().signal)
  assert.equal(coordinator.state('s1', 2).status, 'failed', '未达阈值照常失败')

  await coordinator.capture(silentCtx, agent, 3, new AbortController().signal)
  assert.equal(calls, 3)
  assert.ok(coordinator.errorLog.list().some((entry) => entry.message.includes('连续失败 3 次')), '熔断跳变沿记公告')

  // 冷却期内：连引擎都不再被调，状态面给 skipped + 剩余分钟数。
  await coordinator.capture(silentCtx, agent, 4, new AbortController().signal)
  await coordinator.capture(silentCtx, agent, 5, new AbortController().signal)
  assert.equal(calls, 3, '熔断期内不得发起捕获')
  const skipped = coordinator.state('s1', 5)
  assert.equal(skipped.status, 'skipped')
  assert.ok(skipped.reason.includes('熔断'), `解释文本可见：${skipped.reason}`)

  // 冷却期满（把时钟拨过 skipUntil）：恢复尝试；改好环境后成功即全部复位。
  const realNow = Date.now
  Date.now = () => realNow() + 6 * 60 * 1000
  try {
    await coordinator.capture(silentCtx, agent, 6, new AbortController().signal)
    assert.equal(calls, 4, '冷却期满必须自动重试')
    const failing = coordinator.state('s1', 6)
    assert.equal(failing.status, 'failed')
  } finally {
    Date.now = realNow
  }
})

test('熔断：成功一次全部复位，历史失败不再累计', async () => {
  let fail = true
  let calls = 0
  const coordinator = new TurnCheckpointCoordinator(stubEngine(async () => {
    calls += 1
    if (fail) throw new Error('ENOSPC: no space left on device, write')
  }))
  const agent = stubAgent('C:\\ws\\reset')

  await coordinator.capture(silentCtx, agent, 1, new AbortController().signal)
  await coordinator.capture(silentCtx, agent, 2, new AbortController().signal)
  // 修好环境（清了磁盘）：成功一次复位熔断计数。
  fail = false
  await coordinator.capture(silentCtx, agent, 3, new AbortController().signal)
  assert.equal(coordinator.state('s1', 3).status, 'missing', '成功轮无失败状态')
  // 环境再坏：必须重新数满 3 次才熔断（历史计数已清零）。
  fail = true
  await coordinator.capture(silentCtx, agent, 4, new AbortController().signal)
  await coordinator.capture(silentCtx, agent, 5, new AbortController().signal)
  assert.equal(calls, 5, '两次失败未达新阈值，不得熔断')
  await coordinator.capture(silentCtx, agent, 6, new AbortController().signal)
  assert.equal(calls, 6, '第三次失败触发新熔断')
  await coordinator.capture(silentCtx, agent, 7, new AbortController().signal)
  assert.equal(calls, 6, '熔断期内跳过')

  // 各工作区独立计数：另一工作区不受影响。
  await coordinator.capture(silentCtx, stubAgent('C:\\ws\\other'), 1, new AbortController().signal)
  assert.equal(calls, 7, '新工作区独立发起捕获')
})

test('熔断：轮末捕获同权推进熔断，跳过码（超时）不计入', async () => {
  // 轮末失败 3 次 → 轮起捕获被熔断跳过。
  let endCalls = 0
  const failingEngine = stubEngine(async (options) => {
    if (options.phase === 'end') {
      endCalls += 1
      throw new Error('ENOSPC: no space left on device, write')
    }
    return { id: `turn-${String(options.turn)}` }
  })
  const coordinator = new TurnCheckpointCoordinator(failingEngine)
  const session = {
    id: 's1',
    header: { cwd: 'C:\\ws\\end' },
    snapshotEvents: () => Array.from({ length: 20 }, (_, index) => ({ type: 'turn/start', seq: index + 1, data: { turn: index } })),
  }
  const makeEnd = (turn) => ({ type: 'turn/end', seq: 10 + turn, data: { turn } })

  await coordinator.captureEnd(silentCtx, session, makeEnd(1))
  await coordinator.captureEnd(silentCtx, session, makeEnd(2))
  await coordinator.captureEnd(silentCtx, session, makeEnd(3))
  assert.equal(endCalls, 3)
  await coordinator.capture(silentCtx, stubAgent('C:\\ws\\end'), 4, new AbortController().signal)
  assert.equal(coordinator.state('s1', 4).status, 'skipped', '轮末失败同样触发熔断，轮起被跳过')

  // 跳过码不计入：连续超时（可预期跳过）不熔断。
  let timeoutCalls = 0
  const timeoutCoordinator = new TurnCheckpointCoordinator(stubEngine(async () => {
    timeoutCalls += 1
    throw new ShadowRewindError('TURN_CHECKPOINT_TIMEOUT', 'deadline exceeded')
  }))
  const agent = stubAgent('C:\\ws\\timeout')
  for (const turn of [1, 2, 3, 4, 5]) {
    await timeoutCoordinator.capture(silentCtx, agent, turn, new AbortController().signal)
  }
  assert.equal(timeoutCalls, 5, '跳过码不得推进熔断（每轮照常尝试）')
  const failed = timeoutCoordinator.state('s1', 5)
  assert.equal(failed.status, 'skipped', '超时按既有语义进 skips')
})
