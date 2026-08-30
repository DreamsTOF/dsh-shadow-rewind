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

// ── fs 撤销的删除安全网（rescue 副本）与 origin 标记 ─────────────────────

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
