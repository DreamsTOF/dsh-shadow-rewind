/**
 * 字符级行内高亮内核测试（自 dsh-edit-diff 移植的 Myers 字符 diff）：
 * 区间正确性、连续区间合并、空串/超长降级、还原一致性。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAR_HIGHLIGHT_MAX_CHARS, lineHighlight } from '../lib/char-highlight.js'

test('相同文本：无高亮区间', () => {
  const hl = lineHighlight('hello', 'hello')
  assert.deepEqual(hl.del, [])
  assert.deepEqual(hl.add, [])
})

test('单字符替换：两侧各一个精确区间', () => {
  const hl = lineHighlight('hello world', 'hello World')
  assert.deepEqual(hl.del, [[6, 7]])
  assert.deepEqual(hl.add, [[6, 7]])
})

test('中间子串替换：高亮段外两侧一致（strip 还原不变量）', () => {
  const oldStr = 'const value = 1'
  const newStr = 'const count = 1'
  const hl = lineHighlight(oldStr, newStr)
  assert.ok(hl.del.length > 0 && hl.add.length > 0, '存在变化段')
  // Myers 的具体编辑脚本可能保留任意公共字符（如 value/count 的 u），
  // 强不变量是：去掉高亮段后两侧剩余完全一致，且每个高亮段两侧内容不同。
  for (const [start, end] of hl.del) {
    assert.notEqual(oldStr.slice(start, end), newStr.slice(start, end))
  }
  assert.equal(strip(oldStr, hl.del), strip(newStr, hl.add))
})

function strip(text, ranges) {
  let out = ''
  let cursor = 0
  for (const [start, end] of ranges) {
    out += text.slice(cursor, start)
    cursor = end
  }
  return out + text.slice(cursor)
}

test('纯插入/纯删除：单侧全区间', () => {
  const added = lineHighlight('abc', 'abcXYZ')
  assert.deepEqual(added.del, [])
  assert.deepEqual(added.add, [[3, 6]])
  const removed = lineHighlight('abcXYZ', 'abc')
  assert.deepEqual(removed.del, [[3, 6]])
  assert.deepEqual(removed.add, [])
})

test('空串：整行区间', () => {
  assert.deepEqual(lineHighlight('', 'abc'), { del: [], add: [[0, 3]] })
  assert.deepEqual(lineHighlight('abc', ''), { del: [[0, 3]], add: [] })
  assert.deepEqual(lineHighlight('', ''), { del: [], add: [] })
})

test('多个不连续变化段：区间有序、不重叠、strip 还原一致', () => {
  const oldStr = 'a-b-c'
  const newStr = 'a=B=C'
  const hl = lineHighlight(oldStr, newStr)
  for (const ranges of [hl.del, hl.add]) {
    for (let i = 1; i < ranges.length; i++) {
      assert.ok(ranges[i - 1][1] <= ranges[i][0], '区间有序且不重叠')
    }
  }
  assert.ok(hl.del.every(([start, end]) => oldStr.slice(start, end) !== newStr.slice(start, end)))
  assert.equal(strip(oldStr, hl.del), strip(newStr, hl.add))
})

test('超长行降级：放弃高亮（空区间）', () => {
  const long1 = 'a'.repeat(CHAR_HIGHLIGHT_MAX_CHARS + 1)
  const long2 = `a${'a'.repeat(CHAR_HIGHLIGHT_MAX_CHARS + 1)}`
  const hl = lineHighlight(long1, long2)
  assert.deepEqual(hl.del, [])
  assert.deepEqual(hl.add, [])
})

test('区间切片还原：变化段内容确实不同、非变化段相同', () => {
  const oldStr = 'function foo(a, b) { return a + b }'
  const newStr = 'function foo(x, y) { return x + y }'
  const hl = lineHighlight(oldStr, newStr)
  for (const [start, end] of hl.del) {
    assert.notEqual(oldStr.slice(start, end), newStr.slice(start, end))
  }
  // 去掉高亮段后两侧剩余应一致（变化只在区间内）。
  const strip = (text, ranges) => {
    let out = ''
    let cursor = 0
    for (const [start, end] of ranges) {
      out += text.slice(cursor, start)
      cursor = end
    }
    return out + text.slice(cursor)
  }
  assert.equal(strip(oldStr, hl.del), strip(newStr, hl.add))
})
