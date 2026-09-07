/**
 * verify-host 装配门禁（ABSORB-RECALL 5.3，仿 dsh-recall-plugin 的
 * scripts/verify-host.mjs）：用真实 cordis `new Context()` 复刻生产装配
 * 路径——ctx.plugin(ShadowRewindService) 服务类 + 兄弟 fiber 提供的最小
 * 服务桩。补齐「单测直接驱动引擎/端点 handler」缺失的装配层验证：
 *   1. 服务类经真实 inject 门禁装配不抛（漏声明 → fiber pending → 断言超时红）；
 *   2. 全部 /shadow-rewind 端点已注册且 handler 可响应（status 端点走通
 *      统一 JSON 形状）；
 *   3. schemasty/dsh-settings 缺席宿主上 settings namespace 干净降级
 *      （装配不炸、config 端点 writable=false——真实宿主有 schemasty，
 *      installSection 分派路径由活体冒烟覆盖）；
 *   4. 卸载后 webServer 注册清零（HMR 无 module 级残留）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { ShadowRewindService, REWIND_HTTP_PATH } from '../lib/index.js'

const ENDPOINT_PATHS = [
  REWIND_HTTP_PATH,
  `${REWIND_HTTP_PATH}/file`,
  `${REWIND_HTTP_PATH}/fs-changes`,
  `${REWIND_HTTP_PATH}/trace`,
  `${REWIND_HTTP_PATH}/restore-undo`,
  `${REWIND_HTTP_PATH}/status`,
  `${REWIND_HTTP_PATH}/config`,
  `${REWIND_HTTP_PATH}/manage`,
  `${REWIND_HTTP_PATH}/lineage`,
]

function makeStubs(registered) {
  return (c) => {
    c.provide('webServer', {
      register(route) {
        registered.push(route)
        return () => {
          const index = registered.indexOf(route)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    })
    c.provide('sessions', { get: () => undefined })
    c.provide('sessionQuery', {
      readSession: async (id) => ({ session: { id, cwd: undefined }, inheritedEventCount: 0, events: [] }),
    })
    c.provide('sessionController', {
      create: async () => ({ sessionId: 'stub' }),
      fork: async () => ({ sessionId: 'stub' }),
    })
    c.provide('agents', { list: () => [], get: () => undefined })
    c.provide('commands', { register: () => () => {} })
    // settings 桩：installSection 被调即记录（schemasty 缺席时桥提前降级，
    // 不会走到这里——用计数断言降级语义）。
    const stub = {
      installed: 0,
      describe() { return [] },
      writable: true,
      async update() {},
      async replace() {},
      installSection() { stub.installed += 1 },
    }
    c.provide('settings', stub)
    return stub
  }
}

test('verify-host：真实 cordis 装配、端点注册与响应、settings 降级、卸载清零', { timeout: 30_000 }, async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-verify-'))
  const registered = []
  const ctx = new Context()
  let settingsStub
  try {
    // 兄弟 fiber 提供服务桩（复刻生产拓扑：未声明服务不可解析）。
    await ctx.plugin({ name: 'verify-host-stubs', apply(c) { settingsStub = makeStubs(registered)(c) } }, {})
    // 生产同款装配：服务类 + 配置（临时存储根，不碰用户真实数据）。
    // await 返回 fiber；fiber.dispose() 是 cordis 4 的卸载原语。
    const pluginFiber = await ctx.plugin(ShadowRewindService, { storageDir, turnCheckpointMode: 'sqlite' })

    // 端点全部注册。
    for (const path of ENDPOINT_PATHS) {
      assert.ok(registered.some((route) => route.path === path), `端点 ${path} 必须注册`)
    }
    // schemasty 不在本机 devDeps：桥降级，settings.installSection 不应被调。
    assert.equal(settingsStub.installed, 0, 'schemasty 缺席时 settings namespace 干净降级')

    // status 端点可响应（GET 走通统一 JSON 形状 + 后端健康度）。
    const statusRoute = registered.find((route) => route.path === `${REWIND_HTTP_PATH}/status`)
    const status = { code: 0, body: '' }
    await statusRoute.handler({
      method: 'GET',
      url: `${REWIND_HTTP_PATH}/status`,
      socket: { remoteAddress: '127.0.0.1' },
    }, {
      writeHead(code, headers) { status.code = code },
      end(body) { status.body = body ?? '' },
      on() {},
    })
    assert.equal(status.code, 200)
    const body = JSON.parse(status.body)
    assert.equal(body.backend.effective, 'sqlite')
    assert.deepEqual(body.errors, [], '新装配错误历史为空')

    // config 端点降级为只读（writable=false），不炸。
    const configRoute = registered.find((route) => route.path === `${REWIND_HTTP_PATH}/config`)
    const config = { code: 0, body: '' }
    await configRoute.handler({
      method: 'GET',
      url: `${REWIND_HTTP_PATH}/config`,
      socket: { remoteAddress: '127.0.0.1' },
    }, {
      writeHead(code) { config.code = code },
      end(payload) { config.body = payload ?? '' },
      on() {},
    })
    assert.equal(config.code, 200)
    assert.equal(JSON.parse(config.body).writable, false)

    // 卸载清零：webServer 注册随 fiber 销毁全部注销。
    await pluginFiber.dispose()
    assert.equal(registered.length, 0, '卸载后端点注册必须清零')
  } finally {
    await rm(storageDir, { recursive: true, force: true })
  }
})
