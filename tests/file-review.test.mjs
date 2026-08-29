/**
 * 文件审查半边测试：hunk 子集撤销（块级「撤销/保留」的宿主语义）与
 * Code Mode 录制记录的磁盘持久化往返。不依赖 dsh 运行时——FileReviewService
 * 只需一个 cordis 根 Context（TypertRemoteService 的注册基类）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { FileReviewService, transformFile } from '../lib/file-review/file-review-service.js'

function fakeAgent(id) {
  return { id, session: { header: { cwd: '/tmp/unused' } } }
}

function diff(path, oldText, newText, oldStart, newStart) {
  return { path, oldText, newText, ...(oldStart === undefined ? {} : { oldStart }), ...(newStart === undefined ? {} : { newStart }) }
}

test('transformFile：完整撤销（基线）', () => {
  const file = {
    path: 'a.txt',
    diffs: [diff('a.txt', 'hello\n', 'hello v2\n', 1, 1)],
  }
  assert.equal(transformFile('hello v2\n', file, 'undo'), 'hello\n')
  assert.equal(transformFile('hello\n', file, 'redo'), 'hello v2\n')
})

test('transformFile：hunk 子集撤销——只撤销选中的块，其余保留', () => {
  // 两个互不重叠的改动块：块 1 在第 1-3 行，块 2 在第 10-12 行。
  const original = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11', 'l12'].join('\n') + '\n'
  const edited = ['L1', 'L2', 'L3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'L10', 'L11', 'L12'].join('\n') + '\n'
  const file = {
    path: 'multi.txt',
    diffs: [
      diff('multi.txt', 'l1\nl2\nl3\n', 'L1\nL2\nL3\n', 1, 1),
      diff('multi.txt', 'l10\nl11\nl12\n', 'L10\nL11\nL12\n', 10, 10),
    ],
  }
  // 全部撤销：回到 original。
  assert.equal(transformFile(edited, file, 'undo'), original)
  // 子集 = 只撤销块 2（下标 1）：块 1 的 L1-L3 保留。
  const subset = { path: 'multi.txt', diffs: [file.diffs[1]] }
  assert.equal(transformFile(edited, subset, 'undo'),
    ['L1', 'L2', 'L3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11', 'l12'].join('\n') + '\n')
  // 子集 = 只撤销块 1：块 2 的 L10-L12 保留。
  const first = { path: 'multi.txt', diffs: [file.diffs[0]] }
  assert.equal(transformFile(edited, first, 'undo'),
    ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'L10', 'L11', 'L12'].join('\n') + '\n')
  // 锚点错位/内容不匹配 → conflict 语义（返回 null）。
  assert.equal(transformFile('totally different\n', file, 'undo'), null)
})

test('transformFile：空 diffs 不可还原', () => {
  assert.equal(transformFile('anything\n', { path: 'x', diffs: [] }, 'undo'), null)
})

test('录制持久化：跨实例往返（懒加载 + 防抖落盘）', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-fr-'))
  try {
    const ctx = new Context()
    const first = new FileReviewService(ctx, { storageDir })
    first.recordMutation(fakeAgent('agent-roundtrip'), {
      rootCallId: 'root-1',
      name: 'edit',
      path: 'a.txt',
      before: 'old\n',
      after: 'new\n',
    })
    first.recordMutation(fakeAgent('agent-roundtrip'), {
      rootCallId: 'root-2',
      name: 'write',
      path: 'b.txt',
      before: null,
      after: 'created\n',
    })
    // 等待防抖窗口（400ms）+ 写入完成。
    await new Promise((resolve) => { setTimeout(resolve, 800) })
    // 记录文件存在（文件名 = agentKey 哈希）。
    const roundtripHash = createHash('sha256').update('agent-roundtrip').digest('hex').slice(0, 16)
    const roundtripRecord = join(storageDir, 'file-review', 'recorded', `agent-roundtrip-${roundtripHash}.json`)
    await readFile(roundtripRecord, 'utf8')

    // 新实例（模拟宿主重启）：recorded() 触发懒加载，磁盘记录可见。
    const second = new FileReviewService(new Context(), { storageDir })
    const result = await second.recorded(fakeAgent('agent-roundtrip'), { rootCallIds: ['root-1', 'root-2'] })
    assert.deepEqual(result.mutations.map(m => m.rootCallId), ['root-1', 'root-2'], '磁盘记录按 dispatch 顺序返回')
    assert.equal(result.mutations[0].path, 'a.txt')
    assert.equal(result.mutations[1].before, null)

    // 加载后再录制：直接追加并再次落盘；重启后仍可见（合并顺序：磁盘在前）。
    second.recordMutation(fakeAgent('agent-roundtrip'), {
      rootCallId: 'root-3',
      name: 'edit',
      path: 'c.txt',
      before: 'x\n',
      after: 'y\n',
    })
    await new Promise((resolve) => { setTimeout(resolve, 800) })
    const third = new FileReviewService(new Context(), { storageDir })
    const all = await third.recorded(fakeAgent('agent-roundtrip'), { rootCallIds: ['root-1', 'root-2', 'root-3'] })
    assert.deepEqual(all.mutations.map(m => m.rootCallId), ['root-1', 'root-2', 'root-3'])

    // rootCallIds 过滤仍然生效。
    const filtered = await third.recorded(fakeAgent('agent-roundtrip'), { rootCallIds: ['root-2'] })
    assert.deepEqual(filtered.mutations.map(m => m.rootCallId), ['root-2'])
  } finally {
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('录制持久化：损坏记录文件静默从空开始并被重写', async () => {
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-fr-'))
  try {
    // 与 recordsFilename 同规则：agentKey 的 sha256 前 16 位。
    const hash = createHash('sha256').update('agent-broken').digest('hex').slice(0, 16)
    const recordPath = join(storageDir, 'file-review', 'recorded', `agent-broken-${hash}.json`)
    await mkdir(dirname(recordPath), { recursive: true })
    await writeFile(recordPath, 'NOT JSON{{', 'utf8')
    const ctx = new Context()
    const service = new FileReviewService(ctx, { storageDir })
    const before = await service.recorded(fakeAgent('agent-broken'), { rootCallIds: ['r1'] })
    assert.deepEqual(before.mutations, [], '损坏文件读取为空')
    // 新录制照常工作并覆盖损坏文件。
    service.recordMutation(fakeAgent('agent-broken'), {
      rootCallId: 'r1', name: 'edit', path: 'x.txt', before: null, after: 'hi\n',
    })
    await new Promise((resolve) => { setTimeout(resolve, 800) })
    const written = await readFile(recordPath, 'utf8')
    const parsed = JSON.parse(written)
    assert.equal(parsed.version, 1)
    assert.equal(parsed.mutations.length, 1)
  } finally {
    await rm(storageDir, { recursive: true, force: true })
  }
})
