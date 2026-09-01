/**
 * 命令窗口注册表测试：录制器在 tools/execute 瀑布包住 next() 打起止戳
 * （放行/裁决形短路/抛错/信号已中止四态）、子代理谱系解析到顶层会话、
 * 注册表修剪（超量/过期）与相交查询。
 * 不依赖 dsh 运行时——录制器只消费最小 ctx 面（effect + on）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CommandWindowRegistry, installCommandWindowRecorder, topLevelSessionOf } from '../lib/command-windows.js'

const WORKSPACE = '/tmp/cw-workspace'

function agent(id, cwd = WORKSPACE, parentSession) {
  return {
    id,
    session: {
      header: { cwd, ...(parentSession === undefined ? {} : { parentSession }) },
    },
  }
}

function makeRegistry() {
  return new CommandWindowRegistry({ canonicalDirectory: async (path) => path })
}

/** 最小 ctx 面：effect 立即执行注册回调，on 记录单一监听器。 */
function makeCtx() {
  const handlers = {}
  return {
    handlers,
    effect(fn) { fn() },
    on(event, listener) {
      handlers[event] = listener
      return () => { delete handlers[event] }
    },
  }
}

async function runRecorder({ exec, next = async () => undefined, sessions }) {
  const registry = makeRegistry()
  const ctx = makeCtx()
  installCommandWindowRecorder(ctx, registry, () => sessions)
  const result = await ctx.handlers['tools/execute'](exec, next)
  const windows = await registry.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  return { result, windows }
}

test('放行调用被记录：窗口闭合且字段齐整', async () => {
  const { result, windows } = await runRecorder({
    exec: { name: 'bash', callId: 'call-1', agent: agent('s1') },
  })
  assert.equal(result, undefined)
  assert.equal(windows.length, 1)
  const window = windows[0]
  assert.equal(window.sessionId, 's1')
  assert.equal(window.agentId, 's1')
  assert.equal(window.tool, 'bash')
  assert.equal(window.callId, 'call-1')
  assert.ok(window.startedAt <= window.endedAt)
})

test('裁决形短路不记录（工具未执行的兜底），且裁决原样透传', async () => {
  const deny = { kind: 'deny', reason: '被写入闸拒绝' }
  const { result, windows } = await runRecorder({
    exec: { name: 'bash', agent: agent('s1') },
    next: async () => deny,
  })
  assert.equal(result, deny)
  assert.equal(windows.length, 0)
})

test('信号已中止的调用不记录（工具体前短路），结果照常透传', async () => {
  const abortedResult = { content: [], isError: true }
  const { result, windows } = await runRecorder({
    exec: { name: 'bash', agent: agent('s1'), signal: { aborted: true } },
    next: async () => abortedResult,
  })
  assert.equal(result, abortedResult)
  assert.equal(windows.length, 0, '未执行的调用绝不产生窗口')
})

test('next() 抛错仍记录（保守召回），并把错误继续上抛', async () => {
  const registry = makeRegistry()
  const ctx = makeCtx()
  installCommandWindowRecorder(ctx, registry, () => undefined)
  await assert.rejects(
    () => ctx.handlers['tools/execute'](
      { name: 'bash', agent: agent('s1') },
      async () => { throw new Error('boom') },
    ),
    /boom/,
  )
  const windows = await registry.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(windows.length, 1, '抛错的调用也必须留下窗口')
})

test('缺 agent / 缺 cwd 的调用静默跳过，结果照常透传', async () => {
  const sentinel = { kind: 'accept' }
  const noAgent = await runRecorder({ exec: { name: 'bash' }, next: async () => sentinel })
  assert.equal(noAgent.windows.length, 0)
  assert.equal(noAgent.result, sentinel)
  const noCwd = await runRecorder({ exec: { name: 'bash', agent: { id: 'x', session: { header: {} } } } })
  assert.equal(noCwd.windows.length, 0)
})

