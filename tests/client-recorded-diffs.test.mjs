/**
 * coalesceCreatedFileDiffs 的收敛语义测试：「本轮新建 + 同轮又修改」的混合
 * hunk 序列收敛为单条 added 净形状（统计 = 最终行数，撤销 = 删除文件）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { coalesceCreatedFileDiffs } from '../lib/client-recorded-diffs.js'

const P = '文件工具测试-新.txt'

/** write 新建 3 行 + 3 次 edit（各 −1 +1）：毛统计 +6 −3、不可逆的坏形状。 */
function createThenEdit() {
  return [
    { path: P, oldText: null, newText: 'line1\nline2\nline3\n' },
    { path: P, oldText: 'line1', newText: 'alpha' },
    { path: P, oldText: 'line2', newText: 'beta' },
    { path: P, oldText: 'line3', newText: 'gamma' },
  ]
}

test('新建后同轮修改：收敛为单条 added，newText = 回放后的最终全文', () => {
  const coalesced = coalesceCreatedFileDiffs(createThenEdit())
  assert.equal(coalesced.length, 1)
  assert.deepEqual(coalesced[0], {
    path: P,
    oldText: null,
    newText: 'alpha\nbeta\ngamma\n',
  })
})

test('回放失配（oldText 不在场）：保守保留原序列，绝不猜', () => {
  const broken = [
    { path: P, oldText: null, newText: 'a\n' },
    { path: P, oldText: '不存在的行', newText: 'x' },
  ]
  assert.equal(coalesceCreatedFileDiffs(broken), broken, '原样返回同一引用')
})

test('纯编辑序列（无创建 hunk）：不收敛', () => {
  const edits = [
    { path: P, oldText: 'a', newText: 'b' },
    { path: P, oldText: 'c', newText: 'd' },
  ]
  assert.equal(coalesceCreatedFileDiffs(edits), edits)
})

test('单条 hunk（纯新建 / 纯编辑）：原样返回', () => {
  const single = [{ path: P, oldText: null, newText: 'a\n' }]
  assert.equal(coalesceCreatedFileDiffs(single), single)
})

test('多次 write 覆盖：从最后一个创建 hunk 起收敛（更早历史被覆盖）', () => {
  const coalesced = coalesceCreatedFileDiffs([
    { path: P, oldText: null, newText: 'v1\n' },
    { path: P, oldText: null, newText: 'v2\n' },
    { path: P, oldText: 'v2', newText: 'v3' },
  ])
  assert.deepEqual(coalesced, [{ path: P, oldText: null, newText: 'v3\n' }])
})

test('带行锚点的编辑 hunk：按锚点定位回放', () => {
  const coalesced = coalesceCreatedFileDiffs([
    { path: P, oldText: null, newText: 'one\ntwo\nthree\n' },
    { path: P, oldText: 'two', newText: 'TWO', oldStart: 2, newStart: 2 },
  ])
  assert.deepEqual(coalesced, [{ path: P, oldText: null, newText: 'one\nTWO\nthree\n' }])
})

test('行锚点失配（内容漂移）：保守保留原序列', () => {
  const broken = [
    { path: P, oldText: null, newText: 'one\ntwo\n' },
    { path: P, oldText: 'two', newText: 'TWO', oldStart: 3 },
  ]
  assert.equal(coalesceCreatedFileDiffs(broken), broken)
})
