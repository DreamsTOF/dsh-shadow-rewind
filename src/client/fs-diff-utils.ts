/**
 * 文件系统级变更（由检查点对比发现的 PowerShell / 终端写盘）的 diff 工具层。
 *
 * **归属语义**：第 N 轮的文件系统变更 = diff(第 N 轮的轮起检查点, 第 N+1 轮
 * 的轮起检查点)——第 N+1 轮第一步之前的捕获，就是第 N 轮轮末的树状态。宿主
 * 的 `/shadow-rewind/fs-changes` 端点已经做好了这层配对（外加一条把最新检查
 * 点与当前磁盘相比的 live-tail 条目）。
 *
 * **计数先行、全文按需**：同一次构建里宿主任顺便把每条变更的增/删行数算好，
 * 客户端因此能**零全文请求**渲染文件行与统计条；完整内容挂在按
 * (轮 × 路径) 的懒加载层上——只有真正要展示 diff 或执行撤销时才去拉
 * （悬停浮层、展开行、撤销提交），并记忆化到该轮缓存条目变化为止（warm
 * 替换会让该轮记忆失效）。
 */
import type { ProducedFileDiff, ProducedFileReview } from '../file-review/change-types.ts'
import type { FsAttributionFields, TurnFileChanges, SessionFileChange } from './session-changes.ts'
import { diffsFromBeforeAfter } from './recorded-diffs.ts'

/** 与宿主 hunk 数学同一基准的换行归一（file-review-service 的 normalizeNewlines 语义）。 */
function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/** One fs-level change; added/removed 是服务端预算好的行数（缺省 = 旧宿主）。 */
export interface FsChange extends FsAttributionFields {
  readonly path: string
  readonly kind: 'added' | 'modified' | 'deleted'
  readonly added?: number
  readonly removed?: number
  /** 检查点记录的两侧权限位（透传给宿主，写回时恢复）。 */
  readonly oldMode?: number
  readonly newMode?: number
  /** 空目录条目：撤销语义是 mkdir/rmdir，无全文。 */
  readonly dir?: boolean
}

/** 归因字段投影（占位/补齐/提交各构造点共用）：全缺省时返回空对象。 */
export function fsAttributionOf(source: FsAttributionFields): FsAttributionFields {
  return {
    ...(source.owner !== undefined ? { owner: source.owner } : {}),
    ...(source.autoSelect !== undefined ? { autoSelect: source.autoSelect } : {}),
    ...(source.attribution !== undefined ? { attribution: source.attribution } : {}),
    ...(source.command !== undefined ? { command: source.command } : {}),
    ...(source.writtenAt !== undefined ? { writtenAt: source.writtenAt } : {}),
  }
}

/** `/shadow-rewind/fs-changes` 返回的一轮文件系统变更。 */
export interface FsChangeTurn {
  readonly turn: number
  /** turn/start 事件 seq——每会话每轮唯一，正是缓存键。 */
  readonly turnStartSeq: number
  readonly checkpointId: string
  /** 下一轮的检查点 id，或 'live'（= 与当前磁盘相比）。 */
  readonly nextCheckpointId: string
  readonly live?: boolean
  /** 条目进入模块缓存时才带上（warm 知道会话）。 */
  readonly sessionId?: string
  readonly changes: readonly FsChange[]
}

/** /shadow-rewind/fs-changes 响应（含数据版本 rev，见 warmFsChanges）。 */
export interface FsChangesPayload {
  readonly turns: readonly FsChangeTurn[]
  /** 工作区数据版本：检查点捕获/恢复成功即递增；缺省 = 旧宿主。 */
  readonly rev?: number
}

/**
 * 经 HTTP 按检查点读取文件内容。找不到或判定为二进制（NUL 字节守卫）时返回
 * null——调用方一律把 null 当作「全文不可得」，而不是空文件。
 */
