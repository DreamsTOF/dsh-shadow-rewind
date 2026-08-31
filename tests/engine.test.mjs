/**
 * 引擎端到端测试：真实临时目录 + 真实后端（blob 恒测；jj 可用时加测）。
 * 覆盖：捕获/对比/计划/恢复全链路、新增/删除/修改/权限变化、排除规则、
 * 超限显式跳过、计划过期（PLAN_STALE）、rescue 备份与删除确认闸。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, rmdir, writeFile, readFile, chmod, symlink, lstat, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine } from '../lib/index.js'
import { ShadowRewindError } from '../lib/index.js'

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
  await mkdir(join(root, 'sub'))
  await writeFile(join(root, 'sub', 'b.txt'), 'bee v1\n', 'utf8')
  return root
}

async function makeEngine(overrides = {}) {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-store-'))
  const engine = new ShadowRewindEngine({
    storageDir,
    turnCheckpointMode: overrides.mode ?? 'legacy',
    ...overrides,
  })
  await engine.ready
  return { engine, storageDir }
}

async function captureTurn(engine, workspace, turn = 1) {
  return engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn, turnStartSeq: turn * 10 })
}

async function rewindTo(engine, workspace, checkpointId) {
  const inspection = await engine.inspect({ cwd: workspace, restorePointId: checkpointId })
  const plan = await engine.planRestore({
    cwd: workspace,
    restorePointId: checkpointId,
    expectedCurrentTreeHash: inspection.currentTreeHash,
  })
  return engine.applyRestore({ planId: plan.id, confirmation: plan.confirmation })
}

async function assertRoundtrip(mode) {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode })
  try {
    const checkpoint = await captureTurn(engine, workspace)
    assert.equal(checkpoint.kind, 'turn')

    // 模拟 AI 的三种破坏：改、删、加。
    await writeFile(join(workspace, 'a.txt'), 'hello v2 corrupted\n', 'utf8')
    await rm(join(workspace, 'sub', 'b.txt'))
    await writeFile(join(workspace, 'added.txt'), 'later addition\n', 'utf8')

    const inspection = await engine.inspect({ cwd: workspace, restorePointId: checkpoint.id })
    const kinds = Object.fromEntries(inspection.changes.map((change) => [change.path, change.kind]))
    assert.equal(kinds['a.txt'], 'modified')
    assert.equal(kinds['sub/b.txt'], 'deleted')
    assert.equal(kinds['added.txt'], 'added')

    const result = await rewindTo(engine, workspace, checkpoint.id)
    // 4 = 三个文件变更 + sub 的隐式目录变更（b.txt 被删后 sub 变成空目录，
    // 当前树以 dir 条目呈现，随恢复一并收敛）。
    assert.equal(result.restoredPaths.length, 4)
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v1\n')
    assert.equal(await readFile(join(workspace, 'sub', 'b.txt'), 'utf8'), 'bee v1\n')
    await assert.rejects(() => readFile(join(workspace, 'added.txt')))

    // rescue 点必须存在，且与检查点同后端。
    const after = await engine.list({ cwd: workspace, includeRescue: true, includeTurnCheckpoints: true })
    const rescue = after.find((point) => point.kind === 'rescue')
    assert.ok(rescue, '恢复后必须存在 rescue 备份点')
    assert.equal(rescue.storage, mode === 'jj' && jjOnPath() ? 'jj' : 'blob')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

test('legacy 后端：完整回退链路', () => assertRoundtrip('legacy'))

if (jjOnPath()) {
  test('jj 影子后端：完整回退链路', () => assertRoundtrip('jj'))
} else {
  test('jj 不可用时自动降级 blob', async () => {
    const { engine } = await makeEngine({ mode: 'jj' })
    assert.equal(engine.effectiveBackend, 'blob')
    assert.ok(engine.downgradeReason !== undefined)
  })
}

test('排除规则：命中目录整棵不入快照', async () => {
  const workspace = await makeWorkspace()
  await mkdir(join(workspace, 'node_modules', 'pkg'), { recursive: true })
  await writeFile(join(workspace, 'node_modules', 'pkg', 'index.js'), 'dep\n', 'utf8')
  const { engine } = await makeEngine({ mode: 'legacy' })
  try {
    const checkpoint = await captureTurn(engine, workspace)
    // node_modules 不在恢复点里：修改它不会产生 diff，恢复也不会碰它。
    await writeFile(join(workspace, 'node_modules', 'pkg', 'index.js'), 'changed\n', 'utf8')
    const inspection = await engine.inspect({ cwd: workspace, restorePointId: checkpoint.id })
    assert.ok(!inspection.changes.some((change) => change.path.startsWith('node_modules')))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('超大文件被显式跳过且恢复不动它', async () => {
  const workspace = await makeWorkspace()
  await writeFile(join(workspace, 'big.bin'), Buffer.alloc(64, 7))
  const { engine } = await makeEngine({ mode: 'legacy', maxFileBytes: 32 })
  try {
    const checkpoint = await captureTurn(engine, workspace)
    assert.equal(checkpoint.skippedPathCount, 1)
    // inspect 必须透出跳过项明细 {path, reason}。
    const before = await engine.inspect({ cwd: workspace, restorePointId: checkpoint.id })
    assert.deepEqual(before.skippedPaths, [{ path: 'big.bin', reason: 'too-large' }])
    // 场景 A：快照时已存在的跳过文件后来被改——不产生 diff。
    await writeFile(join(workspace, 'big.bin'), Buffer.alloc(64, 9))
    const inspection = await engine.inspect({ cwd: workspace, restorePointId: checkpoint.id })
    assert.ok(!inspection.changes.some((change) => change.path === 'big.bin'))
    assert.equal(inspection.changes.length, 0)
    assert.equal((await readFile(join(workspace, 'big.bin')))[0], 9)
    // 场景 B（回归）：快照之后才新增的跳过文件，恢复时绝不能被当「新增」误删。
    // 同时改一个普通文件，让计划里存在真实恢复动作。
    await writeFile(join(workspace, 'a.txt'), 'hello v2\n', 'utf8')
    await writeFile(join(workspace, 'added-big.bin'), Buffer.alloc(96, 3))
    const inspection2 = await engine.inspect({ cwd: workspace, restorePointId: checkpoint.id })
    assert.ok(!inspection2.changes.some((change) => change.path === 'added-big.bin'))
    const plan = await engine.planRestore({
      cwd: workspace,
      restorePointId: checkpoint.id,
      expectedCurrentTreeHash: inspection2.currentTreeHash,
    })
    // 即使它混进了计划，恢复也不应有任何针对它的动作。
    assert.ok(!plan.changes.some((change) => change.path === 'added-big.bin'))
    await engine.applyRestore({ planId: plan.id, confirmation: plan.confirmation })
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v1\n')
    assert.equal((await readFile(join(workspace, 'added-big.bin')))[0], 3)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

async function assertLadder(mode) {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode })
  try {
    await writeFile(join(workspace, 'a.txt'), 'step-1\n', 'utf8')
    const turn1 = await captureTurn(engine, workspace, 1)
    await writeFile(join(workspace, 'a.txt'), 'step-2\n', 'utf8')
    await rm(join(workspace, 'sub', 'b.txt'))
    const turn2 = await captureTurn(engine, workspace, 2)
    await writeFile(join(workspace, 'a.txt'), 'step-3 final\n', 'utf8')
    await writeFile(join(workspace, 'late.txt'), 'later\n', 'utf8')
    // 回退到中间的 turn2：a.txt 回到 step-2、b.txt 保持删除状态、late.txt 被移除。
    const result = await rewindTo(engine, workspace, turn2.id)
    assert.equal(result.restoredPaths.length, 2)
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'step-2\n')
    await assert.rejects(() => readFile(join(workspace, 'sub', 'b.txt')))
    await assert.rejects(() => readFile(join(workspace, 'late.txt')))
    // 再回退到更早的 turn1：b.txt 被找回。
    await rewindTo(engine, workspace, turn1.id)
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'step-1\n')
    assert.equal(await readFile(join(workspace, 'sub', 'b.txt'), 'utf8'), 'bee v1\n')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

test('多轮阶梯：回退到中间检查点（legacy）', () => assertLadder('legacy'))

if (jjOnPath()) {
  test('多轮阶梯：回退到中间检查点（jj 影子）', () => assertLadder('jj'))
}

test('共享 stat 缓存：指纹未变时零内容重读（blob 后端同样增量）', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode: 'legacy' })
  try {
    await captureTurn(engine, workspace, 1)
    const cachePath = join(engine.config.storageDir, 'workspaces')
    // 通过直接驱动捕获层断言增量行为：第二次捕获（内容未变）不应产生任何新读。
    const { scanWorkspace } = await import('../lib/scan.js')
    const { captureSnapshot } = await import('../lib/capture.js')
    const { readCaptureCache } = await import('../lib/capture-cache.js')
    const dirs = await (await import('node:fs/promises')).readdir(cachePath)
    const cache = await readCaptureCache(join(cachePath, dirs[0], 'stat-cache.json'))
    assert.ok(Object.keys(cache.paths).length >= 2, '缓存应覆盖快照里的全部文件')
    const scan = await scanWorkspace(workspace, { maxFileBytes: 1024 * 1024, excludes: [] })
    const second = await captureSnapshot({
      root: scan.root,
      paths: scan.paths,
      skippedAtScan: [],
      maxFiles: 1000,
      maxSnapshotBytes: 1024 * 1024,
      strict: false,
      cache,
    })
    assert.equal(second.newContent.size, 0, '内容未变时不应重读任何文件')
    // 改一个文件后，只有它出现在新读集合里。
    await writeFile(join(workspace, 'a.txt'), 'changed\n', 'utf8')
    const third = await captureSnapshot({
      root: scan.root,
      paths: (await scanWorkspace(workspace, { maxFileBytes: 1024 * 1024, excludes: [] })).paths,
      skippedAtScan: [],
      maxFiles: 1000,
      maxSnapshotBytes: 1024 * 1024,
      strict: false,
      cache,
    })
    assert.deepEqual([...third.newContent.keys()], ['a.txt'])
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('计划过期：计划后文件再变 → PLAN_STALE 拒绝执行', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode: 'legacy' })
  try {
    const checkpoint = await captureTurn(engine, workspace)
    await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    const inspection = await engine.inspect({ cwd: workspace, restorePointId: checkpoint.id })
    const plan = await engine.planRestore({
      cwd: workspace,
      restorePointId: checkpoint.id,
      expectedCurrentTreeHash: inspection.currentTreeHash,
    })
    // 检查之后又改了一次。
    await writeFile(join(workspace, 'a.txt'), 'v3\n', 'utf8')
    await assert.rejects(
      () => engine.applyRestore({ planId: plan.id, confirmation: plan.confirmation }),
      (error) => error instanceof ShadowRewindError && error.code === 'PLAN_STALE',
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('删除需要逐字确认串', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode: 'legacy' })
  try {
    const checkpoint = await captureTurn(engine, workspace)
    await assert.rejects(
      () => engine.delete({ cwd: workspace, restorePointId: checkpoint.id, confirmation: 'delete it' }),
      (error) => error instanceof ShadowRewindError && error.code === 'CONFIRMATION_MISMATCH',
    )
    await engine.delete({ cwd: workspace, restorePointId: checkpoint.id, confirmation: `DELETE ${checkpoint.id}` })
    await assert.rejects(
      () => engine.inspect({ cwd: workspace, restorePointId: checkpoint.id }),
      (error) => error instanceof ShadowRewindError && error.code === 'RESTORE_POINT_NOT_FOUND',
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('无变更时恢复报 NO_CHANGES', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode: 'legacy' })
  try {
    const checkpoint = await captureTurn(engine, workspace)
    await assert.rejects(
      () => engine.planRestore({ cwd: workspace, restorePointId: checkpoint.id }),
      (error) => error instanceof ShadowRewindError && error.code === 'NO_CHANGES',
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

// 权限位与符号链接是 POSIX 语义；Windows 上跳过。
const posixOnly = process.platform === 'win32' ? { skip: 'POSIX only' } : {}

test('可执行位被保留', posixOnly, async () => {
  const workspace = await makeWorkspace()
  await writeFile(join(workspace, 'run.sh'), '#!/bin/sh\necho hi\n', 'utf8')
  await chmod(join(workspace, 'run.sh'), 0o755)
  const { engine } = await makeEngine({ mode: 'legacy' })
  try {
    const checkpoint = await captureTurn(engine, workspace)
    await writeFile(join(workspace, 'run.sh'), 'noop\n', 'utf8')
    await rewindTo(engine, workspace, checkpoint.id)
    const info = await (await import('node:fs/promises')).stat(join(workspace, 'run.sh'))
    assert.ok(info.mode & 0o111, '可执行位应被恢复')
    assert.equal(await readFile(join(workspace, 'run.sh'), 'utf8'), '#!/bin/sh\necho hi\n')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('死缓存自愈（blob）：删除触发 GC 后，缓存不再引用已删 blob', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode: 'legacy' })
  try {
    const t1 = await captureTurn(engine, workspace, 1)
    // 删除 t1 → GC 把 a.txt/sub b.txt 的 blob 从磁盘清掉（无其它引用）。
    const deleted = await engine.delete({ cwd: workspace, restorePointId: t1.id, confirmation: `DELETE ${t1.id}` })
    assert.ok((deleted.deletedBlobs ?? 0) > 0, '删除唯一恢复点后 GC 应清掉全部 blob')
    // 修复点：GC 后 stat 缓存必须被作废；否则下一次捕获会命中死缓存，
    // 把「已删除的 blob」直接写进新 manifest（旧代码在此处埋雷）。
    const { readdir } = await import('node:fs/promises')
    const wsDirs = await readdir(join(engine.config.storageDir, 'workspaces'))
    const { existsSync } = await import('node:fs')
    for (const dir of wsDirs) {
      assert.equal(existsSync(join(engine.config.storageDir, 'workspaces', dir, 'stat-cache.json')), false,
        'GC 删除内容后 stat 缓存必须被清空')
    }
    // 不改任何文件直接再捕获：命中路径全部失效重读，manifest 引用的 blob 真实存在。
    const t2 = await captureTurn(engine, workspace, 2)
    await writeFile(join(workspace, 'a.txt'), 'changed\n', 'utf8')
    await rewindTo(engine, workspace, t2.id)
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v1\n')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('死缓存自愈（jj）：影子仓库被外部删除后自动重建', { skip: jjOnPath() ? false : '未安装 jj CLI' }, async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode: 'jj' })
  try {
    await captureTurn(engine, workspace, 1)
    // 模拟外部清理：把整个 shadow-repos 目录删掉。
    await rm(join(engine.config.storageDir, 'shadow-repos'), { recursive: true, force: true })
    // 下一次捕获必须自愈（重建仓库 + 全量重写镜像），而不是产出空 commit。
    const t2 = await captureTurn(engine, workspace, 2)
    assert.equal(t2.fileCount, 2, '重建后的检查点必须包含完整文件集')
    await writeFile(join(workspace, 'a.txt'), 'changed\n', 'utf8')
    await rewindTo(engine, workspace, t2.id)
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'hello v1\n')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('rescue 点不挤占 maxRestorePoints 配额', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode: 'legacy', maxRestorePoints: 1 })
  try {
    const t1 = await captureTurn(engine, workspace, 1)
    // 触发一次恢复 → 自动生成 rescue 点。
    await writeFile(join(workspace, 'a.txt'), 'changed\n', 'utf8')
    await rewindTo(engine, workspace, t1.id)
    const after = await engine.list({ cwd: workspace, includeRescue: true, includeTurnCheckpoints: true })
    assert.ok(after.some((point) => point.kind === 'rescue'), '恢复后应存在 rescue 点')
    // 修复点：rescue 已存在，但 user 配额（1）还没被占——第一个手动点必须可建；
    // 若 rescue 被错误计入配额，这里会抛 RESTORE_POINT_LIMIT。
    await engine.create({ cwd: workspace, label: 'manual-1' })
    // 第二个手动点才真正触顶。
    await assert.rejects(
      () => engine.create({ cwd: workspace, label: 'manual-2' }),
      (error) => error instanceof ShadowRewindError && error.code === 'RESTORE_POINT_LIMIT',
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

async function assertSymlinkMirror(mode) {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({ mode })
  try {
    await symlink('a.txt', join(workspace, 'link.txt'))
    const t1 = await captureTurn(engine, workspace, 1)
    await rm(join(workspace, 'link.txt'))
    await rewindTo(engine, workspace, t1.id)
    const { readlink } = await import('node:fs/promises')
    assert.equal(await readlink(join(workspace, 'link.txt')), 'a.txt')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

const posix = process.platform === 'win32' ? { skip: 'POSIX only' } : {}

test('符号链接被恢复（legacy）', posix, () => assertSymlinkMirror('legacy'))

if (jjOnPath()) {
  // 验证 newLinks 真正写进镜像：旧实现的 jj 镜像从不落链接（死代码），
  // 恢复时 readSnapshot 会拿不到链接条目。
  test('符号链接被恢复（jj 镜像）', posix, () => assertSymlinkMirror('jj'))
}

test('轮末归属：终端/PowerShell 风格写盘被「轮起 vs 下一轮轮起」对比捕获', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine({})
  try {
    // 轮 1 轮起检查点。
    const t1 = await captureTurn(engine, workspace, 1)

    // 模拟终端/PowerShell 的三种写盘：改、加、删（全部绕过文件工具）。
    await writeFile(join(workspace, 'a.txt'), 'hello v2 via terminal\n', 'utf8')
    await writeFile(join(workspace, 'ps-created.txt'), 'created by powershell\n', 'utf8')
    await rm(join(workspace, 'sub', 'b.txt'))

    // 轮 2 第一步之前的捕获 = 轮 1 的轮末树状态。
    const t2 = await captureTurn(engine, workspace, 2)

    // listTurnCheckpoints 按 turn 升序。
    const list = await engine.listTurnCheckpoints({ cwd: workspace, sessionId: 's1' })
    assert.deepEqual(list.map((p) => p.turn), [1, 2])

    // 轮 1 的变更 = diff(t1, t2)——不含轮 2 之后的任何写盘。
    const diff = await engine.diffCheckpoints({
      cwd: workspace,
      prevCheckpointId: t1.id,
      currCheckpointId: t2.id,
    })
    const kinds = Object.fromEntries(diff.changes.map((change) => [change.path, change.kind]))
    assert.equal(kinds['a.txt'], 'modified')
    assert.equal(kinds['ps-created.txt'], 'added')
    assert.equal(kinds['sub/b.txt'], 'deleted')
    // b.txt 被删后 sub 成为空目录：t2 检查点以 dir 条目记录，构成第四条变更。
    assert.equal(kinds['sub'], 'added')
    assert.equal(diff.changes.length, 4)

    // 检查点内容可按路径读回（供客户端生成完整 diff）。
    const content = await engine.getFileContentFromCheckpoint({
      cwd: workspace,
      checkpointId: t2.id,
      path: 'ps-created.txt',
    })
    assert.equal(content?.toString('utf8'), 'created by powershell\n')
    const missing = await engine.getFileContentFromCheckpoint({
      cwd: workspace,
      checkpointId: t1.id,
      path: 'ps-created.txt',
    })
    assert.equal(missing, null)

    // 轮 2 开始后又有写盘：不得混入轮 1 的归属窗口。
    await writeFile(join(workspace, 'turn2-file.txt'), 'turn 2 work\n', 'utf8')
    const diffAgain = await engine.diffCheckpoints({
      cwd: workspace,
      prevCheckpointId: t1.id,
      currCheckpointId: t2.id,
    })
    assert.equal(diffAgain.changes.some((change) => change.path === 'turn2-file.txt'), false)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})


test('空目录：检查点记录 dir 条目，轮末归属可见且整轮恢复互逆', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-emptydir-'))
  const { engine } = await makeEngine({})
  try {
    await writeFile(join(workspace, 'a.txt'), 'v1\n', 'utf8')
    await mkdir(join(workspace, 'empty'))
    const t1 = await captureTurn(engine, workspace, 1)

    // 轮内：删掉空目录 + 改文件。
    await rmdir(join(workspace, 'empty'))
    await writeFile(join(workspace, 'a.txt'), 'v2\n', 'utf8')
    const t2 = await captureTurn(engine, workspace, 2)

    const diffResult = await engine.diffCheckpoints({
      cwd: workspace,
      prevCheckpointId: t1.id,
      currCheckpointId: t2.id,
    })
    const byPath = Object.fromEntries(diffResult.changes.map((change) => [change.path, change]))
    assert.equal(byPath['empty'].kind, 'deleted', '空目录的删除必须出现在轮末归属')
    assert.equal(byPath['empty'].before.kind, 'dir')
    assert.equal(typeof byPath['empty'].before.mode, 'number')

    // 恢复到轮起：空目录被重建，文件回到 v1。
    await rewindTo(engine, workspace, t1.id)
    const stat = await lstat(join(workspace, 'empty'))
    assert.ok(stat.isDirectory(), '恢复必须重建空目录')
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'v1\n')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('mtime 落盘：检查点记录写入时间，旧清单兼容且树哈希不受影响', async () => {
  const workspace = await makeWorkspace()
  const { engine, storageDir } = await makeEngine({})
  const { parseManifest, hashTree } = await import('../lib/manifest.js')
  const readManifest = async (id) => {
    // 与 store 同式：工作区 key = SHA-256(规范化路径) 前 16 位。
    const key = createHash('sha256').update(await realpath(workspace), 'utf8').digest('hex').slice(0, 16)
    const raw = JSON.parse(await readFile(join(storageDir, 'workspaces', key, 'manifests', `${id}.json`), 'utf8'))
    return raw
  }
  try {
    const t1 = await captureTurn(engine, workspace, 1)
    const raw = await readManifest(t1.id)
    const manifest = parseManifest(raw)
    const entry = manifest.entries['a.txt']
    assert.ok(entry !== undefined && entry.kind === 'file')
    assert.ok(typeof entry.mtimeNs === 'string' && /^[0-9]+$/.test(entry.mtimeNs), '新读路径必须落 mtimeNs')
    const disk = await lstat(join(workspace, 'a.txt'), { bigint: true })
    assert.equal(entry.mtimeNs, disk.mtimeNs.toString(), 'mtimeNs 必须与磁盘事实一致')

    // 无变化再捕获一轮：缓存命中路径同样带出 mtimeNs 且数值不变。
    const t2 = await captureTurn(engine, workspace, 2)
    const second = parseManifest(await readManifest(t2.id))
    const cachedEntry = second.entries['a.txt']
    assert.ok(cachedEntry !== undefined && cachedEntry.kind === 'file')
    assert.equal(cachedEntry.mtimeNs, entry.mtimeNs, '缓存命中必须透传 mtimeNs')

    // 旧清单兼容：去掉 mtimeNs 仍可解析，且树哈希不变（时间戳不进哈希）。
    const legacy = JSON.parse(JSON.stringify(raw))
    delete legacy.entries['a.txt'].mtimeNs
    const legacyManifest = parseManifest(legacy)
    assert.equal(hashTree(legacyManifest.entries), manifest.treeHash, 'mtime 不得参与树哈希')

    // 非法值按损坏拒绝（fail-closed）。
    const bad = JSON.parse(JSON.stringify(raw))
    bad.entries['a.txt'].mtimeNs = 'not-a-number'
    assert.throws(() => parseManifest(bad), /mtimeNs/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
