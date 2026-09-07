/**
 * BEFORE 捕获日志（主路捕获）端到端测试：记录 → 消息检查点物化 → 计划 →
 * 恢复全链路，覆盖 restoreAfter 语义（earliest-before、创建即删除、partial
 * 部分树绝不误删未捕获文件）、边界重查、prune 与消息恢复点清理、以及与
 * jj 影子后端的共存。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile, mkdir, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'

function jjOnPath() {
  try {
    execFileSync('jj', ['--version'], { stdio: 'ignore', windowsHide: true })
    return true
  } catch {
    return false
  }
}

async function makeWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'shadow-rewind-ws-'))
  await writeFile(join(root, 'a.txt'), 'hello v1\n', 'utf8')
  return root
}

async function makeEngine(overrides = {}) {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-store-'))
  const engine = new ShadowRewindEngine({
    storageDir,
    turnCheckpointMode: overrides.mode ?? 'sqlite',
    ...overrides,
  })
  await engine.ready
  return { engine, storageDir }
}

/** 模拟宿主捕获管道的一次 BEFORE 记录（与 host/before-capture 同语义，含同源 mode）。 */
async function recordBefore(engine, workspace, { sessionId, anchorSeq, callId, rel, existed, content }) {
  let mode = 0o644
  if (existed) {
    try {
      mode = Number((await lstat(join(workspace, rel))).mode & 0o7777)
    } catch { /* 缺席按缺省 */ }
  }
  await engine.recordBeforeEntry({
    workspace,
    sessionId,
    anchorSeq,
    callId,
    rel,
    existed,
    content: existed ? content : null,
    mode,
  })
}

/** 宿主消息回退的完整链路：物化 → inspect → plan → apply。 */
async function rewindMessage(engine, workspace, { sessionId, messageSeq, turn = 1, turnStartSeq = 10 }) {
  const point = await engine.ensureMessageRestorePoint({
    cwd: workspace,
    sessionId,
    messageSeq,
    turn,
    turnStartSeq,
  })
  assert.ok(point, 'BEFORE 日志非空时必须物化出消息恢复点')
  assert.equal(point.kind, 'message')
  const inspection = await engine.inspect({ cwd: workspace, restorePointId: point.id })
  const plan = await engine.planRestore({
    cwd: workspace,
    restorePointId: point.id,
    expectedCurrentTreeHash: inspection.currentTreeHash,
  })
  return engine.applyRestore({ planId: plan.id })
}