export async function fetchCheckpointFileContent(
  checkpointId: string,
  path: string,
  cwd: string,
): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      checkpointId,
      path,
      cwd,
    })
    const response = await fetch(`/shadow-rewind/file?${params}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return null
    const data: unknown = await response.json()
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
    const record = data as Record<string, unknown>
    if (typeof record.content !== 'string' || record.encoding !== 'base64') return null
    // base64 → UTF-8 文本：光靠 atob 得到的是二进制字符串，会把多字节
    // UTF-8 序列拆成乱码字符，必须再过一遍 TextDecoder。
    const binary = atob(record.content)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    const text = new TextDecoder('utf-8').decode(bytes)
    // 二进制内容不强行按 UTF-8 渲染：NUL 字节几乎必然是二进制。
    return text.includes('\u0000') ? null : text
  } catch {
    return null
  }
}

/** 命令归因引用的宽松解析（形状非法返回 null）。 */
function parseFsCommand(raw: unknown): FsChange['command'] | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (typeof record.tool !== 'string' || record.tool === '') return null
  if (typeof record.sessionId !== 'string' || record.sessionId === '') return null
  if (typeof record.startedAt !== 'number' || typeof record.endedAt !== 'number') return null
  return {
    tool: record.tool,
    ...(typeof record.callId === 'string' && record.callId !== '' ? { callId: record.callId } : {}),
    sessionId: record.sessionId,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
  }
}

/**
 * 从批量端点拉取所有轮次的文件系统变更。
 * 宽松解析：未知 / 缺失字段一律降级（条目丢了就丢了），绝不因一个坏字段
 * 让整个审查面白屏。
 */
export async function fetchAllFsChanges(sessionId: string): Promise<FsChangesPayload> {
  try {
    const response = await fetch(`/shadow-rewind/fs-changes?sessionId=${encodeURIComponent(sessionId)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) return { turns: [] }
    const data: unknown = await response.json()
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return { turns: [] }
    const record = data as Record<string, unknown>
    if (!Array.isArray(record.turns)) return { turns: [] }
    const turns: FsChangeTurn[] = []
    for (const entry of record.turns) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
      const item = entry as Record<string, unknown>
      if (typeof item.turn !== 'number' || typeof item.turnStartSeq !== 'number') continue
      if (typeof item.checkpointId !== 'string' || typeof item.nextCheckpointId !== 'string') continue
      if (!Array.isArray(item.changes)) continue
      const changes = item.changes
        .map((change): FsChange | null => {
          if (typeof change !== 'object' || change === null || Array.isArray(change)) return null
          const c = change as Record<string, unknown>
          if (typeof c.path !== 'string' || c.path === '') return null
          const kind = c.kind === 'added' || c.kind === 'modified' || c.kind === 'deleted' ? c.kind : null
          if (kind === null) return null
          const command = parseFsCommand(c.command)
          return {
            path: c.path,
            kind,
            ...(typeof c.added === 'number' ? { added: c.added } : {}),
            ...(typeof c.removed === 'number' ? { removed: c.removed } : {}),
            ...(typeof c.oldMode === 'number' ? { oldMode: c.oldMode } : {}),
            ...(typeof c.newMode === 'number' ? { newMode: c.newMode } : {}),
            ...(c.dir === true ? { dir: true } : {}),
            // 归因字段宽松解析（旧宿主/开闸缺省；未知枚举丢字段）。
            ...(typeof c.owner === 'string' && c.owner !== '' ? { owner: c.owner } : {}),
            ...(typeof c.autoSelect === 'boolean' ? { autoSelect: c.autoSelect } : {}),
            ...(c.attribution === 'command' || c.attribution === 'ambiguous'
              || c.attribution === 'external' || c.attribution === 'window'
              || c.attribution === 'unknown' ? { attribution: c.attribution } : {}),
            ...(command === null ? {} : { command }),
            ...(typeof c.writtenAt === 'number' ? { writtenAt: c.writtenAt } : {}),
          }
        })
        .filter((change): change is FsChange => change !== null)
      if (changes.length > 0) {
        turns.push({
          turn: item.turn,
          turnStartSeq: item.turnStartSeq,
          checkpointId: item.checkpointId,
          nextCheckpointId: item.nextCheckpointId,
          ...(item.live === true ? { live: true } : {}),
          changes,
        })
      }
    }
    return {
      turns,
      ...(typeof record.rev === 'number' ? { rev: record.rev } : {}),
    }
  } catch {
    return { turns: [] }
  }
}

// ── 模块级缓存：select() 是同步 claim，拿不到异步结果；warm 把 fs-changes
//    提前拉好，键用 turnStartSeq（跨会话无污染）。──────────────────────────

const WARM_THROTTLE_MS = 2000

const fsCache = new Map<number, FsChangeTurn>()
const warmLastAt = new Map<string, number>()
const warmInFlight = new Set<string>()
/** 每会话最近一次 fs-changes 的数据版本；rev 未变则整轮 warm 跳过。 */
const warmLastRev = new Map<string, number>()
const cacheListeners = new Set<() => void>()

/** 订阅缓存刷新（卡片据此重新推导自己的 fs 条目）。 */
export function subscribeFsCache(listener: () => void): () => void {
  cacheListeners.add(listener)
  return () => { cacheListeners.delete(listener) }
}

/** 广播缓存变化。 */
function notifyFsCache(): void {
  for (const listener of cacheListeners) listener()
}

/** 供轮尾 select() 同步读取的入口：这一轮有 fs 变更吗？ */
export function cachedFsTurnFor(turnStartSeq: number): FsChangeTurn | undefined {
  return fsCache.get(turnStartSeq)
}

