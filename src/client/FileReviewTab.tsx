/**
 * FileReviewTab —— better-sidebar tab 的本体：列出 agent 在**本会话**改过的
 * 每一个文件（按轮分组），行内渲染行级红/绿 diff，并经本包的宿主
 * file-review Typert remote 提供按轮 / 按文件的撤销 + 重新应用。全部推导都
 * 挂在客户端 runtime 的已定稿会话快照上——什么都不会注入聊天流（那正是本
 * 移植要消除的样式冲突源）。
 *
 * 物理布局（拆分后本文件只持有主组件；子件与形状单向依赖）：
 *  - ./file-review-tab-types.ts  共享类型 + 纯工具（stateKey/addStats…）；
 *  - ./review-widgets.tsx        Stats / 图标 / StateBadge / LazyDiff；
 *  - ./rewind.ts                 统一恢复弹窗 RewindDialog（「从快照恢复此轮」
 *                                与消息回退按钮共用同一组件、同一份数据）；
 *  - ./review-dialogs.tsx        多会话确认弹窗 + 文件级时间线对话框。
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  FileReviewAction, FileReviewFileState, FileReviewRequest, FileReviewResult,
} from '../file-review/change-types.ts'
import {
  basename, canonicalKey, resolveSessionPath, pathKey, type SessionFileChange, type TurnFileChanges,
} from './session-changes.ts'
import {
  cachedFsTurnsForSession, ensureFsFileDiff, forceWarmFsChanges, fsAttributionOf,
  fsTurnPlaceholders, subscribeFsCache, type FsChangeTurn,
} from './fs-diff-utils.ts'
import { dedupeStatus } from './status-dedupe.ts'
import { invokeFileReview } from './remote-access.ts'
import { isFsTurnRewound, rewoundMarksOf, subscribeRewound } from './rewound-changes.ts'
import { setReviewRows, subscribeReviewRows } from './review-state.ts'
import { buildApplyRequest } from './apply-core.ts'
import { summarizeDiffs, UnifiedDiff, type UnifiedDiffStats } from './UnifiedDiff.tsx'
import { t } from './locales.ts'
import css from './FileReviewTab.module.css'
import {
  stateKey, fsOwnerBadge, isReversible, addStats,
  SUCCESS_NOTICE_DURATION, ERROR_NOTICE_DURATION,
} from './file-review-tab-types.ts'
import type {
  FileReviewTabProps, Notice, FlatChange, PendingScroll,
  FileTurnEntry,
} from './file-review-tab-types.ts'
import { Stats, UndoIcon, RedoIcon, Chevron, StateBadge, LazyDiff } from './review-widgets.tsx'
import { RewindDialog } from './rewind.ts'
import { ReviewConflictDialog, FileTimelineDialog } from './review-dialogs.tsx'

// Tab 入参类型是本模块公开面的一部分（better-sidebar 装配方引用）。
export type { FileReviewTabProps }

/** 审查面板同轮文件行合并：同一文件的绝对/相对多拼写只留一行（优先已补齐
 * 全文的条目），与 live 条共用 canonicalKey，两侧行集一致。 */
function collapseFiles(files: readonly SessionFileChange[], cwd: string | undefined): SessionFileChange[] {
  const byKey = new Map<string, SessionFileChange>()
  for (const file of files) {
    const key = canonicalKey(file.path, cwd)
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, file)
      continue
    }
    const existingReal = existing.origin !== 'fs' || existing.diffs.length > 0
    const nextReal = file.origin !== 'fs' || file.diffs.length > 0
    if (nextReal && !existingReal) byKey.set(key, file)
  }
  return [...byKey.values()]
}

/** 两份 fs 会话清单是否同一（只比轮身份，避免无谓的全量 setState 与全文失效）。 */
function fsTurnsSame(left: readonly FsChangeTurn[], right: readonly FsChangeTurn[]): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (left[i]?.turnStartSeq !== right[i]?.turnStartSeq) return false
  }
  return true
}

