/**
 * diffsFromBeforeAfter 的形状测试：检查点前后两侧全文 → 行级 hunk。
 * 关键契约：新建文件 = 单条 oldText=null（撤销=删除）；空文件也是真实变更；
 * CRLF 归一后不产生假冲突；无实际改动返回空。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { diffsFromBeforeAfter } from '../lib/client-diff-build.js'

const P = 'diff-build-test.txt'

test('新建文件（before=null）：单条整文件 added，空文件也保留', () => {
  assert.deepEqual(diffsFromBeforeAfter(P, null, 'a\nb\n'), [
    { path: P, oldText: null, newText: 'a\nb\n' },
  ])
  assert.deepEqual(diffsFromBeforeAfter(P, null, ''), [
    { path: P, oldText: null, newText: '' },
  ])
})

test('无实际改动：返回空数组（纯 CRLF 差异同样不算改动）', () => {
  assert.deepEqual(diffsFromBeforeAfter(P, 'same\n', 'same\n'), [])
  assert.deepEqual(diffsFromBeforeAfter(P, 'a\r\nb\r\n', 'a\nb\n'), [])
})

test('普通编辑：切出带行锚点的 hunk，内容可回放', () => {
  const hunks = diffsFromBeforeAfter(P, 'one\ntwo\nthree\n', 'one\nTWO\nthree\n')
  assert.equal(hunks.length, 1)
  const hunk = hunks[0]
  assert.equal(hunk.path, P)
  assert.ok(hunk.oldText.includes('two'))
  assert.ok(hunk.newText.includes('TWO'))
  assert.equal(typeof hunk.oldStart, 'number')
  assert.equal(typeof hunk.newStart, 'number')
})

test('远处两处改动：切成两个 hunk（各自带上下文）', () => {
  const before = Array.from({ length: 30 }, (_, index) => `line${String(index + 1)}`).join('\n')
  const after = before.replace('line2', 'LINE2').replace('line28', 'LINE28')
  const hunks = diffsFromBeforeAfter(P, before, after)
  assert.equal(hunks.length, 2)
  for (const hunk of hunks) {
    assert.equal(typeof hunk.oldStart, 'number')
    assert.equal(typeof hunk.newStart, 'number')
  }
})

test('整文件删除：newText 为空（宿主写回旧内容）', () => {
  const hunks = diffsFromBeforeAfter(P, 'gone\n', '')
  assert.equal(hunks.length, 1)
  assert.equal(hunks[0].newText, '')
  assert.ok(hunks[0].oldText.includes('gone'))
})