/**
 * 把某个会话的 fs-changes 预热进缓存（节流 + 发后不理）。
 * 热路径调用是安全的：徽标渲染、快照订阅都可以随手调一次。
 * rev 未变时（同构建宿主必带）直接跳过解析、缓存写入与通知——warm 的正确性
 * 不再依赖 JSON 深比较；rev 缺省（旧宿主）回退到逐条 JSON 比较。
 */
export function warmFsChanges(sessionId: string): void {
  const now = Date.now()
  const last = warmLastAt.get(sessionId) ?? 0
  if (now - last < WARM_THROTTLE_MS || warmInFlight.has(sessionId)) return
  warmLastAt.set(sessionId, now)
  warmInFlight.add(sessionId)
  void fetchAllFsChanges(sessionId).then((payload) => {
    warmInFlight.delete(sessionId)
    if (payload.rev !== undefined) {
      const previous = warmLastRev.get(sessionId)
      if (previous !== undefined && previous === payload.rev) return
      warmLastRev.set(sessionId, payload.rev)
    }
    let changed = false
    for (const turn of payload.turns) {
      const stamped: FsChangeTurn = { ...turn, sessionId }
      const existing = fsCache.get(turn.turnStartSeq)
      if (existing === undefined || JSON.stringify(existing) !== JSON.stringify(stamped)) {
        fsCache.set(turn.turnStartSeq, stamped)
        // 缓存条目变了：该轮的懒加载全文记忆一并失效（live 条内容会随回合推进）。
        invalidateLazyTurn(turn.turnStartSeq)
        changed = true
      }
    }
    if (changed) notifyFsCache()
  }).catch(() => {
    warmInFlight.delete(sessionId)
  })
}

/** 按「会话 + 轮」同步读取（live 条的查找键；缓存条目都带 sessionId）。 */
export function cachedFsTurnForSessionTurn(sessionId: string, turn: number): FsChangeTurn | undefined {
  for (const entry of fsCache.values()) {
    if (entry.sessionId === sessionId && entry.turn === turn) return entry
  }
  return undefined
}

// ── 懒加载全文层：计数先行，全文按需 ─────────────────────────────────────
// fs 条目先以「零全文」的占位形态渲染（行数来自服务端），全文（整文件
// diff）只在真正需要展示/撤销时按条目拉取并记忆，直到该轮缓存条目变化。

/** (turnStartSeq, path) → 全文条目的进行中/已完成请求。 */
const lazyDiffs = new Map<string, Promise<SessionFileChange | null>>()
/** 懒加载记忆容量上限；超出淘汰最旧（会话数 × 轮数 × 文件数的防泄漏阀）。 */
const LAZY_MEMO_CAP = 512

function lazyKey(turnStartSeq: number, path: string): string {
  return `${String(turnStartSeq)}\u0000${path}`
}

function invalidateLazyTurn(turnStartSeq: number): void {
  const prefix = `${String(turnStartSeq)}\u0000`
  for (const key of lazyDiffs.keys()) {
    if (key.startsWith(prefix)) lazyDiffs.delete(key)
  }
}

/**
 * 拉取前后检查点内容，为一个文件系统级变更生成 ProducedFileDiff。
 *
 * 形状契约与宿主对齐：新增文件的 `oldText = null`（宿主的 fs 撤销 = 删文件），
 * 删除文件的 `newText = ''`（宿主的 fs 撤销 = 写回旧内容）——两者都保持承载
 * 宿主文件存在性语义的单条整文件形状。**修改**文件则切出真正的行级 hunks
 * （与宿主 hunk 数学同一 LF 归一基准），多 hunk 的子集撤销因此与工具写入
 * 同路。`nextCheckpointId` 可能是 'live'（= 当前磁盘）。
 */
async function generateFsDiff(
  fsChange: FsChange,
  checkpointId: string,
  nextCheckpointId: string,
  cwd: string,
): Promise<readonly ProducedFileDiff[] | null> {
  const { path, kind } = fsChange
  // 权限位随条目透传：宿主写回时据此恢复（缺省回落 0o644）。
  const modes = {
    ...(fsChange.oldMode !== undefined ? { oldMode: fsChange.oldMode } : {}),
    ...(fsChange.newMode !== undefined ? { newMode: fsChange.newMode } : {}),
  }

  if (kind === 'added') {
    // 新文件：只有轮末内容存在。
    const content = await fetchCheckpointFileContent(nextCheckpointId, path, cwd)
    if (content === null) return null
    return [{ path, oldText: null, newText: content, ...modes }]
  }
  if (kind === 'deleted') {
    // 删除的文件：只有轮起内容存在。
    const content = await fetchCheckpointFileContent(checkpointId, path, cwd)
    if (content === null) return null
    return [{ path, oldText: content, newText: '', ...modes }]
  }
  // 修改的文件：两侧都要拉。
  const [oldContent, newContent] = await Promise.all([
    fetchCheckpointFileContent(checkpointId, path, cwd),
    fetchCheckpointFileContent(nextCheckpointId, path, cwd),
  ])
  if (oldContent === null || newContent === null) return null
  // 切 hunk 前先归一行尾（与宿主同式）：不归一时 CRLF/LF 差异会被当成内容变更。
  // 归一后相同 = 纯行尾/纯 mode 变更 → 回落单条整文件形状，保宿主的 mode 形状识别。
  const oldLf = normalizeLf(oldContent)
  const newLf = normalizeLf(newContent)
  if (oldLf === newLf) return [{ path, oldText: oldContent, newText: newContent, ...modes }]
  const hunks = diffsFromBeforeAfter(path, oldLf, newLf)
  // diffContentLines 不计尾部换行：仅尾部换行差异切不出 hunk，同样回落整文件形状。
  if (hunks.length === 0) return [{ path, oldText: oldContent, newText: newContent, ...modes }]
  return hunks.map((hunk) => ({ ...hunk, ...modes }))
}