/** 侧边栏 tab 本体：逐轮变更组 + 行内 diff + 撤销。 */
export function FileReviewTab({ ctx, sessionId, cwd, visible, tab }: FileReviewTabProps) {
  const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
  const [states, setStates] = useState<ReadonlyMap<string, FileReviewFileState>>(() => new Map())
  const [statusPending, setStatusPending] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // 树形视图的轮级折叠（缺省全展开；集合内 = 已折叠）与修改处级展开。
  const [collapsedTurns, setCollapsedTurns] = useState<ReadonlySet<number>>(() => new Set())
  // 修改处（hunk）展开集：键 = `${stateKey(turn, path)}|${hunk 下标}`。
  const [openHunks, setOpenHunks] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [tick, setTick] = useState(0)
  // 双向同步（review-state）：live 条行内撤销/重做的结果回流到这里——
  // tick 触发宿主重巡检，本界面的行状态与 live 条保持同一事实。
  useEffect(() => subscribeReviewRows(() => { setTick(value => value + 1) }), [])
  // 恢复记录总线（rewound-changes 单一真相）：回退弹窗 / 按轮快照恢复 / 撤销
  // 任一动作对磁盘的改动都会广播到这里——本面板立即重拉 fs 清单并重巡检，
  // 消除「弹窗已把文件恢复掉、审计抽屉还照着旧清单」的分叉。
  useEffect(() => subscribeRewound(() => { setTick(value => value + 1) }), [])
  // 块级选择：stateKey → 选中 hunk 下标集合；缺省（无条目）= 隐式全选。
  const [hunkSelection, setHunkSelection] = useState<ReadonlyMap<string, ReadonlySet<number>>>(() => new Map())
  // 打开「从快照恢复此轮」对话框的回合号；null = 关闭。
  const [rewindTurn, setRewindTurn] = useState<number | null>(null)
  // 打开文件级时间线对话框的路径；null = 关闭。
  const [timelinePath, setTimelinePath] = useState<string | null>(null)
  // 冲突三选项弹窗的待授权清单（apply 非 force 批次返回 conflict 时暂存）；null = 关闭。
  const [pendingConflict, setPendingConflict] = useState<{
    key: string
    items: readonly FlatChange[]
    action: FileReviewAction
  } | null>(null)
  const noticeSeqRef = useRef(0)
  const noticeTimerRef = useRef<number | null>(null)

  // 会话标题查询（归因徽标把「他会话 id」升级成可读标题；缺省回落 id 截断）。
  const sessionList = useSyncExternalStore(
    useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions]),
    () => sessions.list.getSnapshot(),
  )
  const sessionTitle = useCallback(
    (id: string) => sessionList.byId[id as SessionId]?.displayTitle,
    [sessionList],
  )

  // 变更事实的唯一来源：宿主 /shadow-rewind/fs-changes 的逐轮检查点 diff
  // （每一轮 = 轮起检查点 → 轮末检查点，无轮末回退下一轮轮起）。行数由服务端
  // 预算；全文（整文件 diff）按需懒加载，且按 (turn, path) 记忆。
  const [fsRaw, setFsRaw] = useState<readonly FsChangeTurn[]>([])
  const [ensuredFs, setEnsuredFs] = useState<ReadonlyMap<string, SessionFileChange>>(() => new Map())
  const fsRawRef = useRef(fsRaw)
  fsRawRef.current = fsRaw
  const ensuredFsRef = useRef(ensuredFs)
  ensuredFsRef.current = ensuredFs

  /** 从共享 fs 缓存同步当前会话的清单（与 live 条同一事实源；轮序升序）。 */
  const syncFsFromCache = useCallback(() => {
    const next = cachedFsTurnsForSession(sessionId)
    const previous = fsRawRef.current
    if (fsTurnsSame(previous, next)) return
    // J6：全文记忆随清单换代会话一并失效——避免长期展示过期 diff。
    setEnsuredFs(new Map())
    setFsRaw(next)
  }, [sessionId])

  // fs 数据源统一走 warm 缓存（不再各自直拉 /shadow-rewind/fs-changes，双通道
  // 分叉消除）：可见、手动刷新或恢复/撤销事件（tick）触发**强制** warm
  // （绕过 2s 节流），warm 完成广播后从缓存同步。文件被恢复/撤销时，同一份
  // rev 节流 + 失效广播驱动 live 条与审计面板拿到一致的清单。
  useEffect(() => {
    if (!visible || cwd === undefined || cwd.trim() === '') {
      setFsRaw([])
      setEnsuredFs(new Map())
      return
    }
    forceWarmFsChanges(sessionId)
    syncFsFromCache()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tick, sessionId, cwd])

  // warm 缓存广播（live 条推进 / 强制 warm 完成）：审计面板同步读同一缓存。
  useEffect(() => {
    if (!visible || cwd === undefined || cwd.trim() === '') return undefined
    return subscribeFsCache(() => { syncFsFromCache() })
  }, [visible, sessionId, cwd, syncFsFromCache])

  /** 按需补齐 fs 条目全文（展开 diff、撤销提交、恢复窗口统计共用）。 */
  const ensureFsTurnFiles = useCallback(async (turn: number, paths?: readonly string[]): Promise<void> => {
    if (cwd === undefined) return
    const fsTurn = fsRawRef.current.find(entry => entry.turn === turn)
    if (fsTurn === undefined) return
    const wanted = fsTurn.changes.filter(change => (paths === undefined || paths.includes(change.path))
      && !ensuredFsRef.current.has(`${String(turn)}|${change.path}`))
    if (wanted.length === 0) return
    const settled = await Promise.all(wanted.map(async (change) => [
      `${String(turn)}|${change.path}`,
      await ensureFsFileDiff(fsTurn, change.path, cwd),
    ] as const))
    setEnsuredFs((current) => {
      const next = new Map(current)
      for (const [key, value] of settled) if (value !== null) next.set(key, value)
      return next
    })
  }, [cwd])

  // fs 占位（计数）→ 已补齐条目的合并视图：同 (turn, path) 优先用懒加载全文。
  // 占位构造统一走 fs-diff-utils 的 fsTurnPlaceholders（带归因徽标）；ensure
  // 覆盖按 (turn, path) 槽位命中。恢复/撤销（tick 驱动的 marks）时按恢复记录
  // 过滤已随恢复撤回的 fs 轮写盘——与 live 条同一遮蔽口径，审计抽屉不再照列
  // 「磁盘上已不存在」的旧写盘。
  const fsTurns = useMemo<TurnFileChanges[]>(() => {
    const result: TurnFileChanges[] = []
    const marks = rewoundMarksOf(sessionId)
    for (const fsTurn of fsRaw) {
      const files = fsTurnPlaceholders(fsTurn, { attribution: true })
        .filter(file => !isFsTurnRewound(marks, fsTurn.turnStartSeq, file.path))
        .map(file => ensuredFs.get(`${String(fsTurn.turn)}|${file.path}`) ?? file)
      if (files.length > 0) result.push({ turn: fsTurn.turn, live: false, files })
    }
    return result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fsRaw, ensuredFs, tick, sessionId])

  // 逐轮清单：fs 轮（检查点 diff）按恢复记录遮蔽后即为全部事实。
  const turns = useMemo(
    () => fsTurns.map(turn => ({ ...turn, files: collapseFiles(turn.files, cwd) })),
    [fsTurns, cwd],
  )
  const flat = useMemo<FlatChange[]>(
    () => turns.flatMap(turn => turn.files.map(file => ({
      turn: turn.turn, path: file.path, diffs: file.diffs,
      ...(file.deleted === true ? { deleted: true as const } : {}),
      ...(file.origin !== undefined ? { origin: file.origin } : {}),
      ...(file.counts !== undefined ? { counts: file.counts } : {}),
      ...fsAttributionOf(file),
    }))),
    [turns],
  )
  // 没有 diffs 的删除条目（rm 命令记录）没东西可巡检或开关；fs 级删除带着
  // 整文件 diff，**可以**开关。
  // fs 占位条目（全文未补齐）同样不参与巡检——补齐后经 flatKey 自动加入。
  const inspectable = useMemo(
    () => flat.filter(item => (item.deleted !== true || item.diffs.length > 0)
      && !(item.origin === 'fs' && item.diffs.length === 0)),
    [flat],
  )
  // 稳定的内容键：巡检 effect 只在变更**集合**变化时才重触发，而不是每次
  // token 刷新的快照身份变化都重触发。
  const flatKey = useMemo(
    () => flat.map(item => `${item.turn}|${item.path}|${item.diffs.length}`).join(';'),
    [flat],
  )
  const flatRef = useRef(flat)
  flatRef.current = flat

  // 深链管道：按 stateKey 收集文件行元素、按轮号收集轮组元素供
  // scrollIntoView，另记上一次重放过的 meta 引用与待滚动的目标。
  const rowRefs = useRef(new Map<string, HTMLLIElement>())
  const turnRefs = useRef(new Map<number, HTMLElement>())
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const lastMetaRef = useRef<unknown>(undefined)
  const pendingScrollRef = useRef<PendingScroll | null>(null)

  // 侧边栏 tab 的深链：聊天行的「审查」按钮（与单文件 chip）以
  // `tab.meta.expandPaths` 落到这里。一份**新的** meta 引用会重放展开——
  // 并入用户自己的展开集，绝不替换它——并排一个把链接目标滚到 tab 体顶部
  // 的滚动。引用未变（由无关侧栏状态引起的重渲染）时绝不会重夺用户手工的
  // 展开 / 折叠状态。
  useEffect(() => {
    const meta = tab.meta
    if (meta === lastMetaRef.current) return
    lastMetaRef.current = meta
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return
    const raw = (meta as { expandPaths?: unknown; turn?: unknown }).expandPaths
    if (!Array.isArray(raw)) return
    const paths = raw.filter((value): value is string => typeof value === 'string')
    if (paths.length === 0) return
    const turnNo = (meta as { turn?: unknown }).turn
    const targetTurn = typeof turnNo === 'number' && Number.isInteger(turnNo) ? turnNo : undefined
    // 带轮锚点时只有**那一轮**的行展开——在其它轮反复出现的路径保持折叠；
    // 不带锚点则每一处出现都展开（旧版 meta 形状）。
    const matches = (item: FlatChange): boolean =>
      paths.includes(item.path) && (targetTurn === undefined || item.turn === targetTurn)
    setExpanded((current) => {
      const next = new Set(current)
      for (const item of flatRef.current) {
        if (matches(item)) next.add(stateKey(item.turn, item.path))
      }
      return next
    })
    const first = flatRef.current.find(item => matches(item))
    // 多路径链接（「审查」按钮）以轮组为目标，让整段审查领先视口；单路径
    // 链接（文件 chip）以该文件行为目标。匹配不到的链接不留下任何待办。
    pendingScrollRef.current = first === undefined ? null : {
      rowKey: stateKey(first.turn, first.path),
      turn: paths.length > 1 ? first.turn : null,
    }
  }, [tab.meta])

  // 把深链目标滚到 tab 体**顶部**——居中会让长审查横跨视口、读起来像没滚
  // 到位。整轮链接解析到轮组（其头部领先），单文件链接到该文件行；当所在
  // 节还没挂载时后者也是回退目标。元素一时找不到（会话快照可能还在流式
  // 进来）目标就保持 pending，于是 `flatKey` 在行挂载后重新触发滚动，
  // `visible` 在面板还在打开时推迟它。延迟的第二跳覆盖「diff 体在展开提交
  // 后一个布局周期才挂载」的情况。
  //
  // 滚动只算在 tab **自己的** body 上：按规范 `element.scrollIntoView(
  // { block: 'start' })` 会滚动**每一个**可滚动的祖先——在侧栏面板里这会
  // 拖走外层容器，面板的 tab 条头部就骑在其中一个里面、会被滚出视野
  // （issue #4）。手工容器数学绝不会挪动这个 body 之外的东西。
  useEffect(() => {
    if (!visible) return
    const pending = pendingScrollRef.current
    if (pending === null) return
    const element = (pending.turn !== null ? turnRefs.current.get(pending.turn) : undefined)
      ?? rowRefs.current.get(pending.rowKey)
    if (element === undefined) return
    pendingScrollRef.current = null
    const scroll = () => {
      const container = bodyRef.current
      if (container === null) return
      const delta = element.getBoundingClientRect().top - container.getBoundingClientRect().top
      container.scrollTo({ top: container.scrollTop + delta - 8, behavior: 'smooth' })
    }
    scroll()
    const timer = window.setTimeout(scroll, 150)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, expanded, tab.meta, flatKey])

  const showNotice = useCallback((tone: Notice['tone'], text: string) => {
    noticeSeqRef.current += 1
    const seq = noticeSeqRef.current
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(
      () => { setNotice(current => current?.seq === seq ? null : current) },
      tone === 'success' ? SUCCESS_NOTICE_DURATION : ERROR_NOTICE_DURATION,
    )
    setNotice({ seq, tone, text })
  }, [])

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
  }, [])

  // Remote 调用路径沿用 dsh-file-review。dsh 0.1.2 起 scope 的 Remote 是
  // 网关客户端面（agent 标签路由）；解析与自愈重挂收拢在 remote-access。
  const invoke = useCallback(async (
    method: 'status' | 'apply',
    request: FileReviewRequest,
  ): Promise<FileReviewResult> => {
    try {
      return await invokeFileReview(ctx, sessionId, method, request)
    } catch (caught) {
      if (caught instanceof Error && caught.message.includes('fileReview 命名空间')) {
        throw new Error(t('remoteUnavailable'))
      }
      throw caught
    }
  }, [ctx, sessionId])

  // 宿主侧状态巡检：哪些录制变更仍 applied、已 undone、或冲突。tab 不可见
  // 时暂停。
  useEffect(() => {
    if (!visible || flat.length === 0) return
    let active = true
    setStatusPending(true)
    // 尾沿防抖：流式回合会随每个 hunk 不断顶高 flatKey；300ms 静默窗口里只
    // 让一次宿主往返存活下来。
    const timer = window.setTimeout(() => {
      const request: FileReviewRequest = {
        action: 'undo',
        files: inspectable.map(item => ({ path: item.path, diffs: item.diffs })),
      }
      // J8：巡检走传输层 in-flight 去重（与卡片同层）——侧栏直连曾绕过
      // 去重，卡片与侧栏对同一批文件的并发巡检会双发。
      dedupeStatus(sessionId, request, (bound) => invoke('status', bound)).then((result) => {
        if (!active) return
        setStates(() => {
          const next = new Map<string, FileReviewFileState>()
          inspectable.forEach((item, index) => {
            const file = result.files[index]
            if (file !== undefined) next.set(stateKey(item.turn, item.path), file.state)
          })
          return next
        })
      }).catch(() => {
        // 巡检瞬时失败：按钮保持可用——apply 在碰磁盘前会再跑同样的宿主校验。
      }).finally(() => {
        if (active) setStatusPending(false)
      })
    }, 300)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, flatKey, tick, invoke])

  /** H2 归一：子集提交的状态键带 diff 集签名——apply 结果与全量巡检写入
   * 不同槽位，不再互相覆盖震荡；混合态在两个视角下各自有独立事实。 */
  const subsetSig = useCallback((diffs: SessionFileChange['diffs']): string => {
    let hash = 0
    for (const diff of diffs) {
      hash = (Math.imul(hash, 31) + (diff.oldText === null ? -1 : diff.oldText.length)
        + diff.newText.length + (diff.oldStart ?? 0) + (diff.newStart ?? 0)) | 0
    }
    return `${diffs.length}:${hash}`
  }, [])


  const mergeResultStates = useCallback((
    items: readonly { readonly item: FlatChange; readonly full: boolean }[],
    result: FileReviewResult,
  ) => {
    // 双向同步（review-state）：本界面的开关结果广播给 live 条的行内按钮。
    setReviewRows(sessionId, result.files, cwd)
    setStates((current) => {
      const next = new Map(current)
      items.forEach(({ item, full }, index) => {
        const file = result.files[index]
        if (file === undefined) return
        const key = full
          ? stateKey(item.turn, item.path)
          : `${stateKey(item.turn, item.path)}|${subsetSig(item.diffs)}`
        next.set(key, file.state)
      })
      return next
    })
  }, [sessionId, subsetSig])

  /** Toggle one change set (a whole turn, or one file) undo ↔ redo —— 提交单点：
   * 轮/文件按钮都传全文，hunk 勾选裁剪在此统一完成（归属只是徽标，不参与筛选）。 */
  const applyToggle = useCallback((
    key: string,
    items: readonly FlatChange[],
    action: FileReviewAction,
    force = false,
  ) => {
    if (busyKey !== null || items.length === 0) return
    setBusyKey(key)
    let submitted: readonly { readonly item: FlatChange; readonly full: boolean }[] = []
    void (async () => {
      // fs 占位条目先按需补齐全文再提交（零全文条目宿主无法回放）。
      const ensuredItems: FlatChange[] = []
      for (const item of items) {
        if (item.diffs.length > 0 || item.origin !== 'fs') {
          ensuredItems.push(item)
          continue
        }
        await ensureFsTurnFiles(item.turn, [item.path])
        const ensured = ensuredFsRef.current.get(`${String(item.turn)}|${item.path}`)
        if (ensured !== undefined) {
          ensuredItems.push({
            ...item,
            diffs: ensured.diffs,
            ...(ensured.deleted === true ? { deleted: true as const } : {}),
          })
        }
      }
      // hunk 子集裁剪：有勾选则只提交勾选部分（子集为空 ⇒ 该条不提交）。
      // full 标记随行携带：全量提交写入全量状态槽，子集提交写入带签名的
      // 子集槽（H2 归一，两槽互不覆盖）。
      submitted = ensuredItems.flatMap((item): { item: FlatChange; full: boolean }[] => {
        if (item.diffs.length === 0) return []
        const selection = hunkSelection.get(stateKey(item.turn, item.path))
        if (selection === undefined || selection.size >= item.diffs.length) return [{ item, full: true }]
        const subset = item.diffs.filter((_, index) => selection.has(index))
        return subset.length > 0 ? [{ item: { ...item, diffs: subset }, full: false }] : []
      })
      if (submitted.length === 0) return undefined
      // 装配共用 apply-core：dirKind/请求体唯一实现；force 语义不变。
      const request = buildApplyRequest(
        submitted.map(({ item }) => ({
          path: item.path,
          diffs: item.diffs,
          ...(item.origin === undefined ? {} : { origin: item.origin }),
          ...(item.dir === true ? { dir: true, deleted: item.deleted === true } : {}),
        })),
        action,
        force,
      )
      return invoke('apply', request)
    })().then((result) => {
      if (result === undefined) return
      mergeResultStates(submitted, result)
      const target = action === 'undo' ? 'undone' : 'applied'
      const failures = result.files.filter(file => file.state !== target)
      if (failures.length === 0) {
        showNotice('success', t(action === 'undo' ? 'undoSuccess' : 'redoSuccess'))
        return
      }
      // 冲突三选项（EXPECTED-DESIGN 1.2）：非 force 批次里有路径因后续修改
      // 而漂移（conflict）时弹窗授权——拒绝不动 / force 覆盖 / 只回滚正常
      // 部分。force 批次里的残余 conflict（锚点定位失败）不进弹窗。
      if (!force) {
        const conflictItems = submitted
          .filter((_, index) => result.files[index]?.state === 'conflict')
          .map(({ item }) => item)
        if (conflictItems.length > 0) {
          setPendingConflict({ key, items: conflictItems, action })
          return
        }
      }
      showNotice('error', t(action === 'undo' ? 'undoPartial' : 'redoPartial'))
    }).catch((error: unknown) => {
      showNotice('error', `${t('toggleError')}: ${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => { setBusyKey(null) })
  }, [busyKey, ensureFsTurnFiles, hunkSelection, invoke, mergeResultStates, showNotice])

  const runToggle = useCallback((
    key: string,
    items: readonly FlatChange[],
    action: FileReviewAction,
  ) => {
    if (busyKey !== null || items.length === 0) return
    void applyToggle(key, items, action)
  }, [busyKey, applyToggle])

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  /** 树形第三级：展开/折叠一个修改处（键 = 文件键 + hunk 下标）。 */
  const toggleHunk = useCallback((hunkKey: string) => {
    setOpenHunks((current) => {
      const next = new Set(current)
      if (next.has(hunkKey)) next.delete(hunkKey)
      else next.add(hunkKey)
      return next
    })
  }, [])

  /** 更新一个 (turn, path) 的 hunk 勾选；回到全选时清除条目（隐式全选）。 */
  const changeHunkSelection = useCallback((key: string, total: number, next: ReadonlySet<number>) => {
    setHunkSelection((current) => {
      const map = new Map(current)
      if (next.size >= total) map.delete(key)
      else map.set(key, next)
      return map
    })
  }, [])

  const selectedHunkCount = useCallback((file: SessionFileChange, key: string): number => {
    const selection = hunkSelection.get(key)
    return selection === undefined ? file.diffs.length : selection.size
  }, [hunkSelection])

  const openInEditor = useCallback((path: string) => {
    const absolute = resolveSessionPath(cwd, path)
    const sidebar = (ctx as unknown as {
      betterSidebar?: { openFile(scope: { sessionId: string; cwd?: string }, path: string, title?: string): void }
    }).betterSidebar
    sidebar?.openFile({ sessionId, ...(cwd !== undefined ? { cwd } : {}) }, absolute, basename(absolute))
  }, [ctx, cwd, sessionId])

  const totalStats = useMemo(() => flat.reduce<UnifiedDiffStats>(
    (total, item) => addStats(total, item.counts ?? summarizeDiffs(item.diffs)),
    { added: 0, removed: 0 },
  ), [flat])

  // 文件级时间线数据：路径 → 逐轮改动（turns 本身按轮升序，逐条追加即升序）。
  const timelineForPath = useMemo(() => {
    const map = new Map<string, FileTurnEntry[]>()
    for (const turn of turns) {
      for (const file of turn.files) {
        const list = map.get(file.path) ?? []
        list.push({
          turn: turn.turn, live: turn.live, diffs: file.diffs,
          ...(file.deleted === true ? { deleted: true as const } : {}),
          ...(file.counts !== undefined ? { counts: file.counts } : {}),
        })
        map.set(file.path, list)
      }
    }
    return map
  }, [turns])
  const timelineEntries = timelinePath === null ? [] : timelineForPath.get(timelinePath) ?? []

  /** 从时间线/恢复对话框跳到某个（轮, 文件）的差异：关掉浮层、展开该行并滚动
   * 到位（setExpanded 总是产生新 Set，滚动副作用必然重放）。 */
  const jumpToFile = useCallback((turn: number, path: string) => {
    setTimelinePath(null)
    setRewindTurn(null)
    const key = stateKey(turn, path)
    setExpanded((current) => {
      const next = new Set(current)
      next.add(key)
      return next
    })
    pendingScrollRef.current = { rowKey: key, turn: null }
  }, [])

  /** 渲染一个轮组（最新轮在前）。 */
  const renderTurn = (turn: TurnFileChanges) => {
    const turnStats = turn.files.reduce<UnifiedDiffStats>(
      (total, file) => addStats(total, file.counts ?? summarizeDiffs(file.diffs)),
      { added: 0, removed: 0 },
    )
    const reversible = turn.files.filter(isReversible)
    // fs 占位条目（全文未补齐）也可操作：提交时按需补齐。
    const toggleable = turn.files.filter(file => file.deleted !== true || file.diffs.length > 0 || file.dir === true)
    const hasToggleable = toggleable.some(file => file.diffs.length > 0 || file.origin === 'fs')
    const allUndone = reversible.length > 0
      && reversible.every(file => states.get(stateKey(turn.turn, file.path)) === 'undone')
    const turnAction: FileReviewAction = allUndone ? 'redo' : 'undo'
    const turnKey = `turn:${turn.turn}`
    const turnBusy = busyKey === turnKey
    // 轮头部汇总：该轮存在非本会话归属的 fs 写入时提示总数（不逐文件枚举）。
    const otherWrites = turn.files.filter(file => file.origin === 'fs'
      && file.owner !== undefined && file.owner !== 'target').length
    // 树形第一级：轮（可折叠）。
    const collapsed = collapsedTurns.has(turn.turn)
    const toggleCollapse = () => {
      setCollapsedTurns((current) => {
        const next = new Set(current)
        if (next.has(turn.turn)) next.delete(turn.turn)
        else next.add(turn.turn)
        return next
      })
    }
    return (
      <section
        key={turn.turn}
        ref={(element) => {
          if (element === null) turnRefs.current.delete(turn.turn)
          else turnRefs.current.set(turn.turn, element)
        }}
        className={css.turnGroup}
      >
        <header
          className={css.turnHeader}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          onClick={toggleCollapse}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggleCollapse()
            }
          }}
        >
          <Chevron open={!collapsed} />
          <span className={css.turnTitle}>{t('turn', { n: turn.turn })}</span>
          {turn.live && <span className={css.liveBadge}>{t('turnLive')}</span>}
          <span className={css.turnCount}>
            {turn.files.length === 1 ? t('filesOne') : t('files', { count: turn.files.length })}
          </span>
          <Stats stats={turnStats} />
          {otherWrites > 0 && (
            <span className={css.ownerBadge}>{t('turnOtherSessions', { count: otherWrites })}</span>
          )}
          <button
            type="button"
            className={css.actionButton}
            disabled={statusPending || busyKey !== null || !hasToggleable}
            title={!hasToggleable ? t('toggleUnavailable') : undefined}
            onClick={(event) => {
              event.stopPropagation()
              runToggle(turnKey, toggleable.map(file => ({
                turn: turn.turn, path: file.path, diffs: file.diffs,
                ...(file.origin !== undefined ? { origin: file.origin } : {}),
                ...(file.dir === true ? { dir: true as const } : {}),
                ...(file.deleted === true ? { deleted: true as const } : {}),
                ...fsAttributionOf(file),
              })), turnAction)
            }}
          >
            {turnAction === 'undo' ? <UndoIcon /> : <RedoIcon />}
            {turnBusy
              ? t(turnAction === 'undo' ? 'undoing' : 'redoing')
              : t(turnAction === 'undo' ? 'undoTurn' : 'redoTurn')}
          </button>
          <button
            type="button"
            className={css.smallButton}
            disabled={busyKey !== null}
            title={t('snapshotRestoreTitle')}
            onClick={(event) => {
              event.stopPropagation()
              // 打开统一恢复弹窗（轮入口；统计由弹窗自行从 fs 缓存取）。
              setRewindTurn(turn.turn)
            }}
          >
            {t('snapshotRestore')}
          </button>
        </header>
        {!collapsed && (
          <ul className={css.fileList}>
            {turn.files.map(file => renderFile(turn, file))}
          </ul>
        )}
      </section>
    )
  }

  /** 渲染一个被改文件的行；展开时追加其行内 diff。 */
  const renderFile = (turn: TurnFileChanges, file: SessionFileChange) => {
    const key = stateKey(turn.turn, file.path)
    const isOpen = expanded.has(key)
    // H2 归一：用户对当前勾选子集的最近一次 apply 结果优先于全量巡检状态
    // ——同一文件的两个视角（全量 / 子集）各自持有独立事实，不再互相覆盖。
    const selection = hunkSelection.get(key)
    const subsetKey = selection !== undefined && selection.size > 0 && selection.size < file.diffs.length
      ? `${key}|${subsetSig(file.diffs.filter((_, index) => selection.has(index)))}`
      : null
    const state = (subsetKey !== null ? states.get(subsetKey) : undefined) ?? states.get(key)
    const reversible = isReversible(file)
    // fs 占位条目（全文未补齐）也可撤销：提交时按需补齐。
    const fsPending = file.origin === 'fs' && file.diffs.length === 0
    const fileAction: FileReviewAction = state === 'undone' ? 'redo' : 'undo'
    const fileBusy = busyKey === key
    const stats = file.counts ?? summarizeDiffs(file.diffs)
    const selectedCount = selectedHunkCount(file, key)
    // rm 命令记录：只展示徽标。fs 级删除带着整文件 diff，与其它可开关变更
    // 行为一致。目录删除同理（补齐后走 dirKind 语义）——不算「无 diff 的
    // 删除」。
    const deletedNoDiff = file.deleted === true && file.diffs.length === 0 && file.dir !== true
    // fs 条目的归因徽标（开闸/旧宿主无归因 → 无徽标）。
    const fsBadge = file.origin === 'fs' ? fsOwnerBadge(file, sessionTitle) : null
    const expand = () => {
      toggleExpanded(key)
      if (fsPending) void ensureFsTurnFiles(turn.turn, [file.path])
    }
    return (
      <li
        key={file.path}
        className={css.fileItem}
        ref={(element) => {
          if (element === null) rowRefs.current.delete(key)
          else rowRefs.current.set(key, element)
        }}
      >
        <div
          className={css.fileRow}
          role="button"
          tabIndex={0}
          title={file.path}
          aria-expanded={isOpen}
          onClick={expand}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              expand()
            }
          }}
        >
          <Chevron open={isOpen} />
          <span className={css.fileName}>{basename(file.path)}</span>
          {file.deleted === true && <span className={css.deletedBadge}>{t('deleted')}</span>}
          {file.dir === true && <span className={css.deletedBadge}>{t('dirBadge')}</span>}
          {fsBadge !== null && <span className={css.ownerBadge}>{fsBadge}</span>}
          {!deletedNoDiff && <Stats stats={stats} />}
          {!deletedNoDiff && <StateBadge state={state} />}
          <button
            type="button"
            className={css.smallButton}
            title={t('timelineTitle')}
            onClick={(event) => {
              event.stopPropagation()
              setTimelinePath(file.path)
            }}
          >
            {t('timeline')}
          </button>
          {file.deleted !== true && file.dir !== true && (
            <button
              type="button"
              className={css.smallButton}
              onClick={(event) => {
                event.stopPropagation()
                openInEditor(file.path)
              }}
            >
              {t('openInEditor')}
            </button>
          )}
          <button
            type="button"
            className={css.smallButton}
            disabled={statusPending || busyKey !== null || !(reversible || fsPending) || (reversible && selectedCount === 0)}
            title={deletedNoDiff
              ? t('deletedHint')
              : (!(reversible || fsPending)
                ? t('toggleUnavailable')
                : (reversible && selectedCount === 0) ? t('hunkNoneSelected') : undefined)}
            onClick={(event) => {
              event.stopPropagation()
              runToggle(key, [{
                turn: turn.turn, path: file.path, diffs: file.diffs,
                ...(file.origin !== undefined ? { origin: file.origin } : {}),
                ...(file.dir === true ? { dir: true as const } : {}),
                ...(file.deleted === true ? { deleted: true as const } : {}),
                ...fsAttributionOf(file),
              }], fileAction)
            }}
          >
            {fileBusy
              ? t(fileAction === 'undo' ? 'undoing' : 'redoing')
              : t(fileAction === 'undo' ? 'undo' : 'redo')}
          </button>
        </div>
        {isOpen && (
          <div className={css.diffWrap}>
            <LazyDiff>
              {deletedNoDiff
                ? <p className={css.diffUnavailable}>{t('deletedHint')}</p>
                : file.dir === true
                  ? <p className={css.diffUnavailable}>{t('dirHint')}</p>
                  : file.diffs.length === 0
                    ? <p className={css.diffUnavailable}>{t('unavailable')}</p>
                    : (
                  <ul className={css.hunkList}>
                    {file.diffs.map((diff, index) => {
                      // 树形第三级：修改处（hunk）。展开才渲染该块 diff；
                      // 勾选框从原整段 diff 内嵌选择迁移到修改处行上。
                      const hunkKey = `${key}|${index}`
                      const hunkOpen = openHunks.has(hunkKey)
                      const hunkChecked = selection === undefined || selection.has(index)
                      return (
                        <li key={hunkKey} className={css.hunkItem}>
                          <div
                            className={css.hunkRow}
                            role="button"
                            tabIndex={0}
                            aria-expanded={hunkOpen}
                            onClick={() => { toggleHunk(hunkKey) }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault()
                                toggleHunk(hunkKey)
                              }
                            }}
                          >
                            <Chevron open={hunkOpen} />
                            <input
                              type="checkbox"
                              checked={hunkChecked}
                              title={t('hunkInclude')}
                              onClick={(event) => { event.stopPropagation() }}
                              onChange={() => {
                                const next = new Set(selection ?? file.diffs.map((_, i) => i))
                                if (next.has(index)) next.delete(index)
                                else next.add(index)
                                changeHunkSelection(key, file.diffs.length, next)
                              }}
                            />
                            <span className={css.hunkTitle}>{t('hunkN', { n: index + 1 })}</span>
                            <Stats stats={summarizeDiffs([diff])} />
                          </div>
                          {hunkOpen && (
                            <div className={css.hunkDiff}>
                              <UnifiedDiff
                                diffs={[diff]}
                                contextLines={3}
                                showFileHeaders={false}
                                labels={{
                                  copy: t('copy'),
                                  copied: t('copied'),
                                  showUnchanged: count => t('showUnchanged', { count }),
                                  hideUnchanged: count => t('hideUnchanged', { count }),
                                  hunkN: n => t('hunkN', { n }),
                                  hunkInclude: t('hunkInclude'),
                                }}
                                className={css.reviewDiff}
                              />
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
            </LazyDiff>
          </div>
        )}
      </li>
    )
  }

  return (
    <div className={css.root}>
      <header className={css.header}>
        <span className={css.headerTitle}>{t('tabTitle')}</span>
        {flat.length > 0 && <Stats stats={totalStats} />}
        <button
          type="button"
          className={css.refreshButton}
          disabled={statusPending}
          title={t('refresh')}
          onClick={() => { setTick(value => value + 1) }}
        >
          ⟳
        </button>
      </header>
      {notice !== null && (
        <div
          className={`${css.notice} ${notice.tone === 'success' ? css.noticeSuccess : css.noticeError}`}
          role="alert"
        >
          {notice.text}
        </div>
      )}
      <div className={css.body} ref={bodyRef}>
        {turns.length === 0
          ? <div className={css.empty}>{t('empty')}</div>
          : [...turns].reverse().map(renderTurn)}
      </div>
      {rewindTurn !== null && (
        // 统一恢复弹窗（轮入口）：与消息回退按钮同一组件、同一份共享预览数据。
        // 恢复成功后的遮蔽标记由弹窗内 commitRestore 完成，本面板经
        // subscribeRewound 的 tick 自动重拉清单。
        <RewindDialog
          sessionId={sessionId}
          target={{ turn: rewindTurn }}
          onClose={() => { setRewindTurn(null) }}
          onJumpToDiff={(path) => {
            // 弹窗已在本面板内：就地展开该文件最近一轮的 diff 并滚动到位。
            setRewindTurn(null)
            const entry = [...flat].reverse().find(item => pathKey(item.path) === pathKey(path))
            if (entry !== undefined) jumpToFile(entry.turn, entry.path)
          }}
        />
      )}
      {pendingConflict !== null && (
        <ReviewConflictDialog
          items={pendingConflict.items}
          action={pendingConflict.action}
          busy={busyKey !== null}
          onAbort={() => { setPendingConflict(null) }}
          onPartial={() => {
            const pending = pendingConflict
            setPendingConflict(null)
            showNotice('error', t(pending.action === 'undo' ? 'undoPartial' : 'redoPartial'))
          }}
          onForce={() => {
            const pending = pendingConflict
            setPendingConflict(null)
            void applyToggle(pending.key, pending.items, pending.action, true)
          }}
        />
      )}
      {timelinePath !== null && (
        <FileTimelineDialog
          path={timelinePath}
          entries={timelineEntries}
          onPick={(turn) => { jumpToFile(turn, timelinePath) }}
          onClose={() => { setTimelinePath(null) }}
        />
      )}
    </div>
  )
}
