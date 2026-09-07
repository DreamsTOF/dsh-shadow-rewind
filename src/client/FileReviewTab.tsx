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
 *  - ./turn-rewind-dialog.tsx    「从快照恢复此轮」对话框（独立状态机）；
 *  - ./review-dialogs.tsx        多会话确认弹窗 + 文件级时间线对话框。
 */

import {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {
  FileReviewAction, FileReviewFileState, FileReviewRequest, FileReviewResult,
  RecordedMutation,
} from '../file-review/change-types.ts'
import {
  basename, deriveSessionChanges, deriveSessionRoots, mergeRecordedTurns,
  resolveSessionPath, pathKey, type SessionFileChange, type TurnFileChanges,
} from './session-changes.ts'
import { ensureFsFileDiff, fetchAllFsChanges, fsAttributionOf, subscribeFsCache, type FsChangeTurn } from './fs-diff-utils.ts'
import { dedupeStatus } from './status-dedupe.ts'
import { invokeFileReview, invokeFileReviewRecorded } from './remote-access.ts'
import { markRewound, snapshotBarrierOf } from './rewound-changes.ts'
import { setReviewRows, subscribeReviewRows } from './review-state.ts'
import { summarizeDiffs, UnifiedDiff, type UnifiedDiffStats } from './UnifiedDiff.tsx'
import { t } from './locales.ts'
import css from './FileReviewTab.module.css'
import {
  stateKey, fsOwnerBadge, isReversible, addStats,
  SUCCESS_NOTICE_DURATION, ERROR_NOTICE_DURATION,
} from './file-review-tab-types.ts'
import type {
  FileReviewTabProps, FileReviewRemote, Notice, FlatChange, PendingScroll,
  FileTurnEntry, PathWindowStats,
} from './file-review-tab-types.ts'
import { Stats, UndoIcon, RedoIcon, Chevron, StateBadge, LazyDiff } from './review-widgets.tsx'
import { TurnRewindDialog } from './turn-rewind-dialog.tsx'
import { MultiSessionConfirmDialog, FileTimelineDialog } from './review-dialogs.tsx'

// Tab 入参类型是本模块公开面的一部分（better-sidebar 装配方引用）。
export type { FileReviewTabProps }

/** 侧边栏 tab 本体：逐轮变更组 + 行内 diff + 撤销。 */
export function FileReviewTab({ ctx, sessionId, cwd, visible, tab }: FileReviewTabProps) {
  const sessions = (ctx as unknown as { readonly sessions: ISessions }).sessions
  const [states, setStates] = useState<ReadonlyMap<string, FileReviewFileState>>(() => new Map())
  const [statusPending, setStatusPending] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [notice, setNotice] = useState<Notice | null>(null)
  const [tick, setTick] = useState(0)
  // 双向同步（review-state）：live 条行内撤销/重做的结果回流到这里——
  // tick 触发宿主重巡检，本界面的行状态与 live 条保持同一事实。
  useEffect(() => subscribeReviewRows(() => { setTick(value => value + 1) }), [])
  // 块级选择：stateKey → 选中 hunk 下标集合；缺省（无条目）= 隐式全选。
  const [hunkSelection, setHunkSelection] = useState<ReadonlyMap<string, ReadonlySet<number>>>(() => new Map())
  // 打开「从快照恢复此轮」对话框的回合号；null = 关闭。
  const [rewindTurn, setRewindTurn] = useState<number | null>(null)
  // 打开文件级时间线对话框的路径；null = 关闭。
  const [timelinePath, setTimelinePath] = useState<string | null>(null)
  // 多会话确认弹窗的待提交批次（批次含 owner === 'multi' 时暂存）；null = 关闭。
  const [pendingConfirm, setPendingConfirm] = useState<{
    key: string
    items: readonly FlatChange[]
    action: FileReviewAction
  } | null>(null)
  const noticeSeqRef = useRef(0)
  const noticeTimerRef = useRef<number | null>(null)

  // 本会话的 Live Chat 快照（dsh 0.1.2：会话变更推导的数据源从
  // runtime 会话快照换成 uiConversation 会话绑定的 `chat` 目标快照）。
  const uiConversation = (ctx as unknown as {
    readonly uiConversation?: {
      binding(source: string): {
        target(target: 'chat'): { subscribe(listener: () => void): () => void; getSnapshot(): ChatSnapshot | undefined }
      }
    }
  }).uiConversation
  const chatSource = useMemo(
    () => uiConversation?.binding(sessionId).target('chat'),
    [uiConversation, sessionId],
  )
  const subscribe = useCallback(
    (listener: () => void) => chatSource?.subscribe(listener) ?? (() => {}),
    [chatSource],
  )
  const snapshot: ChatSnapshot | null = useSyncExternalStore(
    subscribe,
    () => chatSource?.getSnapshot() ?? null,
  )

  // 会话标题查询（归因徽标把「他会话 id」升级成可读标题；缺省回落 id 截断）。
  const sessionList = useSyncExternalStore(
    useCallback((listener: () => void) => sessions.list.subscribe(listener), [sessions]),
    () => sessions.list.getSnapshot(),
  )
  const sessionTitle = useCallback(
    (id: string) => sessionList.byId[id as SessionId]?.displayTitle,
    [sessionList],
  )

  // Code Mode（run_code）根调用及其宿主录制的变更：嵌套派发没有可复用的视图,
  // 所以每个根的变更要异步拉取，再并入下面快照推导出的各轮。拉取在根集合
  // 变化（新一轮 run_code）或手动刷新时重新触发。
  const roots = useMemo(
    () => (snapshot === null ? [] : deriveSessionRoots(snapshot)),
    [snapshot],
  )
  const rootsKey = useMemo(
    () => roots.map(root => root.rootCallId).join('|'),
    [roots],
  )
  const [recorded, setRecorded] = useState<readonly RecordedMutation[]>(() => [])
  // 经检查点对比发现的文件系统级变更（PowerShell 等终端写盘）：宿主的
  // /shadow-rewind/fs-changes 端点把每一轮的轮起检查点与**下一轮**的轮起
  // 检查点配对（= 轮末树状态），并预算好每文件的增/删行数。全文（整文件
  // diff）按需懒加载：展开 diff、撤销提交、恢复窗口统计时才拉，且按
  // (turn, path) 记忆。
  const [fsRaw, setFsRaw] = useState<readonly FsChangeTurn[]>([])
  const [ensuredFs, setEnsuredFs] = useState<ReadonlyMap<string, SessionFileChange>>(() => new Map())
  const fsRawRef = useRef(fsRaw)
  fsRawRef.current = fsRaw
  const ensuredFsRef = useRef(ensuredFs)
  ensuredFsRef.current = ensuredFs

  useEffect(() => {
    if (!visible || cwd === undefined || cwd.trim() === '') {
      setFsRaw([])
      setEnsuredFs(new Map())
      return
    }

    let active = true

    fetchAllFsChanges(sessionId).then((payload) => {
      if (!active) return
      // J6：全文记忆随清单更新一并失效——底层 lazy 缓存已被 warm 替换作废，
      // 侧栏若继续命中 ensuredFs 会长期展示过期 diff（与卡片的失效规则相反）。
      setEnsuredFs(new Map())
      setFsRaw(payload.turns)
    }).catch(() => {
      if (!active) return
      setFsRaw([])
    })

    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, tick, sessionId, cwd])

  // J6：接入 warm 缓存广播——live 条推进时审查界面同步重拉，消除
  // 「双通道获取、两侧新鲜度不同」的展示分叉。
  useEffect(() => {
    if (!visible || cwd === undefined || cwd.trim() === '') return
    let active = true
    const unsubscribe = subscribeFsCache(() => {
      if (!active) return
      fetchAllFsChanges(sessionId).then((payload) => {
        if (!active) return
        setEnsuredFs(new Map())
        setFsRaw(payload.turns)
      }).catch(() => { /* warm 广播驱动的重拉失败：保留现有数据 */ })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [visible, sessionId, cwd])

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
    // 自动勾选：归因非本会话（autoSelect === false）的条目此时才知道 hunk 数，
    // 初始化为显式空勾选（行按钮默认禁用，须显式勾选才提交）；本会话写入与
    // 无归因条目保持隐式全选；已有用户选择绝不覆盖。
    setHunkSelection((current) => {
      let changed = false
      const next = new Map(current)
      for (const [key, value] of settled) {
        if (value === null || value.autoSelect !== false || next.has(key)) continue
        next.set(key, new Set<number>())
        changed = true
      }
      return changed ? next : current
    })
  }, [cwd])

  // fs 占位（计数）→ 已补齐条目的合并视图：同 (turn, path) 优先用懒加载全文。
  const fsTurns = useMemo<TurnFileChanges[]>(() => {
    const result: TurnFileChanges[] = []
    for (const fsTurn of fsRaw) {
      const files: SessionFileChange[] = []
      for (const change of fsTurn.changes) {
        const ensured = ensuredFs.get(`${String(fsTurn.turn)}|${change.path}`)
        if (ensured !== undefined) {
          files.push(ensured)
          continue
        }
        files.push({
          path: change.path,
          diffs: [],
          origin: 'fs',
          ...(change.dir === true ? { dir: true as const } : {}),
          ...(change.added !== undefined || change.removed !== undefined
            ? { counts: { added: change.added ?? 0, removed: change.removed ?? 0 } }
            : {}),
          ...(change.kind === 'deleted' ? { deleted: true as const } : {}),
          ...fsAttributionOf(change),
        })
      }
      if (files.length > 0) result.push({ turn: fsTurn.turn, live: false, files })
    }
    return result
  }, [fsRaw, ensuredFs])

  useEffect(() => {
    if (!visible || roots.length === 0) return
    let active = true
    const timer = window.setTimeout(() => {
      // 弹性解析（remote-access）：命名空间服务丢失时自动重挂一次再取。
      invokeFileReviewRecorded(ctx, sessionId, { rootCallIds: roots.map(root => root.rootCallId) })
        .then((value) => {
          if (!active) return
          setRecorded(value.mutations)
        })
        .catch(() => {
          // 瞬时拉取失败：保留上一次的记录；下一轮快照 / 手动刷新会重试。
        })
    }, 200)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rootsKey, tick, sessions, sessionId])

  const turns = useMemo(
    () => {
      const base = mergeRecordedTurns(deriveSessionChanges(snapshot), roots, recorded)
      // 把文件系统级变更（PowerShell 等）并入轮列表：同轮的组按文件逐个合并，
      // 保证同一轮绝不被渲染两遍。
      if (fsTurns.length === 0) return base
      const byTurn = new Map<number, TurnFileChanges>()
      for (const turn of base) byTurn.set(turn.turn, turn)
      for (const fsTurn of fsTurns) {
        const existing = byTurn.get(fsTurn.turn)
        if (existing === undefined) {
          byTurn.set(fsTurn.turn, fsTurn)
          continue
        }
        const files = [...existing.files]
        for (const fsFile of fsTurn.files) {
          const index = files.findIndex(f => pathKey(f.path) === pathKey(fsFile.path))
          if (index === -1) files.push(fsFile)
          // 同路径的工具视图条目已经带着 hunks，保留它们。
        }
        byTurn.set(fsTurn.turn, { turn: existing.turn, live: existing.live, files })
      }
      return [...byTurn.values()].sort((a, b) => a.turn - b.turn)
    },
    [snapshot, roots, recorded, fsTurns],
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
    setReviewRows(sessionId, result.files)
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

  /** Toggle one change set (a whole turn, or one file) undo ↔ redo — 提交闸
   * 单点：轮/文件按钮都传全文，筛选在此统一完成。
   * ① autoSelect === false 的条目（其它会话/歧义写入）须有显式勾选才纳入；
   * ② 批次含 owner === 'multi'（真多会话冲突）⇒ 先弹确认窗，确认后走
   * applyToggle；其余批次直接提交。 */
  const applyToggle = useCallback((
    key: string,
    items: readonly FlatChange[],
    action: FileReviewAction,
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
      return invoke('apply', {
        action,
        files: submitted.map(({ item }) => ({
          path: item.path,
          diffs: item.diffs,
          ...(item.origin !== undefined ? { origin: item.origin } : {}),
          ...(item.dir === true
            ? { dirKind: item.deleted === true ? 'deleted' as const : 'added' as const }
            : {}),
        })),
      })
    })().then((result) => {
      if (result === undefined) return
      mergeResultStates(submitted, result)
      const target = action === 'undo' ? 'undone' : 'applied'
      const failures = result.files.filter(file => file.state !== target)
      if (failures.length === 0) {
        showNotice('success', t(action === 'undo' ? 'undoSuccess' : 'redoSuccess'))
      } else {
        showNotice('error', t(action === 'undo' ? 'undoPartial' : 'redoPartial'))
      }
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
    // autoSelect === false 且无显式勾选 ⇒ 不纳入提交批次（默认不勾选 ⇒
    // 提交必经用户显式勾选，纯他会话文件由此无需弹窗确认）。
    const candidates = items.filter((item) => {
      if (item.autoSelect !== false) return true
      const selection = hunkSelection.get(stateKey(item.turn, item.path))
      return selection !== undefined && selection.size > 0
    })
    if (candidates.length === 0) return
    if (candidates.some(item => item.owner === 'multi')) {
      setPendingConfirm({ key, items: candidates, action })
      return
    }
    void applyToggle(key, candidates, action)
  }, [busyKey, hunkSelection, applyToggle])

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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

  // 按轮恢复窗口（第 rewindTurn 轮起）内本会话各路径的累计 +/- 与最近改动轮次。
  const windowStats = useMemo(() => {
    const map = new Map<string, PathWindowStats>()
    if (rewindTurn === null) return map
    for (const entry of flat) {
      if (entry.turn < rewindTurn) continue
      const existing = map.get(entry.path)
      const stats = entry.counts ?? summarizeDiffs(entry.diffs)
      map.set(entry.path, {
        stats: existing === undefined ? stats : addStats(existing.stats, stats),
        latestTurn: existing === undefined ? entry.turn : Math.max(existing.latestTurn, entry.turn),
      })
    }
    return map
  }, [flat, rewindTurn])

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
    return (
      <section
        key={turn.turn}
        ref={(element) => {
          if (element === null) turnRefs.current.delete(turn.turn)
          else turnRefs.current.set(turn.turn, element)
        }}
        className={css.turnGroup}
      >
        <header className={css.turnHeader}>
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
            onClick={() => {
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
              // 恢复窗口统计需要 fs 条目的 +/-：先按需补齐（幂等，已补的跳过）。
              void ensureFsTurnFiles(turn.turn)
              setRewindTurn(turn.turn)
            }}
          >
            {t('snapshotRestore')}
          </button>
        </header>
        <ul className={css.fileList}>
          {turn.files.map(file => renderFile(turn, file))}
        </ul>
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
            disabled={statusPending || busyKey !== null || !(reversible || fsPending) || ((reversible || file.autoSelect === false) && selectedCount === 0)}
            title={deletedNoDiff
              ? t('deletedHint')
              : (!(reversible || fsPending)
                ? t('toggleUnavailable')
                : ((reversible || file.autoSelect === false) && selectedCount === 0) ? t('hunkNoneSelected') : undefined)}
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
                  <UnifiedDiff
                    diffs={file.diffs}
                    contextLines={3}
                    showCopyButton
                    showFileHeaders={false}
                    selectable
                    navigation
                    selectedHunks={hunkSelection.get(key)}
                    onSelectedHunksChange={(next) => { changeHunkSelection(key, file.diffs.length, next) }}
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
        <TurnRewindDialog
          sessionId={sessionId}
          turn={rewindTurn}
          windowStats={windowStats}
          onJumpToDiff={jumpToFile}
          sessionTitle={sessionTitle}
          onClose={() => { setRewindTurn(null) }}
          onRestored={() => {
            setTick(value => value + 1)
            // 整树恢复成功：以当前快照最大节点 seq 为屏障打整树遮蔽标记，
            // live 条的会话累计视图随之扣掉恢复前的全部改动。
            markRewound(sessionId, null, snapshotBarrierOf(snapshot))
            showNotice('success', t('snapshotDone'))
          }}
        />
      )}
      {pendingConfirm !== null && (
        <MultiSessionConfirmDialog
          items={pendingConfirm.items}
          action={pendingConfirm.action}
          sessionTitle={sessionTitle}
          onCancel={() => { setPendingConfirm(null) }}
          onManual={() => {
            const conflicts = pendingConfirm.items.filter(item => item.owner === 'multi')
            setPendingConfirm(null)
            // 展开冲突行并滚到首条；先补齐全文让勾选框即刻可用。
            for (const item of conflicts) void ensureFsTurnFiles(item.turn, [item.path])
            setExpanded((current) => {
              const next = new Set(current)
              for (const item of conflicts) next.add(stateKey(item.turn, item.path))
              return next
            })
            const first = conflicts[0]
            if (first !== undefined) pendingScrollRef.current = { rowKey: stateKey(first.turn, first.path), turn: null }
          }}
          onProceed={() => {
            const pending = pendingConfirm
            setPendingConfirm(null)
            void applyToggle(pending.key, pending.items, pending.action)
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
