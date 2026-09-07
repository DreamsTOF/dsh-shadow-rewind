/**
 * mergeToolFsEntries 的合并语义测试（轮尾卡片 / live 条的「每路径一行」）：
 * 工具条目与检查点 fs 条目按 pathKey 归一合并；仅当工具条目不可逆
 * （本轮新建后同轮又修改）时，改用 fs 净条目。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeToolFsEntries, pathKey } from '../lib/client-session-changes.js'
import { fsTurnReviews } from '../lib/client-fs-diff-utils.js'

const P = '文件工具测试.txt'

/** 工具写盘：write 创建（oldText=null）后同轮又被 edit 修改 → 混合 hunk，不可逆。 */
function createThenEditEntry() {
  return {
    path: P,
    diffs: [
      { path: P, oldText: null, newText: 'line1\nline2\nline3\n' },
      { path: P, oldText: 'line1', newText: 'line1-x' },
      { path: P, oldText: 'line2', newText: 'line2-x' },
      { path: P, oldText: 'line3', newText: 'line3-x' },
    ],
  }
}

test('新建后同轮又修改：工具条目不可逆，改用 fs 净条目（计数 = 最终行数）', () => {
  const fs = { path: P, diffs: [], origin: 'fs', counts: { added: 3, removed: 0 } }
  const merged = mergeToolFsEntries([createThenEditEntry()], [fs])
  assert.equal(merged.length, 1, '同一文件只保留一行')
  assert.equal(merged[0].origin, 'fs', '改用检查点 fs 条目')
  assert.deepEqual(merged[0].counts, { added: 3, removed: 0 }, '计数是净变化 +3')
})

test('纯编辑（文件已存在）：工具条目可逆，保持工具优先', () => {
  const tool = { path: P, diffs: [{ path: P, oldText: 'a', newText: 'b' }] }
  const fs = { path: P, diffs: [], origin: 'fs', counts: { added: 1, removed: 1 } }
  const merged = mergeToolFsEntries([tool], [fs])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].origin, undefined, '保持工具条目')
  assert.deepEqual(merged[0].diffs, tool.diffs)
})

test('纯新建（write 单 hunk）：工具条目可逆，保持工具优先', () => {
  const tool = { path: P, diffs: [{ path: P, oldText: null, newText: 'a\nb\nc\n' }] }
  const fs = { path: P, diffs: [], origin: 'fs', counts: { added: 3, removed: 0 } }
  const merged = mergeToolFsEntries([tool], [fs])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].origin, undefined, '保持工具条目')
})

test('反斜杠 / 正斜杠同路径：归一后只保留一行', () => {
  const tool = { path: 'dir\\file.txt', diffs: [{ path: 'dir\\file.txt', oldText: 'a', newText: 'b' }] }
  const fs = { path: 'dir/file.txt', diffs: [], origin: 'fs', counts: { added: 1, removed: 1 } }
  const merged = mergeToolFsEntries([tool], [fs])
  assert.equal(merged.length, 1)
  assert.equal(pathKey(tool.path), pathKey(fs.path))
})

test('仅 fs 条目（终端写盘）：原样保留', () => {
  const fs = { path: P, diffs: [], origin: 'fs', counts: { added: 3, removed: 0 } }
  const merged = mergeToolFsEntries([], [fs])
  assert.equal(merged.length, 1)
  assert.equal(merged[0].origin, 'fs')
})

test('无 fs 条目：工具条目原样返回（含不可逆的新建+修改）', () => {
  const tool = createThenEditEntry()
  const merged = mergeToolFsEntries([tool], [])
  assert.equal(merged.length, 1)
  assert.equal(merged[0], tool, '无 fs 兜底时保留工具条目')
})

test('fs 条目归属过滤：其它会话的写盘不进轮尾卡片 / live 条', () => {
  const turn = {
    turn: 1,
    turnStartSeq: 10,
    checkpointId: 'cp-a',
    nextCheckpointId: 'cp-b',
    changes: [
      { path: 'mine.txt', kind: 'added', added: 3, removed: 0, owner: 'target', autoSelect: true },
      { path: 'other-session.txt', kind: 'added', added: 5, removed: 0, owner: 'session-A', autoSelect: false },
      { path: 'manual.txt', kind: 'modified', added: 1, removed: 1, owner: 'unknown' },
      { path: 'both.txt', kind: 'modified', added: 2, removed: 2, owner: 'multi' },
      { path: 'legacy.txt', kind: 'added', added: 1, removed: 0 },
    ],
  }
  const reviews = fsTurnReviews(turn)
  assert.deepEqual(
    reviews.map(review => review.path),
    ['mine.txt', 'manual.txt', 'both.txt', 'legacy.txt'],
    '仅隐藏 owner = 其它会话 id 的条目',
  )
})
