/**
 * AuditOverlay —— 文件审查的全屏界面（原侧边栏 tab 移除后的新家）。
 *
 * 参照 dsh-prompt-customizer 的 PanelShell 形态：**覆盖会话主区的右侧抽屉**，
 * 不再是居中弹窗——侧栏保持可点、可随时切会话；portal 到 document.body，
 * 避免宿主 React 树重建连带回收与 transform 祖先使 position:fixed 失效。
 *
 * 复用 FileReviewTab 的全部能力（逐轮 diff、hunk 级撤销/重做、每轮快照恢复、
 * 文件级时间线），入口在 live 条头部「审查」按钮（或点行深链到该文件）。
 * Esc / ✕ 关闭。
 */
import * as React from 'react'
import { createPortal } from 'react-dom'
import type { Context } from '@deepseek-ai/cordis'
import { FileReviewTab } from './FileReviewTab.tsx'

const STYLE_ID = 'dsh-shadow-rewind-audit'

/** 本界面对话框专属样式（独立抽屉外壳）。 */
const styles = `
.srw-audit-drawer{position:fixed;top:0;right:0;bottom:0;z-index:1000;display:flex;flex-direction:column;box-sizing:border-box;width:min(940px,100%);height:100vh;height:100dvh;background:var(--dsw-alias-bg-layer-1,#0d1526);color:var(--dsw-alias-label-primary,#e6ecff);border-left:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));box-shadow:-10px 0 30px rgba(0,0,0,.25)}
.srw-audit-head{display:flex;flex:none;align-items:center;justify-content:space-between;gap:10px;height:48px;padding:0 14px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));font-size:15px;font-weight:600}
.srw-audit-body{flex:1 1 auto;min-height:0;overflow:hidden;display:flex;flex-direction:column}
@media (max-width:767.98px){.srw-audit-drawer{width:100vw;max-width:100vw;border-left:none}}
@media (prefers-reduced-motion:reduce){.srw-audit-drawer{transition:none}}
`

/**
 * 深链种子：live 条点行打开时展开该文件的 diff。FileReviewTab 的 meta effect
 * 以「引用变化」重放展开——每次打开都传新对象，关闭态用同一个冻结空对象。
 */
const EMPTY_META: { readonly meta: { readonly expandPaths?: readonly string[] } } = { meta: {} }

export interface AuditOverlayProps {
  readonly ctx: Context
  readonly sessionId: string
  readonly cwd: string | undefined
  /** 从 live 条某行点入时预展开的路径（深链）。 */
  readonly seedPaths?: readonly string[]
  readonly onClose: () => void
}

export function AuditOverlay({ ctx, sessionId, cwd, seedPaths, onClose }: AuditOverlayProps) {
  React.useEffect(() => {
    if (document.getElementById(STYLE_ID) !== null) return () => {}
    const tag = document.createElement('style')
    tag.id = STYLE_ID
    tag.dataset.plugin = 'dsh-shadow-rewind'
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, [])

  // Esc 关闭：抽屉里逐轮 diff 展开很多内容，键盘逃逸是基本礼仪。
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [onClose])

  const meta = React.useMemo<{ readonly meta?: unknown }>(
    () => seedPaths !== undefined && seedPaths.length > 0 ? { meta: { expandPaths: [...seedPaths] } } : EMPTY_META,
    [seedPaths],
  )

  return createPortal(
    React.createElement('div', { className: 'srw-audit-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': '文件审查' },
      React.createElement('div', { className: 'srw-audit-head' },
        React.createElement('strong', null, '文件审查'),
        React.createElement('button', {
          type: 'button',
          className: 'srw-trigger',
          onClick: onClose,
          'aria-label': '关闭',
        }, '✕'),
      ),
      React.createElement('div', { className: 'srw-audit-body' },
        React.createElement(FileReviewTab, {
          ctx,
          sessionId,
          cwd,
          visible: true,
          tab: meta,
        }),
      ),
    ),
    document.body,
  )
}
