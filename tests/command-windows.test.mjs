/**
 * 命令窗口注册表测试：录制器在 tools/execute 瀑布包住 next() 打起止戳
 * （放行/裁决形短路/抛错/信号已中止四态）、子代理谱系解析到顶层会话、
 * 注册表修剪（超量/过期）与相交查询。
 * 不依赖 dsh 运行时——录制器只消费最小 ctx 面（effect + on）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
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
