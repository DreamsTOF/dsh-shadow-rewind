/**
 * 文件审查半边测试：hunk 子集撤销（块级「撤销/保留」的宿主语义）与
 * Code Mode 录制记录的磁盘持久化往返。不依赖 dsh 运行时——FileReviewService
 * 只需一个 cordis 根 Context（TypertRemoteService 的注册基类）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, readdir } from 'node:fs/promises'
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

// ── 文件系统级变更（检查点对比产生的新增/删除形状）撤销语义 ──────────────

function fsAgent(cwd) {
  return { id: 'agent-fs', runMaintenance: (fn) => fn(), session: { header: { cwd } } }
}

async function assertFileAbsent(path) {
  await assert.rejects(() => readFile(path), { code: 'ENOENT' })
}

test('fs 语义：新增文件——撤销即删除，重做即重新创建', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsadd-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    const target = join(workspace, 'created.txt')
    await writeFile(target, 'made by terminal\n', 'utf8')
    const request = {
      files: [{ path: 'created.txt', diffs: [diff('created.txt', null, 'made by terminal\n')] }],
    }

    // 文件存在且内容匹配 → applied。
    const status = await service.status(agent, request)
    assert.equal(status.files[0].state, 'applied')

    // 撤销 = 删除文件。
    const undone = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(undone.files[0].state, 'undone')
    assert.equal(undone.files[0].changed, true)
    await assertFileAbsent(target)

    // 重做 = 重新创建。
    const redone = await service.apply(agent, { ...request, action: 'redo' })
    assert.equal(redone.files[0].state, 'applied')
    assert.equal(redone.files[0].changed, true)
    assert.equal(await readFile(target, 'utf8'), 'made by terminal\n')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('fs 语义：删除文件——撤销即写回旧内容，重做即再次删除', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsdel-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    const target = join(workspace, 'sub', 'removed.txt')
    // 磁盘上文件已被删除（模拟终端删除后的状态）。
    const request = {
      files: [{ path: 'sub/removed.txt', diffs: [diff('sub/removed.txt', 'precious content\n', '')] }],
    }

    // 文件不存在 → applied（删除已生效）。
    const status = await service.status(agent, request)
    assert.equal(status.files[0].state, 'applied')

    // 撤销 = 写回旧内容（父目录按需重建）。
    const undone = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(undone.files[0].state, 'undone')
    assert.equal(undone.files[0].changed, true)
    assert.equal(await readFile(target, 'utf8'), 'precious content\n')

    // 重做 = 再次删除。
    const redone = await service.apply(agent, { ...request, action: 'redo' })
    assert.equal(redone.files[0].state, 'applied')
    assert.equal(redone.files[0].changed, true)
    await assertFileAbsent(target)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('fs 语义：内容与记录不符 → conflict，不做任何写盘', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fscf-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    // 新增形状但磁盘内容已被外部改过。
    await writeFile(join(workspace, 'drift.txt'), 'someone edited later\n', 'utf8')
    const addRequest = {
      files: [{ path: 'drift.txt', diffs: [diff('drift.txt', null, 'original new content\n')] }],
    }
    const addStatus = await service.status(agent, addRequest)
    assert.equal(addStatus.files[0].state, 'conflict')
    const addUndo = await service.apply(agent, { ...addRequest, action: 'undo' })
    assert.equal(addUndo.files[0].state, 'conflict')
    assert.equal(addUndo.files[0].changed, false)
    assert.equal(await readFile(join(workspace, 'drift.txt'), 'utf8'), 'someone edited later\n')

    // 删除形状但文件以不同内容重新出现。
    await writeFile(join(workspace, 'back.txt'), 'not the old content\n', 'utf8')
    const delRequest = {
      files: [{ path: 'back.txt', diffs: [diff('back.txt', 'the recorded old content\n', '')] }],
    }
    const delStatus = await service.status(agent, delRequest)
    assert.equal(delStatus.files[0].state, 'conflict')
    const delRedo = await service.apply(agent, { ...delRequest, action: 'redo' })
    assert.equal(delRedo.files[0].state, 'conflict')
    assert.equal(delRedo.files[0].changed, false)
    assert.equal(await readFile(join(workspace, 'back.txt'), 'utf8'), 'not the old content\n')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

// ── EXPECTED-DESIGN 1.2：force 强制开关（用户在冲突弹窗授权「全部回滚」） ──

test('force：fs 内容漂移的冲突被强制覆盖（added 撤销 = 删除、deleted 重做 = 覆盖重建）', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-force-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    // added 形状但磁盘内容已被外部改过：普通 undo 报 conflict，force 删除。
    await writeFile(join(workspace, 'drift.txt'), 'someone edited later\n', 'utf8')
    const addRequest = {
      files: [{ path: 'drift.txt', diffs: [diff('drift.txt', null, 'original new content\n')] }],
    }
    const addUndo = await service.apply(agent, { ...addRequest, action: 'undo' })
    assert.equal(addUndo.files[0].state, 'conflict', '无 force 时拒绝')
    assert.equal(await readFile(join(workspace, 'drift.txt'), 'utf8'), 'someone edited later\n', '冲突时不动磁盘')
    const forcedUndo = await service.apply(agent, { ...addRequest, action: 'undo', force: true })
    assert.equal(forcedUndo.files[0].state, 'undone', 'force 覆盖冲突')
    assert.equal(forcedUndo.files[0].changed, true)
    await assertFileAbsent(join(workspace, 'drift.txt'))

    // deleted 形状但文件以不同内容重新出现：force 写回记录的旧内容。
    await writeFile(join(workspace, 'back.txt'), 'not the old content\n', 'utf8')
    const delRequest = {
      files: [{ path: 'back.txt', diffs: [diff('back.txt', 'the recorded old content\n', '')] }],
    }
    const delRedo = await service.apply(agent, { ...delRequest, action: 'redo' })
    assert.equal(delRedo.files[0].state, 'conflict', '无 force 时拒绝')
    assert.equal(await readFile(join(workspace, 'back.txt'), 'utf8'), 'not the old content\n')
    const forcedRedo = await service.apply(agent, { ...delRequest, action: 'redo', force: true })
    assert.equal(forcedRedo.files[0].state, 'applied', 'force 覆盖冲突')
    await assertFileAbsent(join(workspace, 'back.txt'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('force：目录「非空拒删」闸放开——先落逐文件 rescue 副本再递归删除', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-forcedir-'))
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-forcedir-store-'))
  try {
    const service = new FileReviewService(new Context(), { storageDir })
    const agent = fsAgent(workspace)
    // 本轮新建的空目录里被终端塞了文件：rmdir 报 ENOTEMPTY → conflict。
    await mkdir(join(workspace, 'newdir'), { recursive: true })
    await writeFile(join(workspace, 'newdir', 'stray.txt'), 'stray content\n', 'utf8')
    const request = {
      files: [{ path: 'newdir', dirKind: 'added', diffs: [] }],
    }
    const plainUndo = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(plainUndo.files[0].state, 'conflict', '非空目录默认拒绝删除')
    assert.equal(await readFile(join(workspace, 'newdir', 'stray.txt'), 'utf8'), 'stray content\n')
    // force：递归删除，但子文件先落 rescue 副本。
    const forcedUndo = await service.apply(agent, { ...request, action: 'undo', force: true })
    assert.equal(forcedUndo.files[0].state, 'undone', 'force 放开非空拒删闸')
    await assertFileAbsent(join(workspace, 'newdir'))
    const rescueFiles = await readdir(join(storageDir, 'file-review', 'rescue'))
    assert.ok(rescueFiles.some(name => name.includes('stray')), '子文件的 rescue 副本已落盘')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('force：hunk 锚点定位失败 → conflict（进二次回滚清单），绝不猜着改', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-forcehunk-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    // 内容漂移过大、锚点找不到：force 也只能如实报 conflict——
    // 客户端把它列入二次回滚清单，由用户决定后续（绝不猜着改）。
    await writeFile(join(workspace, 'lost.txt'), 'totally rewritten\n', 'utf8')
    const lostRequest = {
      files: [{ path: 'lost.txt', diffs: [diff('lost.txt', 'hello\n', 'hello v2\n', 1, 1)] }],
    }
    const plainUndo = await service.apply(agent, { ...lostRequest, action: 'undo' })
    assert.equal(plainUndo.files[0].state, 'conflict', '普通路径拒绝')
    const lostForce = await service.apply(agent, { ...lostRequest, action: 'undo', force: true })
    assert.equal(lostForce.files[0].state, 'conflict', '锚点定位失败进二次回滚清单')
    assert.ok(lostForce.files[0].reason?.includes('could not locate'), '原因点名强制回放定位失败')
    assert.equal(await readFile(join(workspace, 'lost.txt'), 'utf8'), 'totally rewritten\n', '定位失败绝不写盘')

    // 对照：漂移发生在 hunk 区域之外时锚点仍在——普通撤销本就成功
    //（transform 是局部回放，用户追加的行天然保留 = 1.3 的「保留手动小修改」）。
    await writeFile(join(workspace, 'shift.txt'), 'l1\nl2\nL3\nl4\nuser appended\n', 'utf8')
    const shiftRequest = {
      files: [{ path: 'shift.txt', diffs: [diff('shift.txt', 'l3\n', 'L3\n', 3, 3)] }],
    }
    const plainShift = await service.apply(agent, { ...shiftRequest, action: 'undo' })
    assert.equal(plainShift.files[0].state, 'undone', '区域外漂移不构成冲突')
    assert.equal(await readFile(join(workspace, 'shift.txt'), 'utf8'), 'l1\nl2\nl3\nl4\nuser appended\n',
      '锚点块被回滚，用户追加的行原样保留')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('fs 撤销安全网：fs-added 撤销删除前先落 rescue 副本；origin 标记随请求透传', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-rescue-ws-'))
  const storageDir = await mkdtemp(join(tmpdir(), 'shadow-rewind-rescue-store-'))
  try {
    await writeFile(join(workspace, 'made.txt'), 'made by terminal\n', 'utf8')
    const service = new FileReviewService(new Context(), { storageDir })
    const agent = fsAgent(workspace)
    // origin: 'fs' = 客户端对检查点派生条目的显式标记（与形状识别兼容）。
    const request = {
      files: [{ path: 'made.txt', diffs: [diff('made.txt', null, 'made by terminal\n')], origin: 'fs' }],
    }

    const undone = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(undone.files[0].state, 'undone')
    await assertFileAbsent(join(workspace, 'made.txt'))

    // 删除前必须落了可找回的副本，内容与被删文件一致。
    const rescueDir = join(storageDir, 'file-review', 'rescue')
    const entries = await readdir(rescueDir)
    assert.equal(entries.length, 1, 'rescue 目录必须恰好一份副本')
    assert.ok(entries[0].includes('made.txt'), '副本文件名带原路径净化名')
    assert.equal(await readFile(join(rescueDir, entries[0]), 'utf8'), 'made by terminal\n')

    // 重做恢复文件；再次撤销会再落一份新副本（旧的保留）。
    const redone = await service.apply(agent, { ...request, action: 'redo' })
    assert.equal(redone.files[0].state, 'applied')
    assert.equal(await readFile(join(workspace, 'made.txt'), 'utf8'), 'made by terminal\n')
    const undoneAgain = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(undoneAgain.files[0].state, 'undone')
    assert.equal((await readdir(rescueDir)).length, 2, '第二次删除新增一份副本')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(storageDir, { recursive: true, force: true })
  }
})

test('fs 巡检：检查点 LF 与磁盘 CRLF 的行尾差异不再误报冲突', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-crlf-'))
  try {
    // 磁盘 CRLF；检查点/派生 diff 的 newText 是 LF（blob 侧通常已规范化）。
    await writeFile(join(workspace, 'crlf.txt'), 'a\r\nb\r\n', 'utf8')
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    const request = {
      files: [{ path: 'crlf.txt', diffs: [diff('crlf.txt', null, 'a\nb\n')], origin: 'fs' }],
    }
    const status = await service.status(agent, request)
    assert.equal(status.files[0].state, 'applied', '行尾风格差异不算内容漂移')

    // CAS 同样按规范化比较：撤销（删除）可以执行。
    const undone = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(undone.files[0].state, 'undone')
    await assertFileAbsent(join(workspace, 'crlf.txt'))
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

// ── 权限位透传（mode-only 变更）与空目录撤销语义 ─────────────────────────

test('fs 语义：纯权限位变更——撤销/重做即 chmod，内容不动', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsmode-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    const target = join(workspace, 'perm.txt')
    await writeFile(target, 'same content\n', 'utf8')
    const oldMode = (await lstat(target)).mode & 0o777
    const newMode = oldMode === 0o444 ? 0o666 : 0o444
    await chmod(target, newMode) // 模拟轮内的 chmod 已生效
    const request = {
      files: [{
        path: 'perm.txt',
        diffs: [{ path: 'perm.txt', oldText: 'same content\n', newText: 'same content\n', oldMode, newMode }],
        origin: 'fs',
      }],
    }

    const status = await service.status(agent, request)
    assert.equal(status.files[0].state, 'applied', '磁盘 mode 落在新侧 → applied')

    const undone = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(undone.files[0].state, 'undone')
    assert.equal(undone.files[0].changed, true)
    assert.equal((await lstat(target)).mode & 0o777, oldMode, '撤销恢复旧侧权限位')
    assert.equal(await readFile(target, 'utf8'), 'same content\n', '内容不受影响')

    const redone = await service.apply(agent, { ...request, action: 'redo' })
    assert.equal(redone.files[0].state, 'applied')
    assert.equal(redone.files[0].changed, true)
    assert.equal((await lstat(target)).mode & 0o777, newMode, '重做恢复新侧权限位')

    // 内容漂移 → conflict，权限位也不动。
    await chmod(target, oldMode)
    await writeFile(target, 'someone edited\n', 'utf8')
    const drift = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(drift.files[0].state, 'conflict')
    assert.equal(drift.files[0].changed, false)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('fs 语义：空目录条目——撤销/重做即 rmdir/mkdir，非空拒删', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsdir-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)

    // 新增目录（dirKind added）：撤销 = 删空目录，重做 = 重建。
    await mkdir(join(workspace, 'fresh'))
    const addRequest = {
      files: [{ path: 'fresh', diffs: [{ path: 'fresh', oldText: null, newText: '' }], origin: 'fs', dirKind: 'added' }],
    }
    assert.equal((await service.status(agent, addRequest)).files[0].state, 'applied')
    const undone = await service.apply(agent, { ...addRequest, action: 'undo' })
    assert.equal(undone.files[0].state, 'undone')
    assert.equal(undone.files[0].changed, true)
    await assert.rejects(() => lstat(join(workspace, 'fresh')), { code: 'ENOENT' })
    const redone = await service.apply(agent, { ...addRequest, action: 'redo' })
    assert.equal(redone.files[0].state, 'applied')
    assert.equal(redone.files[0].changed, true)
    assert.ok((await lstat(join(workspace, 'fresh'))).isDirectory())

    // 非空目录 → conflict（rmdir 栅栏，绝不递归删）。
    await writeFile(join(workspace, 'fresh', 'child.txt'), 'x\n', 'utf8')
    const blocked = await service.apply(agent, { ...addRequest, action: 'undo' })
    assert.equal(blocked.files[0].state, 'conflict')
    assert.equal(blocked.files[0].changed, false)
    assert.ok((await lstat(join(workspace, 'fresh'))).isDirectory(), '非空目录必须原样保留')

    // 删除目录（dirKind deleted）：撤销 = 重建，重做 = 再删。
    const delRequest = {
      files: [{ path: 'gone', diffs: [{ path: 'gone', oldText: null, newText: '' }], origin: 'fs', dirKind: 'deleted' }],
    }
    assert.equal((await service.status(agent, delRequest)).files[0].state, 'applied', '目录不存在 = 删除已生效')
    const delUndone = await service.apply(agent, { ...delRequest, action: 'undo' })
    assert.equal(delUndone.files[0].state, 'undone')
    assert.equal(delUndone.files[0].changed, true)
    assert.ok((await lstat(join(workspace, 'gone'))).isDirectory())
    const delRedone = await service.apply(agent, { ...delRequest, action: 'redo' })
    assert.equal(delRedone.files[0].state, 'applied')
    assert.equal(delRedone.files[0].changed, true)
    await assert.rejects(() => lstat(join(workspace, 'gone')), { code: 'ENOENT' })
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('fs 语义：撤销写回恢复检查点记录的权限位', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fswmode-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    // fs-deleted 形状：撤销 = 写回旧内容；旧侧带 0o600 权限位。
    const request = {
      files: [{
        path: 'secret.txt',
        diffs: [{ path: 'secret.txt', oldText: 'private\n', newText: '', oldMode: 0o600, newMode: 0o600 }],
        origin: 'fs',
      }],
    }
    const undone = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(undone.files[0].state, 'undone')
    assert.equal(await readFile(join(workspace, 'secret.txt'), 'utf8'), 'private\n')
    // Windows 权限位语义受限，仅 POSIX 断言精确值。
    if (process.platform !== 'win32') {
      assert.equal((await lstat(join(workspace, 'secret.txt'))).mode & 0o777, 0o600)
    }
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

// ── 终端写真 hunk 化：modified 走多 hunk 子集路径，改到空不再误判删除 ────

test('fs 语义：modified 真 hunk 化——多块子集撤销往返不互踩', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fshunk-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    const target = join(workspace, 'multi.txt')
    const original = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11', 'l12'].join('\n') + '\n'
    const edited = ['L1', 'L2', 'L3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'L10', 'L11', 'L12'].join('\n') + '\n'
    // 磁盘处于「轮末」状态：两处不相邻的终端改动都在。
    await writeFile(target, edited, 'utf8')
    const hunks = [
      diff('multi.txt', 'l1\nl2\nl3\n', 'L1\nL2\nL3\n', 1, 1),
      diff('multi.txt', 'l10\nl11\nl12\n', 'L10\nL11\nL12\n', 10, 10),
    ]
    const full = { files: [{ path: 'multi.txt', diffs: hunks, origin: 'fs' }] }

    assert.equal((await service.status(agent, full)).files[0].state, 'applied')

    // 子集撤销：只提交块 2 → 块 1 的 L1-L3 原样保留。
    const subset = { files: [{ path: 'multi.txt', diffs: [hunks[1]], origin: 'fs' }] }
    const undone = await service.apply(agent, { ...subset, action: 'undo' })
    assert.equal(undone.files[0].state, 'undone')
    assert.equal(undone.files[0].changed, true)
    assert.equal(await readFile(target, 'utf8'),
      ['L1', 'L2', 'L3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11', 'l12'].join('\n') + '\n')

    // 同一子集重做 → 回到两块都在的轮末状态。
    const redone = await service.apply(agent, { ...subset, action: 'redo' })
    assert.equal(redone.files[0].state, 'applied')
    assert.equal(await readFile(target, 'utf8'), edited)

    // 全量撤销 → 回到轮起。
    const all = await service.apply(agent, { ...full, action: 'undo' })
    assert.equal(all.files[0].state, 'undone')
    assert.equal(await readFile(target, 'utf8'), original)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('fsChangeShape 守卫：带锚点的「改到空」hunk 不误判为整文件删除', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'shadow-rewind-fsempty-'))
  try {
    const service = new FileReviewService(new Context(), {})
    const agent = fsAgent(workspace)
    const target = join(workspace, 'emptied.txt')
    // 终端把文件截断为空：文件在场、内容为空 = 「改到空」已生效。
    await writeFile(target, '', 'utf8')
    const request = {
      files: [{ path: 'emptied.txt', diffs: [diff('emptied.txt', 'precious\n', '', 1, 1)], origin: 'fs' }],
    }

    // 守卫前该形状会被误判为整文件删除（要求文件不在场 → conflict）；
    // 守卫后走通用 hunk 路径：空内容 = newText 侧在场 → applied。
    assert.equal((await service.status(agent, request)).files[0].state, 'applied')

    // 撤销 = 经 hunk 路径写回旧内容（不是「文件缺失 → 写回」的删除语义）。
    const undone = await service.apply(agent, { ...request, action: 'undo' })
    assert.equal(undone.files[0].state, 'undone')
    assert.equal(undone.files[0].changed, true)
    assert.equal(await readFile(target, 'utf8'), 'precious\n')

    // 重做 = 再次截断为空。
    const redone = await service.apply(agent, { ...request, action: 'redo' })
    assert.equal(redone.files[0].state, 'applied')
    assert.equal(await readFile(target, 'utf8'), '')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

// ── F1：typert 线上契约——判别字段必须穿越编解码（而非被静默剥离）──────

test('wire schema：origin/dirKind/oldMode/newMode 穿越 parse 往返', async () => {
  const { wireSchemas } = await import('../lib/typert.host.js')
  const request = {
    action: 'undo',
    files: [
      {
        path: 'dir-a',
        diffs: [],
        origin: 'fs',
        dirKind: 'added',
      },
      {
        path: 'a.txt',
        diffs: [{ path: 'a.txt', oldText: 'x\n', newText: 'x\n', oldMode: 0o644, newMode: 0o755 }],
        origin: 'fs',
      },
    ],
  }
  const parsed = wireSchemas.requestSchema.parse(request)
  assert.equal(parsed.files[0].dirKind, 'added', 'dirKind 必须到达宿主（否则目录撤销走文件语义报 error）')
  assert.equal(parsed.files[0].origin, 'fs')
  assert.equal(parsed.files[1].diffs[0].oldMode, 0o644, 'oldMode 必须到达宿主（否则 mode-only 条目恒 unsupported）')
  assert.equal(parsed.files[1].diffs[0].newMode, 0o755)
})

test('wire schema：request 层 strict——未知字段显式报错而非静默剥离', async () => {
  const { wireSchemas } = await import('../lib/typert.host.js')
  assert.throws(
    () => wireSchemas.requestSchema.parse({
      action: 'undo',
      files: [{ path: 'a.txt', diffs: [], bogusField: 1 }],
    }),
    (error) => error instanceof Error,
    '未知字段必须显式失败（静默剥离曾让判别字段丢失无从排查）',
  )
})

// ── H4/E2：录制产线的 LF 归一、空文件保留与白名单 ──────────────────────────

test('H4：CRLF 文件的 run_code 录制 hunk 与宿主 LF 基线对齐', async () => {
  const { diffsFromBeforeAfter } = await import('../lib/client-recorded-diffs.js')
  const hunks = diffsFromBeforeAfter('a.txt', 'hello\r\nworld\r\n', 'hello\r\nbrave\r\nworld\r\n')
  assert.equal(hunks.length, 1)
  assert.ok(!hunks[0].newText.includes('\r'), 'hunk 行尾不得携带 CR（宿主在 LF 文本上锚点匹配）')
  assert.ok(!hunks[0].oldText.includes('\r'))
  // 撤销可回放性：宿主 transformFile 在归一文本上命中锚点。
  const file = { path: 'a.txt', diffs: hunks }
  const restored = transformFile('hello\r\nbrave\r\nworld\r\n'.replace(/\r\n/g, '\n'), file, 'undo')
  assert.equal(restored, 'hello\nworld\n')
})

test('H4/J7：run_code 创建空文件不再被静默丢弃（added 语义与 write 同形）', async () => {
  const { diffsFromBeforeAfter } = await import('../lib/client-recorded-diffs.js')
  const hunks = diffsFromBeforeAfter('empty.txt', null, '')
  assert.deepEqual(hunks, [{ path: 'empty.txt', oldText: null, newText: '' }])
})

// ── H3：统一 CAS ──────────────────────────────────────────────────────────

test('H3：contentMatches 按 LF 归一比较，CRLF 与 LF 内容等价', async () => {
  const { contentMatches } = await import('../lib/file-review/cas.js')
  assert.equal(contentMatches(Buffer.from('a\r\nb\r\n'), Buffer.from('a\nb\n')), true)
  assert.equal(contentMatches(Buffer.from('a\nb\n'), Buffer.from('a\nc\n')), false)
})

test('H3：hunk 撤销对「仅行尾漂移」不再误报冲突，写回还原当前行尾', async () => {
  // applyOne 的 CAS 现按统一规则（LF 归一）比较——同一内容仅行尾不同的
  // 两次读取不再判 conflict，且写回还原重读内容的行尾风格。
  const { transformFile } = await import('../lib/file-review/file-review-service.js')
  const file = { path: 'a.txt', diffs: [{ path: 'a.txt', oldText: 'hello\n', newText: 'hi\n', oldStart: 1, newStart: 1 }] }
  assert.equal(transformFile('hi\n', file, 'undo'), 'hello\n')
})
