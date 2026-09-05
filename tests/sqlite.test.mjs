/**
 * SQLite 内容后端专项：入库/读回/去重、GC 行回收、哈希校验闸与降级探测。
 * 全链路恢复语义由 engine.test.mjs（sqlite 模式）覆盖，这里只测后端自身。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ShadowRewindEngine, ShadowRewindError } from '../lib/index.js'

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
    turnCheckpointMode: 'sqlite',
    ...overrides,
  })
  await engine.ready
  return { engine, storageDir }
}

/** 测试存储根里只有一个工作区：直接定位它的 content.db。 */
async function contentDbPath(storageDir) {
  const keys = await readdir(join(storageDir, 'workspaces'))
  assert.equal(keys.length, 1)
  return join(storageDir, 'workspaces', keys[0], 'content.db')
}

function rowCount(db) {
  return Number(db.prepare('SELECT COUNT(*) AS n FROM blobs').get().n)
}

test('sqlite 后端：显式配置生效且无降级', async () => {
  const { engine } = await makeEngine()
  assert.equal(engine.effectiveBackend, 'sqlite')
  assert.equal(engine.downgradeReason, undefined)
})

test('jj 不可用时配置 jj 自动降级 sqlite', { skip: jjOnPath() && '宿主机有 jj' }, async () => {
  const { engine } = await makeEngine({ turnCheckpointMode: 'jj' })
  assert.equal(engine.effectiveBackend, 'sqlite')
  assert.ok(engine.downgradeReason !== undefined)
})

test('内容库去重：未变文件的二次检查点零新增行', async () => {
  const workspace = await makeWorkspace()
  const { engine, storageDir } = await makeEngine()
  try {
    const first = await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 1, turnStartSeq: 10 })
    assert.equal(first.storage, 'sqlite')
    const db = new DatabaseSync(await contentDbPath(storageDir))
    try {
      const afterFirst = rowCount(db)
      assert.ok(afterFirst > 0)
      await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 's1', turn: 2, turnStartSeq: 20 })
      assert.equal(rowCount(db), afterFirst, '缓存命中的路径不得产生新内容行')
    } finally {
      db.close()
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('GC：删除恢复点后未引用内容行被回收', async () => {
  const workspace = await makeWorkspace()
  const { engine, storageDir } = await makeEngine()
  try {
    const point = await engine.create({ cwd: workspace, kind: 'user', label: 'gc-test' })
    const db = new DatabaseSync(await contentDbPath(storageDir))
    try {
      assert.ok(rowCount(db) > 0)
      const result = await engine.delete({ cwd: workspace, restorePointId: point.id, confirmation: `DELETE ${point.id}` })
      assert.ok(result.deletedBlobs > 0, '删除恢复点必须回收其内容行')
      assert.equal(rowCount(db), 0)
    } finally {
      db.close()
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('哈希闸：内容与声明哈希不符拒绝入库', async () => {
  const workspace = await makeWorkspace()
  const { engine } = await makeEngine()
  try {
    const bogus = createHash('sha256').update('declared').digest('hex')
    await assert.rejects(
      () => engine.store.putSqliteBlobs(workspace, [{ hash: bogus, content: Buffer.from('actual') }]),
      (error) => error instanceof ShadowRewindError && error.code === 'BLOB_HASH_MISMATCH',
    )
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