/**
 * 一个 fs 条目的占位形态：零全文、带服务端行数。卡片/侧边栏/live 条先用它
 * 渲染行与 +/−，内容在悬停、展开或撤销时经 ensureFsFileDiff 按需补齐。
 */
export function fsTurnReviews(fsTurn: FsChangeTurn): readonly ProducedFileReview[] {
  return fsTurn.changes.map((change) => ({
    path: change.path,
    diffs: [],
    origin: 'fs',
    ...(change.dir === true ? { dir: true as const } : {}),
    ...(change.added !== undefined || change.removed !== undefined
      ? { counts: { added: change.added ?? 0, removed: change.removed ?? 0 } }
      : {}),
    ...(change.kind === 'deleted' ? { deleted: true as const } : {}),
  }))
}

/**
 * 取一个 fs 条目的完整全文条目（撤销/展示 diff 用）。同一 (turn, path) 的
 * 并发与后续调用复用同一个请求；该轮缓存条目被 warm 替换时记忆自动失效
 * （live 条的磁盘内容会随回合推进而变化，绝不能跨更新复用）。
 */
export function ensureFsFileDiff(
  fsTurn: FsChangeTurn,
  path: string,
  cwd: string,
): Promise<SessionFileChange | null> {
  const change = fsTurn.changes.find(entry => entry.path === path)
  if (change === undefined) return Promise.resolve(null)
  const key = lazyKey(fsTurn.turnStartSeq, path)
  const cached = lazyDiffs.get(key)
  if (cached !== undefined) return cached
  const task = (async (): Promise<SessionFileChange | null> => {
    // 归因随补齐条目透传：合并视图里补齐条目会顶替占位，徽标不能丢。
    const attribution = fsAttributionOf(change)
    if (change.dir === true) {
      // 目录条目没有全文可拉：静态标记即可，宿主按 dirKind 走 mkdir/rmdir。
      return {
        path,
        diffs: [{ path, oldText: null, newText: '' }],
        origin: 'fs',
        dir: true,
        ...(change.kind === 'deleted' ? { deleted: true as const } : {}),
        ...attribution,
      }
    }
    const diffs = await generateFsDiff(change, fsTurn.checkpointId, fsTurn.nextCheckpointId, cwd)
    if (diffs === null) return null
    return {
      path,
      diffs,
      origin: 'fs',
      ...(change.kind === 'deleted' ? { deleted: true as const } : {}),
      ...attribution,
    }
  })()
  if (lazyDiffs.size >= LAZY_MEMO_CAP) {
    const oldest = lazyDiffs.keys().next().value
    if (oldest !== undefined) lazyDiffs.delete(oldest)
  }
  lazyDiffs.set(key, task)
  return task
}

/**
 * 把一轮的文件系统变更转成带完整 diff 的 TurnFileChanges。
 * 保留给「确知需要整轮全文」的调用方（如恢复对话框窗口统计）；常规渲染
 * 走 fsTurnReviews + ensureFsFileDiff，避免无谓的全文 HTTP。
 */
export async function convertFsTurnToFiles(
  fsTurn: FsChangeTurn,
  cwd: string,
): Promise<TurnFileChanges | null> {
  const files: SessionFileChange[] = []

  for (const fsChange of fsTurn.changes) {
    const ensured = await ensureFsFileDiff(fsTurn, fsChange.path, cwd)
    if (ensured === null) {
      if (fsChange.kind === 'deleted') {
        files.push({ path: fsChange.path, diffs: [], deleted: true, origin: 'fs' })
      }
      continue
    }
    files.push(ensured)
  }

  if (files.length === 0) return null

  return {
    turn: fsTurn.turn,
    live: false,
    files,
  }
}
