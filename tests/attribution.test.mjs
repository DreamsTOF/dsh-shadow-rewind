/**
 * 归因测试：检查点窗口归因（纯函数，信息徽标）。
 * 窗口语义：检查点在回合开始时捕获，窗口 [S_j, S_{j+1}) 的写者就是
 * S_j 的会话；最后一个窗口延伸到当前树。归因只做展示，不影响任何默认行为。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attributePaths, serializeOwner } from '../lib/attribution.js'
import { ShadowRewindEngine } from '../lib/index.js'

function fileEntry(blob) {
  return { kind: 'file', blob, size: 3, mode: 0o100644 }
}

function modified(path, before, after) {
  return { path, kind: 'modified', before, after }
}

test('窗口归因：变更落在目标窗口 → target', () => {
  // A 的回合写了 p（x），其后 B 的回合开始检查点 S1 捕获到 x。
  const attribution = attributePaths({
    targetSessionId: 'A',
    changes: [modified('p', fileEntry('o'), fileEntry('x'))],
    snapshots: [{ sessionId: 'B', entries: { p: fileEntry('x') } }],
  })
  assert.deepEqual(attribution.get('p')?.owner, { kind: 'target' })
})

test('窗口归因：变更落在其它会话窗口 → session 标签', () => {
  // B 的回合开始（S1，p 仍为 o）后写了 x；A 的回合开始检查点 S2 捕获到 x。
  const attribution = attributePaths({
    targetSessionId: 'A',
    changes: [modified('p', fileEntry('o'), fileEntry('x'))],
    snapshots: [
      { sessionId: 'B', entries: { p: fileEntry('o') } },
      { sessionId: 'A', entries: { p: fileEntry('x') } },
    ],
  })
  assert.deepEqual(attribution.get('p')?.owner, { kind: 'session', sessionId: 'B' })
})

test('窗口归因：双方先后都改过 → multi', () => {
  const attribution = attributePaths({
    targetSessionId: 'A',
    changes: [modified('p', fileEntry('o'), fileEntry('x'))],
    snapshots: [
      { sessionId: 'B', entries: { p: fileEntry('o') } },
      { sessionId: 'A', entries: { p: fileEntry('y') } },
    ],
  })
  assert.deepEqual(attribution.get('p')?.owner, { kind: 'multi' })
})

test('窗口归因：新增文件（before=null）属于目标窗口', () => {
  const attribution = attributePaths({
    targetSessionId: 'A',
    changes: [{ path: 'new.txt', kind: 'added', before: null, after: fileEntry('x') }],
    snapshots: [],
  })
  assert.deepEqual(attribution.get('new.txt')?.owner, { kind: 'target' })
})

test('窗口归因：快照缺少会话 id → unknown；序列化按约定映射', () => {
  const attribution = attributePaths({
    targetSessionId: 'A',
    changes: [modified('p', fileEntry('o'), fileEntry('x'))],
    snapshots: [{ entries: { p: fileEntry('o') } }],
  })
  assert.deepEqual(attribution.get('p')?.owner, { kind: 'unknown' })
  assert.equal(serializeOwner(attribution.get('p').owner), 'unknown')
  assert.equal(serializeOwner({ kind: 'target' }), 'target')
  assert.equal(serializeOwner({ kind: 'multi' }), 'multi')
  assert.equal(serializeOwner({ kind: 'session', sessionId: 'sess_x' }), 'sess_x')
})

test('引擎集成：双会话窗口归因（标签只作展示）', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-attr-'))
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-ws-'))
  const engine = new ShadowRewindEngine({ storageDir, turnCheckpointMode: 'sqlite' })
  await engine.ready
  try {
    const signal = new AbortController().signal
    await writeFile(join(workspace, 'a.txt'), 'A0\n')
    await writeFile(join(workspace, 'b.txt'), 'B0\n')
    // S0：A 的回合 1 开始（捕获 A0/B0）。
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 'A', turn: 1, turnStartSeq: 1, signal })
    // 窗口 [S0,S1)：目标会话一方新增 c.txt（归 target）。
    await writeFile(join(workspace, 'c.txt'), 'C0\n')
    // S1：B 的回合 2 开始（捕获 A0/B0/C0）。
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 'B', turn: 2, turnStartSeq: 2, signal })
    // 窗口 [S1,S2)：B 的回合写入 a/b。
    await writeFile(join(workspace, 'a.txt'), 'A1\n')
    await writeFile(join(workspace, 'b.txt'), 'B1\n')
    // S2：A 的回合 3 开始（捕获 A1/B1/C0），关闭 B 的窗口。
    await engine.createTurnCheckpoint({ cwd: workspace, sessionId: 'A', turn: 3, turnStartSeq: 3, signal })
    // 窗口 [S2,∞)：A 再改 a（b 保持 B 的版本）。
    await writeFile(join(workspace, 'a.txt'), 'A2\n')

    const first = await engine.findTurnCheckpoint({ cwd: workspace, sessionId: 'A', turn: 1 })
    assert.ok(first !== undefined, '目标检查点必须存在')
    const inspection = await engine.inspect({ cwd: workspace, restorePointId: first.id })
    assert.deepEqual(inspection.changes.map(change => change.path).sort(), ['a.txt', 'b.txt', 'c.txt'])

    const { targetSessionId, snapshots } = await engine.listSnapshotsAfter({
      cwd: workspace,
      restorePointId: first.id,
      paths: inspection.changes.map(change => change.path),
    })
    assert.equal(targetSessionId, 'A')
    assert.equal(snapshots.length, 2, 'S1（B 回合 2）与 S2（A 回合 3）')

    const attribution = attributePaths({ targetSessionId, changes: inspection.changes, snapshots })
    assert.deepEqual(attribution.get('a.txt')?.owner, { kind: 'multi' }, 'a 被 B 和 A 先后改过')
    assert.deepEqual(attribution.get('b.txt')?.owner, { kind: 'session', sessionId: 'B' })
    assert.deepEqual(attribution.get('c.txt')?.owner, { kind: 'target' })
  } finally {
    await engine.store.closeAll()
    await rm(storageDir, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  }
})