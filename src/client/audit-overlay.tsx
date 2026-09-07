/**
 * AuditOverlay —— 文件审查的全屏对话框界面（侧边栏 tab 移除后的新家）。
 *
 * 复用 FileReviewTab 的全部能力（逐轮 diff、hunk 级撤销/重做、每轮快照恢复），
 * 只是外壳从 better-sidebar tab 换成独立的模态对话框：入口在 live 条头部
 * 按钮（或点行深链到该文件的展开态）。回退遮罩点击关闭。
 *
 * 状态同步：FileReviewTab 的开关结果经 review-state 广播，live 条行内按钮
 * 随之翻转；反向（live 条行内撤销）也经同一存储回到本界面（订阅 → 重巡检）。
 */
import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import { FileReviewTab } from './FileReviewTab.tsx'

const STYLE_ID = 'dsh-shadow-rewind-audit'

/** 本界面对话框专属样式（遮罩/骨架复用 rewind 面注入的 srw-* 类）。 */
const styles = `
.srw-dialog[data-srw-audit="true"]{width:min(960px,100%);max-height:calc(100dvh - 64px)}
.srw-dialog[data-srw-audit="true"] .srw-audit-body{min-height:0;flex:1 1 auto;overflow:hidden;display:flex;flex-direction:column}
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
    if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return () => {}
    const tag = document.createElement('style')
    tag.dataset.plugin = STYLE_ID
    tag.dataset.pluginCss = STYLE_ID
    tag.textContent = styles
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, [])

  // Esc 关闭：对话框里逐轮 diff 展开很多内容，键盘逃逸是基本礼仪。
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onClose])

  const meta = React.useMemo<{ readonly meta?: unknown }>(
    () => seedPaths !== undefined && seedPaths.length > 0 ? { meta: { expandPaths: [...seedPaths] } } : EMPTY_META,
    [seedPaths],
  )

  return React.createElement('div', {
    className: 'srw-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    onClick: (event: React.MouseEvent) => {
      if (event.target === event.currentTarget) onClose()
    },
  },
  React.createElement('div', { className: 'srw-dialog', 'data-srw-audit': 'true' },
    React.createElement('div', { className: 'srw-dialog-head' },
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
  )
}