test('子代理谱系解析到顶层会话（多层上溯）', async () => {
  const top = agent('top-1')
  const mid = agent('mid-1', WORKSPACE, 'top-1')
  const leaf = agent('leaf-1', WORKSPACE, 'mid-1')
  const byId = new Map([['top-1', top], ['mid-1', mid], ['leaf-1', leaf]])
  const sessions = { get: (id) => byId.get(id) }

  const { windows } = await runRecorder({
    exec: { name: 'bash', agent: leaf },
    sessions,
  })
  assert.equal(windows.length, 1)
  assert.equal(windows[0].sessionId, 'top-1', '归因必须落在顶层会话')
  assert.equal(windows[0].agentId, 'leaf-1', '实际发起者保留为 agentId')
})

test('谱系断链/环安全：停在最深已声明祖先，不死循环', () => {
  // 断链：父会话不可解析，但 header 已指名它——归因停在声明处（'missing'），
  // 绝不把子代理误当顶层会话。
  const orphan = agent('orphan', WORKSPACE, 'missing')
  assert.equal(topLevelSessionOf(orphan, { get: () => undefined }), 'missing')

  const cyclicA = agent('cyc-a', WORKSPACE, 'cyc-b')
  const cyclicB = agent('cyc-b', WORKSPACE, 'cyc-a')
  const byId = new Map([['cyc-a', cyclicA], ['cyc-b', cyclicB]])
  const sessions = { get: (id) => byId.get(id) }
  const top = topLevelSessionOf(cyclicA, sessions)
  assert.ok(top === 'cyc-a' || top === 'cyc-b', '环上停在最后访问的祖先')
})

test('无 sessions 查找面时停在声明的父会话（降级语义）', () => {
  const child = agent('child', WORKSPACE, 'top-1')
  assert.equal(topLevelSessionOf(child, undefined), 'top-1')
})

test('修剪：过期条目（6h 保留期）随新记录被清除', async () => {
  const registry = makeRegistry()
  const now = Date.now()
  const sixHours = 6 * 60 * 60 * 1000
  await registry.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - sixHours - 2000, endedAt: now - sixHours - 1000 })
  await registry.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - 1000, endedAt: now })
  const windows = await registry.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(windows.length, 1, '过期窗口必须被修剪')
  assert.equal(windows[0].endedAt, now)
})

test('修剪：超过 2000 条上限时保留最新', async () => {
  const registry = makeRegistry()
  const base = Date.now()
  for (let i = 0; i < 2005; i += 1) {
    await registry.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: base + i, endedAt: base + i + 1 })
  }
  const windows = await registry.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(windows.length, 2000)
  assert.equal(windows[windows.length - 1].endedAt, base + 2005, '保留的必须是最新条目')
})

test('相交查询为闭区间：端点相接也算相交', async () => {
  const registry = makeRegistry()
  await registry.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: 100, endedAt: 200 })
  assert.equal((await registry.windowsOverlapping(WORKSPACE, 150, 250)).length, 1, '部分重叠')
  assert.equal((await registry.windowsOverlapping(WORKSPACE, 200, 300)).length, 1, '端点相接（闭区间）')
  assert.equal((await registry.windowsOverlapping(WORKSPACE, 0, 100)).length, 1, '起点相接（闭区间）')
  assert.equal((await registry.windowsOverlapping(WORKSPACE, 201, 300)).length, 0, '完全在外')
  assert.equal((await registry.windowsOverlapping('/tmp/other-workspace', 0, 1000)).length, 0, '工作区隔离')
})

// ── 持久化（路线 A：重启后归因不降级） ────────────────────────────────

function persistRegistry(storageDir) {
  return new CommandWindowRegistry({ canonicalDirectory: async (path) => path, storageDir })
}

/** 定位该工作区唯一的落盘文件（测试里每目录只记录一个工作区）。 */
async function onlyWindowFile(storageDir) {
  const dir = join(storageDir, 'command-windows')
  const files = (await readdir(dir)).filter(name => name.endsWith('.json'))
  assert.equal(files.length, 1)
  return join(dir, files[0])
}

