/**
 * 文件审查侧栏 tab·小组件。
 *
 * 统计徽标 / 撤销重做图标 / 折叠箭头 / 宿主巡检状态徽标 / diff 懒渲染容器。
 * 全部是纯展示件：状态由父组件持有，这里不发起任何请求。
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { FileReviewFileState } from '../file-review/change-types.ts'
import type { UnifiedDiffStats } from './UnifiedDiff.tsx'
import { t } from './locales.ts'
import css from './FileReviewTab.module.css'

/** 行内 +/− 统计徽标（aria-label 供读屏，数字供扫读）。 */
export function Stats({ stats }: { readonly stats: UnifiedDiffStats }) {
  return (
    <span className={css.stats} aria-label={t('stats', {
      added: String(stats.added), removed: String(stats.removed),
    })}>
      <span className={css.added}>+{stats.added}</span>
      <span className={css.removed}>-{stats.removed}</span>
    </span>
  )
}

/** 撤销动作图标（轮/文件按钮共用）。 */
export function UndoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="M8 5 4 9l4 4M4 9h7a5 5 0 0 1 5 5v1" />
    </svg>
  )
}

/** 重做动作图标（撤销后的按钮从 undo 换成 redo）。 */
export function RedoIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className={css.buttonIcon}>
      <path d="m12 5 4 4-4 4M16 9H9a5 5 0 0 0-5 5v1" />
    </svg>
  )
}

/** 文件行折叠箭头（open 时旋转指向下方）。 */
export function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={`${css.chevron} ${open ? css.chevronOpen : ''}`}
    >
      <path d="m7 5 5 5-5 5" />
    </svg>
  )
}

/** 每个 (轮, 文件) 的宿主巡检状态徽标；'applied' 时不渲染任何东西。 */
export function StateBadge({ state }: { readonly state: FileReviewFileState | undefined }) {
  if (state === undefined || state === 'applied') return null
  const label = state === 'undone'
    ? t('stateUndone')
    : state === 'conflict'
      ? t('stateConflict')
      : state === 'unsupported'
        ? t('stateUnsupported')
        : t('stateError')
  const tone = state === 'undone'
    ? css.badgeUndone
    : state === 'unsupported'
      ? css.badgeMuted
      : css.badgeError
  return <span className={`${css.stateBadge} ${tone}`}>{label}</span>
}

/** 懒渲染：只有行接近视口时才挂载重的 diff 渲染器（200px 预读余量）。 */
export function LazyDiff({ children }: { children: ReactNode }) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    if (inView) return
    const element = holderRef.current
    if (element === null) return
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) {
        setInView(true)
        observer.disconnect()
      }
    }, { rootMargin: '200px 0px' })
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [inView])
  return <div ref={holderRef}>{inView ? children : <div style={{ minHeight: '96px' }} />}</div>
}
