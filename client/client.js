/**
 * dsh-shadow-rewind —— 浏览器半边（手写 ModuleLoader bundle，无构建步骤）。
 *
 * 职责：给每条直发用户消息挂「恢复到发送之前」入口，打开预览对话框
 * （文件清单 / 快照跳过项 / 两种回退模式），确认后调用宿主 /shadow-rewind
 * 端点执行文件恢复，可选在分叉出的新会话里继续。
 *
 * 全部走客户端公开服务（slots / sessions / conversation），宿主半边不注入
 * 任何上下文；文件恢复的真正执行与安全闸都在引擎侧。
 */
window.__ModuleLoader__.load({ id: 'dsh-shadow-rewind', factory: (require) => {
  const React = require('react')
  const h = React.createElement
  const PATH = '/shadow-rewind'

  // ── 样式 ────────────────────────────────────────────────────────────────

  const STYLE_ID = 'dsh-shadow-rewind'
  const styles = `
.srw-tail{display:inline-flex;align-items:center;align-self:center;height:24px;margin-left:2px}
.srw-trigger{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.srw-trigger:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.srw-overlay{position:fixed;inset:0;z-index:2147483200;display:flex;align-items:center;justify-content:center;background:rgba(4,8,18,.55);backdrop-filter:blur(4px)}
.srw-dialog{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;width:min(560px,100%);max-height:calc(100dvh - 96px);padding:18px 20px;border-radius:14px;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#111a2e);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));box-shadow:0 18px 60px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary,#e6ecff)}
.srw-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:15px;font-weight:600}
.srw-foot{display:flex;justify-content:flex-end;gap:8px}
.srw-foot button{height:30px;padding:0 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:transparent;color:var(--dsw-alias-label-secondary,#b8c5ea);cursor:pointer;font-size:13px}
.srw-foot button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08))}
.srw-foot button:disabled{opacity:.5;cursor:default}
.srw-content{min-width:0;min-height:0;overflow-y:auto;overscroll-behavior:contain}
.srw-body{display:flex;flex-direction:column;gap:14px;width:100%;min-width:0;box-sizing:border-box}
.srw-option{display:flex;align-items:flex-start;gap:10px;width:100%;box-sizing:border-box;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.srw-option[data-selected="true"]{border-color:var(--dsw-alias-state-business-primary)}
.srw-option input{flex:none;margin:2px 0 0}
.srw-option-content{flex:1;min-width:0}
.srw-option strong{display:block;color:var(--dsw-alias-label-primary);font-size:14px}
.srw-option-description{display:block;margin-top:3px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.srw-summary{display:flex;flex-wrap:wrap;column-gap:16px;row-gap:4px;color:var(--dsw-alias-label-secondary);font-size:13px}
.srw-files{max-height:220px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px}
.srw-file{display:flex;justify-content:space-between;gap:16px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px}
.srw-file:last-child{border-bottom:0}
.srw-file code{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary)}
.srw-kind{flex:none;color:var(--dsw-alias-label-tertiary)}
.srw-skipped{margin:0;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}
.srw-status{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.srw-warning,.srw-error{margin:0;padding:10px 12px;border-radius:10px;font-size:12px;line-height:18px;overflow-wrap:anywhere}
.srw-warning{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-primary)}
.srw-error{border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);color:var(--dsw-alias-state-error-primary)}
.srw-retry{align-self:flex-start}
`

  // ── 入口：注册消息操作行的 portal 桥 ─────────────────────────────────────

  const inject = ['slots', 'sessions', 'conversation']

  function apply(ctx) {
    ctx.effect(() => {
      if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = STYLE_ID
      tag.dataset.pluginCss = STYLE_ID
      tag.textContent = styles
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }, 'shadow-rewind: styles')
    ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'shadow-rewind-portals',
      order: 100,
      inject: () => ({
        openRestoredSession: async (sessionId, promptText) => {
          await openSessionWithDraft(ctx, sessionId, promptText)
        },
      }),
    }, RewindPortals))
  }

  /** 从一条会话节点提取「可回退的直发用户消息」锚点。 */
  function selectRewindMessage(node) {
    if (node.kind !== 'user' || !Number.isSafeInteger(node.seq) || node.seq < 0) return null
    const promptText = (node.content ?? [])
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
    return { messageSeq: node.seq, promptText }
  }

  function RewindPortals({ sessionId, openRestoredSession, useSession }) {
    const nodes = useSession((snapshot) => snapshot.chat?.nodes.values() ?? snapshot.nodes)
    const [targets, setTargets] = React.useState([])
    React.useLayoutEffect(() => {
      let active = true
      let queued = false
      const refresh = () => {
        if (!active) return
        const next = collectTargets(nodes)
        setTargets((current) => sameTargets(current, next) ? current : next)
      }
      // DOM 行可能晚于会话快照出现；MutationObserver + 微任务去重足够。
      const queue = () => {
        if (queued || !active) return
        queued = true
        queueMicrotask(() => { queued = false; refresh() })
      }
      refresh()
      const observer = new MutationObserver(queue)
      observer.observe(document.body, { childList: true, subtree: true })
      return () => { active = false; observer.disconnect() }
    }, [nodes])
    return targets.map((target) => React.createElement(RewindAction, {
      key: `${sessionId}:${String(target.matched.messageSeq)}`,
      matched: target.matched,
      container: target.container,
      sessionId,
      openRestoredSession,
    }))
  }

  function RewindAction({ matched, container, sessionId, openRestoredSession }) {
    const [open, setOpen] = React.useState(false)
    return h(React.Fragment, null,
      createPortalButton(container, matched, () => setOpen(true)),
      open && h(RewindDialog, {
        sessionId,
        matched,
        openRestoredSession,
        onClose: () => setOpen(false),
      }),
    )
  }

  /** 往消息操作行尾部注入回退按钮（命令式 DOM，与宿主列表结构解耦）。 */
  function createPortalButton(container, matched, onOpen) {
    let holder = container.querySelector(':scope > .srw-tail')
    if (holder === null) {
      holder = document.createElement('span')
      holder.className = 'srw-tail'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'srw-trigger'
      button.title = '恢复到发送这条消息之前'
      button.setAttribute('aria-label', '恢复到发送这条消息之前')
      button.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.35 3.25 2.75 7l3.6 3.75M3.1 7h5.15a4.25 4.25 0 0 1 4.25 4.25v1.25" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      button.addEventListener('click', (event) => {
        event.stopPropagation()
        event.preventDefault()
        onOpen()
      })
      holder.appendChild(button)
      container.appendChild(holder)
    }
    return null
  }

  // ── 回退对话框 ──────────────────────────────────────────────────────────

  function RewindDialog({ sessionId, matched, openRestoredSession, onClose }) {
    const [loading, setLoading] = React.useState(true)
    const [preview, setPreview] = React.useState(null)
    const [mode, setMode] = React.useState('both')
    const [applying, setApplying] = React.useState(false)
    const [stale, setStale] = React.useState(false)
    const [error, setError] = React.useState(null)
    const [completed, setCompleted] = React.useState(null)

    const load = React.useCallback(async () => {
      setLoading(true)
      setStale(false)
      setError(null)
      setCompleted(null)
      try {
        const response = await fetch(`${PATH}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}`, {
          headers: { accept: 'application/json' }, cache: 'no-store',
        })
        setPreview(decodePreview(await responseJson(response)))
      } catch (caught) {
        setError(friendlyError(caught))
      } finally {
        setLoading(false)
      }
    }, [sessionId, matched.messageSeq])

    React.useEffect(() => { void load() }, [load])

    const ready = preview !== null && preview.status === 'ready' ? preview : null
    const hasChanges = ready !== null && ready.totalChanges > 0
    const sharedBlocked = (ready?.activeSessionIds.length ?? 0) > 0
    const planMissing = hasChanges && ready !== null && !sharedBlocked
      && (ready.planId === undefined || ready.confirmation === undefined)
    const canApply = ready !== null && !loading && !applying && completed === null
      && hasChanges && !sharedBlocked && !planMissing && !stale

    const loadAll = async () => {
      if (ready === null || !ready.truncated) return
      setLoading(true)
      try {
        const collected = [...ready.changes]
        let offset = collected.length
        while (offset < ready.totalChanges) {
          const response = await fetch(`${PATH}?sessionId=${encodeURIComponent(sessionId)}&messageSeq=${String(matched.messageSeq)}&details=1&offset=${String(offset)}&limit=200`, {
            headers: { accept: 'application/json' }, cache: 'no-store',
          })
          const page = decodePreview(await responseJson(response))
          if (page.status !== 'ready' || page.checkpointId !== ready.checkpointId || page.offset !== offset) {
            throw new RewindRequestError('PLAN_STALE', '项目文件在展开列表时发生了变化。')
          }
          collected.push(...page.changes)
          offset += page.changes.length
          if (page.changes.length === 0) break
        }
        setPreview({ ...ready, changes: collected, truncated: false })
      } catch (caught) {
        if (caught instanceof RewindRequestError && caught.code === 'PLAN_STALE') setStale(true)
        setError(friendlyError(caught))
      } finally {
        setLoading(false)
      }
    }

    const applyRestore = async () => {
      if (ready === null || !canApply) return
      setApplying(true)
      setError(null)
      try {
        const response = await fetch(PATH, {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            mode,
            sessionId,
            messageSeq: ready.messageSeq,
            checkpointId: ready.checkpointId,
            planId: ready.planId,
            confirmation: ready.confirmation,
          }),
        })
        const result = await responseJson(response)
        if (mode === 'code') {
          setCompleted('项目文件已恢复；当前对话保持不变。恢复前的文件已自动备份。')
          return
        }
        setCompleted('项目文件已恢复，并已创建新对话。恢复前的文件已自动备份。')
        try {
          await openRestoredSession(result.sessionId, matched.promptText)
          onClose()
        } catch (navigationError) {
          setError(`文件已经恢复，新对话也已创建，但没能自动打开：${messageOf(navigationError)}`)
        }
      } catch (caught) {
        if (caught instanceof RewindRequestError && (caught.code === 'PLAN_STALE' || caught.code === 'WORKSPACE_IN_USE')) {
          setStale(true)
        }
        setError(friendlyError(caught))
      } finally {
        setApplying(false)
      }
    }

    const radioName = `srw-${sessionId}-${String(matched.messageSeq)}`
    return h('div', { className: 'srw-overlay', role: 'dialog', 'aria-modal': 'true' },
      h('div', { className: 'srw-dialog' },
        h('div', { className: 'srw-dialog-head' },
          h('strong', null, '恢复到发送这条消息之前'),
          h('button', { type: 'button', className: 'srw-trigger', onClick: onClose, 'aria-label': '关闭' }, '✕'),
        ),
        h('div', { className: 'srw-content' },
          h('div', { className: 'srw-body' },
            loading && h('p', { className: 'srw-status' }, '正在检查可以恢复的项目文件…'),
            preview?.status === 'pending' && h('p', { className: 'srw-status' }, '这条消息发送之前的文件还在保存，请稍后再试。'),
            preview?.status === 'missing' && h('p', { className: 'srw-error' }, '没有保存这条消息发送之前的文件。可能是当时还未启用回退功能，或记录已超出保留期限。'),
            preview?.status === 'skipped' && h('p', { className: 'srw-status' }, '为避免阻塞消息发送，本轮没有自动保存文件：', preview.reason),
            preview?.status === 'failed' && h('p', { className: 'srw-error' }, '没能保存这条消息发送之前的文件：', preview.error),
            ready !== null && [
              h('div', { key: 'options' },
                optionRadio(radioName, 'both', mode, applying, setMode, '恢复文件并从这里继续', '创建一个从这里开始的新会话（当前对话会保留）'),
                optionRadio(radioName, 'code', mode, applying, setMode, '只恢复文件', '恢复这条消息发送之前的文件，当前对话保持不变。'),
              ),
              h('div', { className: 'srw-summary' },
                h('strong', null, `将恢复 ${String(ready.totalChanges)} 个文件`),
                h('span', null, mode === 'both' ? '恢复后在新对话里继续' : '当前对话保持不变'),
              ),
              sharedBlocked && h('p', { className: 'srw-error' }, '这个项目目录还有别的对话正在运行。恢复文件会影响到它们，因此本次操作已被阻止。'),
              ready.skippedPaths.length > 0 && h('div', { className: 'srw-skipped' }, [
                h('div', { key: 'title' }, '以下文件未纳入快照，恢复不会改动它们：'),
                ...ready.skippedPaths.map((skip) => h('div', { key: skip.path },
                  h('code', null, skip.path), `（${skipReasonLabel(skip.reason)}）`)),
              ]),
              planMissing && h('p', { className: 'srw-error' }, '恢复信息已经失效，请重新检查。'),
              stale && h('p', { className: 'srw-error' }, '项目文件在检查后又发生了变化。为避免覆盖新修改，本次恢复已失效，请重新检查。'),
              ready.totalChanges === 0 && h('p', { className: 'srw-status' }, '项目文件已经是这条消息发送前的状态，无需恢复。'),
              ready.changes.length > 0 && h('div', { className: 'srw-files' },
                ready.changes.map((change) => h('div', { className: 'srw-file', key: change.path },
                  h('code', null, change.path),
                  h('span', { className: 'srw-kind' }, kindLabel(change.kind)),
                )),
              ),
              ready.truncated && h('button', { type: 'button', className: 'srw-retry', onClick: () => { void loadAll() } },
                `查看全部 ${String(ready.totalChanges)} 个文件`),
            ],
            completed !== null && h('p', { className: 'srw-status' }, completed),
            error !== null && h('p', { className: 'srw-error' }, error),
            !loading && (preview === null || preview.status !== 'ready' || stale || planMissing || sharedBlocked) && completed === null
              && h('button', { type: 'button', className: 'srw-retry', onClick: () => { void load() } }, '重新检查'),
          ),
        ),
        h('div', { className: 'srw-foot' },
          h('button', { type: 'button', onClick: onClose, disabled: applying }, '取消'),
          h('button', { type: 'button', onClick: () => { void applyRestore() }, disabled: !canApply },
            applying ? '正在恢复…' : completed === null ? (mode === 'both' ? '恢复并从这里继续' : '恢复文件') : '已完成'),
        ),
      ),
    )
  }

  function optionRadio(radioName, value, mode, disabled, setMode, title, description) {
    return h('label', { className: 'srw-option', 'data-selected': mode === value, key: value },
      h('input', {
        type: 'radio', name: radioName, checked: mode === value, disabled,
        onChange: () => setMode(value),
      }),
      h('span', { className: 'srw-option-content' },
        h('strong', null, title),
        h('span', { className: 'srw-option-description' }, description),
      ),
    )
  }

  // ── 协议解析与文案 ───────────────────────────────────────────────────────

  function decodePreview(value) {
    const record = recordOf(value)
    const status = requiredString(record.status, 'status')
    if (status === 'pending' || status === 'missing') return { status }
    if (status === 'skipped') return { status, reason: requiredString(record.reason, 'reason') }
    if (status === 'failed') return { status, error: requiredString(record.error, 'error') }
    if (status !== 'ready') throw new Error(`未知回退状态：${status}`)
    if (!Array.isArray(record.changes)) throw new Error('回退预览缺少 changes')
    const activeSessionIds = Array.isArray(record.activeSessionIds) ? record.activeSessionIds : []
    // 跳过项明细：[{path, reason}]，逐条渲染给用户看。
    const skippedPaths = Array.isArray(record.skippedPaths)
      ? record.skippedPaths.map((entry) => {
        const skip = recordOf(entry)
        return { path: requiredString(skip.path, 'path'), reason: requiredString(skip.reason, 'reason') }
      })
      : []
    return {
      status,
      sessionId: requiredString(record.sessionId, 'sessionId'),
      messageSeq: requiredInteger(record.messageSeq, 'messageSeq'),
      turn: requiredInteger(record.turn, 'turn'),
      checkpointId: requiredString(record.checkpointId, 'checkpointId'),
      totalChanges: requiredInteger(record.totalChanges, 'totalChanges'),
      changes: record.changes.map((entry) => {
        const change = recordOf(entry)
        return { path: requiredString(change.path, 'path'), kind: requiredString(change.kind, 'kind') }
      }),
      truncated: record.truncated === true,
      activeSessionIds,
      skippedPaths,
      ...(typeof record.planId === 'string' ? { planId: record.planId } : {}),
      ...(typeof record.confirmation === 'string' ? { confirmation: record.confirmation } : {}),
    }
  }

  /** 跳过原因的用户文案。 */
  function skipReasonLabel(reason) {
    switch (reason) {
      case 'too-large': return '超过大小上限'
      case 'unsupported-type': return '文件类型不支持'
      case 'read-failed': return '读取失败'
      default: return reason
    }
  }

  function kindLabel(kind) {
    switch (kind) {
      case 'added': return '移除后来新增的文件'
      case 'deleted': return '找回文件'
      case 'modified': return '恢复之前的版本'
      case 'mode-changed': return '恢复文件权限'
      case 'type-changed': return '恢复之前的文件类型'
      default: return kind
    }
  }

  function friendlyError(error) {
    if (error instanceof RewindRequestError) {
      switch (error.code) {
        case 'PLAN_STALE': return '项目文件在检查后又发生了变化。为避免覆盖新修改，请重新检查后再恢复。'
        case 'WORKSPACE_IN_USE': return '这个项目目录还有别的对话正在运行。请等那些对话结束或停止后，再重新检查。'
        case 'WORKSPACE_LOCKED': return '另一个恢复操作正在处理这个项目目录。请等待它完成后重新检查。'
        case 'RESTORE_POINT_NOT_FOUND': return '没有找到对应的文件状态，可能已被清理。'
        case 'NO_CHANGES': return '项目文件已经是这条消息发送前的状态，无需恢复。'
        case 'RESTORE_FAILED_ROLLED_BACK': return '恢复未能完成，项目文件已自动还原到操作前的状态。'
        case 'CONVERSATION_REWIND_FAILED': return '文件已恢复，但无法创建新对话；项目文件已自动还原。'
        case 'RECOVERY_REQUIRED': return error.message
        default: return error.message
      }
    }
    return messageOf(error)
  }

  // ── DOM 收集与会话跳转 ───────────────────────────────────────────────────

  function collectTargets(nodes) {
    const rows = new Map()
    for (const element of Array.from(document.querySelectorAll('[data-chat-flow-kind="user"][data-chat-anchor-key]'))) {
      const key = element.dataset.chatAnchorKey
      if (key !== undefined) rows.set(key, element)
    }
    const targets = []
    for (const node of nodes) {
      const matched = selectRewindMessage(node)
      if (matched === null) continue
      const row = rows.get(node.key ?? `node:${String(node.seq)}`)
      const actions = row?.querySelector('[data-time-hover-root="true"]')?.lastElementChild
      if (!(actions instanceof HTMLElement)) continue
      targets.push({ container: actions, matched })
    }
    return targets
  }

  function sameTargets(left, right) {
    return left.length === right.length && left.every((target, index) => {
      const other = right[index]
      return other !== undefined
        && target.container === other.container
        && target.matched.messageSeq === other.matched.messageSeq
    })
  }

  async function openSessionWithDraft(ctx, sessionId, promptText) {
    let lastError = new Error('新对话还没有准备好')
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        ctx.sessions.open(sessionId)
        const scope = ctx.sessions.scope(sessionId)
        if (scope !== undefined) {
          ctx.conversation.input.for(scope).setDraft(promptText)
          return
        }
        lastError = new Error('新对话还没有准备好')
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => { setTimeout(resolve, 50) })
    }
    throw lastError
  }

  // ── 基础工具 ─────────────────────────────────────────────────────────────

  async function responseJson(response) {
    const value = await response.json()
    if (!response.ok) {
      const record = recordOf(value)
      throw new RewindRequestError(
        typeof record.code === 'string' ? record.code : 'REWIND_FAILED',
        typeof record.error === 'string' ? record.error : `请求失败：${String(response.status)}`,
      )
    }
    return value
  }

  class RewindRequestError extends Error {
    constructor(code, message) {
      super(message)
      this.code = code
    }
  }

  function recordOf(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('服务器返回了无效对象')
    }
    return value
  }

  function requiredString(value, name) {
    if (typeof value !== 'string' || value === '') throw new Error(`${name} 无效`)
    return value
  }

  function requiredInteger(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} 无效`)
    return value
  }

  function messageOf(error) {
    return error instanceof Error ? error.message : String(error)
  }

  module.exports = { inject, apply }
  return module.exports
} })