test('持久化往返：重启后窗口字段保真（含可选 callId）', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'cw-persist-'))
  // 时间戳必须在保留期内（加载即修剪），用真实时刻为基准。
  const now = Date.now()
  const first = persistRegistry(storageDir)
  await first.record(WORKSPACE, { sessionId: 's1', agentId: 'a1', tool: 'bash', callId: 'call-1', startedAt: now - 5000, endedAt: now - 4000 })
  await first.record(WORKSPACE, { sessionId: 's2', agentId: 's2', tool: 'powershell', startedAt: now - 3000, endedAt: now - 2500 })
  await first.flushPending()

  const second = persistRegistry(storageDir)
  const windows = await second.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(windows.length, 2)
  assert.deepEqual(windows[0], { sessionId: 's1', agentId: 'a1', tool: 'bash', callId: 'call-1', startedAt: now - 5000, endedAt: now - 4000 })
  assert.deepEqual(windows[1], { sessionId: 's2', agentId: 's2', tool: 'powershell', startedAt: now - 3000, endedAt: now - 2500 })
  assert.equal(windows[1].callId, undefined, '无 callId 的窗口落盘后不得多出字段')
})

test('损坏的记录文件：静默从空开始，后续记录照常重写', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'cw-corrupt-'))
  const now = Date.now()
  const first = persistRegistry(storageDir)
  await first.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - 5000, endedAt: now - 4000 })
  await first.flushPending()
  await writeFile(await onlyWindowFile(storageDir), 'not-json')

  const second = persistRegistry(storageDir)
  assert.equal((await second.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)).length, 0, '损坏不得泄漏任何数据')
  await second.record(WORKSPACE, { sessionId: 's2', agentId: 's2', tool: 'bash', startedAt: now - 3000, endedAt: now - 2000 })
  await second.flushPending()

  const third = persistRegistry(storageDir)
  const windows = await third.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].sessionId, 's2', '损坏后的重写只含新记录')
})

test('版本不符：视为损坏从空开始', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'cw-version-'))
  const now = Date.now()
  const first = persistRegistry(storageDir)
  await first.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - 5000, endedAt: now - 4000 })
  await first.flushPending()
  const file = await onlyWindowFile(storageDir)
  const payload = JSON.parse(await readFile(file, 'utf8'))
  await writeFile(file, JSON.stringify({ ...payload, version: payload.version + 1 }))

  // 时间戳在保留期内：若版本守卫失效，窗口会被加载出来（区分守卫与修剪）。
  const second = persistRegistry(storageDir)
  assert.equal((await second.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)).length, 0)
})

test('跨重启修剪：加载即按保留期淘汰过期窗口（6h）', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'cw-restart-'))
  const now = Date.now()
  const sevenHours = 7 * 60 * 60 * 1000
  const first = persistRegistry(storageDir)
  // 先新后旧：以旧窗口为基准的 in-memory 修剪会两者都保留，确保旧条目真的落了盘。
  await first.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - 1000, endedAt: now })
  await first.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - sevenHours - 2000, endedAt: now - sevenHours - 1000 })
  await first.flushPending()

  const second = persistRegistry(storageDir)
  const windows = await second.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(windows.length, 1, '过期窗口不得跨重启复活')
  assert.equal(windows[0].endedAt, now)
})

test('懒加载缓冲合并顺序：磁盘在前、缓冲在后', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'cw-buffer-'))
  const now = Date.now()
  const first = persistRegistry(storageDir)
  await first.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - 5000, endedAt: now - 4000 })
  await first.flushPending()

  const second = persistRegistry(storageDir)
  // 新实例刚起步（懒加载未完成）就写入，随后立即查询。
  await second.record(WORKSPACE, { sessionId: 's2', agentId: 's2', tool: 'bash', startedAt: now - 3000, endedAt: now - 2000 })
  const windows = await second.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.deepEqual(windows.map(w => w.sessionId), ['s1', 's2'], '磁盘记录必须先于缓冲记录')
})