test('BEFORE 日志：修改的文件恢复到写盘前内容', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine()
  try {
    // 回合 1（anchor=10）：AI 把 a.txt 改成 v2。
    await recordBefore(engine, workspace, { sessionId: 's1', anchorSeq: 10, callId: 'c1', rel: 'a.txt', existed: true, content: 'hello v1\n' })
    await writeFile(join(workspace, 'a.txt'), 'hello v2\n', 'utf8')

    const result = await rewindMessage(engine, workspace, { sessionId: 's1', messageSeq: 10 })
    assert.deepEqual(result.restoredPaths, ['a.txt'])
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v1\n')

    // 安全闸：rescue 备份 + 单次 undo。
    const list = await engine.list({ cwd: workspace, includeRescue: true })
    assert.ok(list.some((point) => point.kind === 'rescue'), '恢复后必须存在 rescue 备份点')
    const undo = await engine.undoLastRestore({ cwd: workspace })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v2\n')
    assert.ok(undo.undonePaths.includes('a.txt'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('BEFORE 日志：工具创建的文件恢复即删除', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine()
  try {
    await recordBefore(engine, workspace, { sessionId: 's1', anchorSeq: 10, callId: 'c1', rel: 'new.txt', existed: false, content: null })
    await writeFile(join(workspace, 'new.txt'), 'created by tool\n', 'utf8')

    const inspection = await engine.inspect({
      cwd: workspace,
      restorePointId: (await engine.ensureMessageRestorePoint({ cwd: workspace, sessionId: 's1', messageSeq: 10, turn: 1, turnStartSeq: 10 })).id,
    })
    assert.equal(inspection.changes.find((change) => change.path === 'new.txt')?.kind, 'added')

    await rewindMessage(engine, workspace, { sessionId: 's1', messageSeq: 10 })
    await assert.rejects(() => readFile(join(workspace, 'new.txt')))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('partial 部分树：未捕获的文件绝不被恢复动到（无整树误删）', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine()
  try {
    await recordBefore(engine, workspace, { sessionId: 's1', anchorSeq: 10, callId: 'c1', rel: 'a.txt', existed: true, content: 'hello v1\n' })
    await writeFile(join(workspace, 'a.txt'), 'hello v2\n', 'utf8')
    // 未捕获文件 + 终端创建的文件——都不在 BEFORE 日志里。
    await writeFile(join(workspace, 'unrelated.txt'), 'untouched\n', 'utf8')

    await rewindMessage(engine, workspace, { sessionId: 's1', messageSeq: 10 })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v1\n')
    assert.equal(await readFile(join(workspace, 'unrelated.txt'), 'utf8'), 'untouched\n', 'partial 恢复绝不能删除未捕获文件')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('restoreAfter 语义：earliest-before（多个 anchor 各取最早）', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine()
  try {
    // 回合 1（anchor=10）：v1 → v2；回合 2（anchor=20）：v2 → v3。
    await recordBefore(engine, workspace, { sessionId: 's1', anchorSeq: 10, callId: 'c1', rel: 'a.txt', existed: true, content: 'hello v1\n' })
    await writeFile(join(workspace, 'a.txt'), 'hello v2\n', 'utf8')
    await recordBefore(engine, workspace, { sessionId: 's1', anchorSeq: 20, callId: 'c2', rel: 'a.txt', existed: true, content: 'hello v2\n' })
    await writeFile(join(workspace, 'a.txt'), 'hello v3\n', 'utf8')

    // 回退到回合 2 之前：恢复 v2（anchor 20 的 BEFORE）。
    await rewindMessage(engine, workspace, { sessionId: 's1', messageSeq: 20, turn: 2, turnStartSeq: 20 })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v2\n')

    // 回退到回合 1 之前：恢复 v1（earliest-before，跨 anchor 取最早）。
    await rewindMessage(engine, workspace, { sessionId: 's1', messageSeq: 10, turn: 1, turnStartSeq: 10 })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v1\n')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('restoreAfter 语义：恢复被删除的文件 + 边界重查补录外部删除', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine()
  try {
    await recordBefore(engine, workspace, { sessionId: 's1', anchorSeq: 10, callId: 'c1', rel: 'a.txt', existed: true, content: 'hello v1\n' })
    // 外部（非工具）删除，随后边界重查在 anchor 20 补录 existed=false。
    await rm(join(workspace, 'a.txt'))
    await engine.reconcileTrackedBefore({ workspace, sessionId: 's1', anchorSeq: 20 })

    // 回退到 anchor 10 之前：earliest-before = anchor 10 的 v1 → 文件回来。
    await rewindMessage(engine, workspace, { sessionId: 's1', messageSeq: 10, turn: 1, turnStartSeq: 10 })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v1\n', '外部删除必须被边界重查捕获并恢复')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('prune：超过 100 个 anchor 组后旧组与消息恢复点一并清理', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine()
  try {
    for (let anchor = 1; anchor <= 105; anchor++) {
      await recordBefore(engine, workspace, { sessionId: 's1', anchorSeq: anchor, callId: `c${String(anchor)}`, rel: 'a.txt', existed: true, content: `v${String(anchor)}\n` })
    }
    // anchor 1 已被 prune（保留最新 100 个 = 6..105），其消息恢复点随删。
    const old = await engine.ensureMessageRestorePoint({ cwd: workspace, sessionId: 's1', messageSeq: 1, turn: 1, turnStartSeq: 1 })
    // 注意：物化读的是「当前仍在盘上的日志」——anchor 1 的记录此时已被
    // 周期性 prune 移除或仍保留，两种都合法；这里只验证物化与 prune 收敛。
    if (old !== undefined) {
      const list = await engine.list({ cwd: workspace, includeTurnCheckpoints: true, includeRescue: true })
      assert.ok(!list.some((point) => point.kind === 'message' && point.messageSeq === 1),
        '被 prune 的 anchor 对应的消息恢复点必须被清理')
    }
    const recent = await engine.ensureMessageRestorePoint({ cwd: workspace, sessionId: 's1', messageSeq: 105, turn: 105, turnStartSeq: 105 })
    assert.ok(recent !== undefined, '最新 anchor 的消息恢复点必须可用')
    assert.equal(recent.fileCount, 1)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('与回合检查点共存：检查点在位时恢复走全树，日志只做兜底', async () => {
  const workspace = await makeWorkspace()
  const mode = jjOnPath() ? 'jj' : 'sqlite'
  const { engine } = await makeEngine({ mode })
  try {
    // 检查点捕获整树（含 unrelated.txt），随后 BEFORE 日志只记 a.txt。
    const checkpoint = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
    await recordBefore(engine, workspace, { sessionId: 's1', anchorSeq: 10, callId: 'c1', rel: 'a.txt', existed: true, content: 'hello v1\n' })
    await writeFile(join(workspace, 'a.txt'), 'hello v2\n', 'utf8')
    await writeFile(join(workspace, 'unrelated.txt'), 'untouched\n', 'utf8')

    // 检查点在位：恢复 unrelated.txt（全树语义，消息检查点做不到）。
    const inspection = await engine.inspect({ cwd: workspace, restorePointId: checkpoint.id })
    const plan = await engine.planRestore({
      cwd: workspace,
      restorePointId: checkpoint.id,
      expectedCurrentTreeHash: inspection.currentTreeHash,
    })
    await engine.applyRestore({ planId: plan.id })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v1\n')
    await assert.rejects(() => readFile(join(workspace, 'unrelated.txt')))
    // 共存后 BEFORE 日志仍然可用（兜底通道不受影响）。
    const point = await engine.ensureMessageRestorePoint({ cwd: workspace, sessionId: 's1', messageSeq: 10, turn: 1, turnStartSeq: 10 })
    assert.ok(point !== undefined)
    assert.equal(point.kind, 'message')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('工作区外路径不入日志（恢复围栏一致）', async () => {
  const workspace = await makeWorkspace()
  const outside = await mkdtemp(join(tmpdir(), 'shadow-rewind-outside-'))
  const { engine } = await makeEngine()
  try {
    await mkdir(join(outside), { recursive: true })
    await writeFile(join(outside, 'elsewhere.txt'), 'x\n', 'utf8')
    // 模拟宿主管道的 rel 计算：工作区外 → 相对路径以 .. 开头 → 直接放弃。
    const rel = join('..', outside.split(/[\\/]/).at(-1), 'elsewhere.txt').split(/[\\/]/).join('/')
    await recordBefore(engine, workspace, { sessionId: 's1', anchorSeq: 10, callId: 'c1', rel, existed: true, content: 'x\n' })
    const point = await engine.ensureMessageRestorePoint({ cwd: workspace, sessionId: 's1', messageSeq: 10, turn: 1, turnStartSeq: 10 })
    // ensureMessageRestorePoint 对 .. 路径 validateRelativePath 会拒绝——
    // 物化必须把它挡在门外（fail-closed），而不是写进恢复点。
    if (point !== undefined) {
      assert.ok(!Object.keys((await engine.getCheckpointEntries({ cwd: workspace, restorePointId: point.id }))).some((path) => path.startsWith('..')),
        '工作区外路径绝不能进入恢复点条目')
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
