/**
 * 对称模式测试：检查点窗口归因（纯函数）与勾选式子集恢复（引擎集成）。
 * 窗口语义：检查点在回合开始时捕获，窗口 [S_j, S_{j+1}) 的写者就是
 * S_j 的会话；最后一个窗口延伸到当前树。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
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

test('窗口归因：变更落在目标窗口 → target + 默认勾选', () => {
  // A 的回合写了 p（x），其后 B 的回合开始检查点 S1 捕获到 x。
  const attribution = attributePaths({
    targetSessionId: 'A',
    changes: [modified('p', fileEntry('o'), fileEntry('x'))],
    snapshots: [{ sessionId: 'B', entries: { p: fileEntry('x') } }],
  })
  assert.deepEqual(attribution.get('p')?.owner, { kind: 'target' })
  assert.equal(attribution.get('p')?.autoSelect, true)
})

test('窗口归因：变更落在其它会话窗口 → session 标签，不默认勾选', () => {
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
  assert.equal(attribution.get('p')?.autoSelect, false)
})

test('窗口归因：双方先后都改过 → multi（保守排除自动勾选）', () => {
  const attribution = attributePaths({
    targetSessionId: 'A',
    changes: [modified('p', fileEntry('o'), fileEntry('x'))],
    snapshots: [
      { sessionId: 'B', entries: { p: fileEntry('o') } },
      { sessionId: 'A', entries: { p: fileEntry('y') } },
    ],
  })
  assert.deepEqual(attribution.get('p')?.owner, { kind: 'multi' })
  assert.equal(attribution.get('p')?.autoSelect, false)
})

test('窗口归因：新增文件（before=null）属于目标窗口', () => {
  const attribution = attributePaths({
    targetSessionId: 'A',
    changes: [{ path: 'new.txt', kind: 'added', before: null, after: fileEntry('x') }],
    snapshots: [],
  })
  assert.deepEqual(attribution.get('new.txt')?.owner, { kind: 'target' })
  assert.equal(attribution.get('new.txt')?.autoSelect, true)
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

test('引擎集成：双会话窗口归因 + 勾选式子集恢复只还原勾选路径', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-attr-'))
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-ws-'))
  try {
    const engine = new ShadowRewindEngine({ storageDir, turnCheckpointMode: 'legacy' })
    await engine.ready
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

    // 勾选式子集恢复：只还原 b.txt（B 的改动），a/c 原样保留。
    const plan = await engine.planRestore({
      cwd: workspace,
      restorePointId: first.id,
      sessionId: 'A',
      expectedCurrentTreeHash: inspection.currentTreeHash,
      paths: ['b.txt'],
    })
    assert.deepEqual(plan.changes.map(change => change.path), ['b.txt'])
    await engine.applyRestore({ planId: plan.id, confirmation: plan.confirmation, sessionId: 'A' })
    assert.equal(await readFile(join(workspace, 'b.txt'), 'utf8'), 'B0\n', 'b.txt 回到目标检查点状态')
    assert.equal(await readFile(join(workspace, 'a.txt'), 'utf8'), 'A2\n', '未勾选的 a.txt 不受影响')
    assert.equal(await readFile(join(workspace, 'c.txt'), 'utf8'), 'C0\n', '未勾选的 c.txt 不受影响')

    // 未知路径拒绝：防止拿错版本的清单拼出半个计划。
    await assert.rejects(
      () => engine.planRestore({ cwd: workspace, restorePointId: first.id, paths: ['missing.txt'] }),
      (error) => error.code === 'INVALID_ARGUMENTS',
    )
  } finally {
    await rm(storageDir, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  }
})