// ── 可调参数（用户自定义防抖/保留期/上限/内容） ────────────────────────

test('自定义保留期：短保留期下旧窗口随新记录被修剪', async () => {
  const registry = new CommandWindowRegistry({
    canonicalDirectory: async (path) => path,
    retentionMs: 60_000,
  })
  const now = Date.now()
  await registry.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - 120_000, endedAt: now - 119_000 })
  await registry.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - 1000, endedAt: now })
  const windows = await registry.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(windows.length, 1, '默认保留期 6h 内的旧窗口在 1 分钟保留期下必须被修剪')
  assert.equal(windows[0].endedAt, now)
})

test('自定义上限：每工作区窗口条数按配置修剪', async () => {
  const registry = new CommandWindowRegistry({
    canonicalDirectory: async (path) => path,
    maxPerWorkspace: 3,
  })
  const base = Date.now()
  for (let i = 0; i < 5; i += 1) {
    await registry.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: base + i * 10, endedAt: base + i * 10 + 5 })
  }
  const windows = await registry.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(windows.length, 3)
  assert.deepEqual(windows.map(w => w.startedAt), [base + 20, base + 30, base + 40], '保留最新的三条')
})

test('自定义防抖：短防抖时长内自动落盘（无需冲刷）', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'cw-flush-'))
  const registry = new CommandWindowRegistry({
    canonicalDirectory: async (path) => path,
    storageDir,
    flushMs: 10,
  })
  const now = Date.now()
  await registry.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', startedAt: now - 1000, endedAt: now })
  // 10ms 防抖 + 原子写；80ms 宽限在高负载下仍充裕。
  await new Promise((resolve) => setTimeout(resolve, 80))
  const file = await onlyWindowFile(storageDir)
  const payload = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(payload.windows.length, 1, '防抖到期后窗口必须已落盘')
})

test('窗口内容：参数序列化、字节截断、0 关闭、不可序列化兜底', () => {
  const plain = new CommandWindowRegistry({ canonicalDirectory: async (path) => path })
  assert.equal(plain.captureDetail({ command: 'ls -la' }), '{"command":"ls -la"}')
  assert.equal(plain.captureDetail(undefined), undefined)

  const tiny = new CommandWindowRegistry({ canonicalDirectory: async (path) => path, detailBytes: 8 })
  const truncated = tiny.captureDetail({ command: 'a very long command line' })
  assert.ok(Buffer.byteLength(truncated, 'utf8') <= 8, '截断后不得超过字节上限')

  const off = new CommandWindowRegistry({ canonicalDirectory: async (path) => path, detailBytes: 0 })
  assert.equal(off.captureDetail({ command: 'ls' }), undefined, 'detailBytes=0 不记录内容')

  const circular = {}
  circular.self = circular
  assert.equal(plain.captureDetail(circular), undefined, '不可序列化参数静默跳过，不抛错')
})

test('录制器采集窗口内容：工具参数随窗口记录', async () => {
  const { windows } = await runRecorder({
    exec: { name: 'bash', agent: agent('s1'), arguments: { command: 'echo hi' } },
  })
  assert.equal(windows.length, 1)
  assert.equal(windows[0].detail, '{"command":"echo hi"}')

  const noArgs = await runRecorder({ exec: { name: 'bash', agent: agent('s1') } })
  assert.equal(noArgs.windows[0].detail, undefined, '无参数时不得伪造内容')
})

test('窗口内容持久化往返：重启后 detail 保真', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'cw-detail-'))
  const now = Date.now()
  const first = persistRegistry(storageDir)
  await first.record(WORKSPACE, { sessionId: 's1', agentId: 's1', tool: 'bash', detail: '{"command":"pnpm build"}', startedAt: now - 5000, endedAt: now - 4000 })
  await first.flushPending()

  const second = persistRegistry(storageDir)
  const windows = await second.windowsOverlapping(WORKSPACE, 0, Number.MAX_SAFE_INTEGER)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].detail, '{"command":"pnpm build"}')
})
