/**
 * 变更模型（session-changes）的共享原语测试：路径键归一 + fs 条目的可逆形状判定。
 * 变更事实的唯一来源是检查点 diff，客户端不再有任何推导/合并数学。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { canonicalKey, pathKey, reversibleOf, resolveSessionPath } from '../lib/client-session-changes.js'

const P = 'dir/file.txt'

test('pathKey：反斜杠与正斜杠归一为同一键', () => {
  assert.equal(pathKey('dir\\file.txt'), pathKey('dir/file.txt'))
})

test('canonicalKey：工作区绝对路径折成相对键', () => {
  assert.equal(canonicalKey('D:\\ws\\dir\\file.txt', 'D:\\ws'), 'dir/file.txt')
  assert.equal(canonicalKey('./dir/file.txt', undefined), 'dir/file.txt')
  assert.equal(canonicalKey('dir/file.txt', undefined), 'dir/file.txt')
})

test('resolveSessionPath：相对路径按会话工作区解析成展示路径', () => {
  assert.equal(resolveSessionPath('D:\\ws', 'a.txt'), 'D:\\ws\\a.txt')
  assert.equal(resolveSessionPath('/ws', 'a.txt'), '/ws/a.txt')
  assert.equal(resolveSessionPath('/ws', '/abs/a.txt'), '/abs/a.txt')
})

test('可逆判定：目录条目（mkdir/rmdir 互逆）', () => {
  assert.equal(reversibleOf({ path: P, diffs: [], dir: true }), true)
})

test('可逆判定：整文件新增（oldText=null）与删除（newText 为空）', () => {
  assert.equal(reversibleOf({ path: P, diffs: [{ path: P, oldText: null, newText: 'a\n' }] }), true)
  assert.equal(reversibleOf({ path: P, diffs: [{ path: P, oldText: 'a\n', newText: '' }] }), true)
})

test('可逆判定：mode-only 条目（内容两侧相同、权限位不同）', () => {
  assert.equal(reversibleOf({
    path: P,
    diffs: [{ path: P, oldText: 'a\n', newText: 'a\n', oldMode: 0o644, newMode: 0o755 }],
  }), true)
  // 内容相同但权限位相同 → 没有可执行的动作。
  assert.equal(reversibleOf({
    path: P,
    diffs: [{ path: P, oldText: 'a\n', newText: 'a\n', oldMode: 0o644, newMode: 0o644 }],
  }), false)
})

test('可逆判定：带行锚点的普通编辑 hunk 可逆', () => {
  assert.equal(reversibleOf({
    path: P,
    diffs: [{ path: P, oldText: 'a\n', newText: 'b\n', oldStart: 1, newStart: 1 }],
  }), true)
})

test('可逆判定：空侧缺锚点的 hunk 不可回放（宿主会拒绝）', () => {
  assert.equal(reversibleOf({
    path: P,
    diffs: [{ path: P, oldText: '', newText: 'b\n' }],
  }), false)
})