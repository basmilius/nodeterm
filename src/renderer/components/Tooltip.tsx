import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** How close the bubble may come to the window edge before it is slid back inward. */
const EDGE_MARGIN = 8

interface TooltipOptions {
  delay?: number
  /** Which side of the trigger the bubble opens on. Chrome that hugs the bottom of the window (the
   *  dock) must open upward: below it, the bubble lands off-screen. */
  placement?: 'top' | 'bottom'
}

interface TooltipProps extends TooltipOptions {
  label: string
  children: ReactNode
}

interface TooltipTrigger {
  /** Spread onto the trigger element. */
  triggerProps: {
    onMouseEnter: (e: React.MouseEvent) => void
    onMouseLeave: () => void
    onMouseDown: () => void
  }
  /** Render anywhere in the tree: the bubble portals to `document.body` regardless. */
  bubble: ReactNode
}

/**
 * The tooltip without its wrapper element, for a trigger that cannot take one: a React Flow
 * `Handle` positions itself with `translate(±50%, ±50%)` against the node, so a wrapper risks
 * moving it. The props compose rather than replace, since `Handle` destructures `onMouseDown` and
 * calls it from its own pointer-down handler.
 */
export function useTooltip(label: string, { delay = 350, placement = 'bottom' }: TooltipOptions = {}): TooltipTrigger {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const [left, setLeft] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)

  // A centered bubble runs off-screen for a long label near the window edge (a link handle carries
  // a whole sentence). `nowrap` makes the width independent of `left`, so this settles in one pass.
  useLayoutEffect(() => {
    const el = bubbleRef.current
    if (!anchor || !el) return
    const half = el.offsetWidth / 2
    const min = EDGE_MARGIN + half
    const max = window.innerWidth - EDGE_MARGIN - half
    const next = min > max ? window.innerWidth / 2 : Math.min(Math.max(anchor.x, min), max)
    if (next !== left) setLeft(next)
  }, [anchor, left])

  const show = (e: React.MouseEvent): void => {
    const el = e.currentTarget as HTMLElement
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect()
      const x = r.left + r.width / 2
      setLeft(x)
      setAnchor({ x, y: placement === 'top' ? r.top - 6 : r.bottom + 6 })
    }, delay)
  }

  const hide = (): void => {
    if (timer.current) clearTimeout(timer.current)
    setAnchor(null)
  }

  return {
    triggerProps: { onMouseEnter: show, onMouseLeave: hide, onMouseDown: hide },
    bubble:
      anchor &&
      createPortal(
        <div
          ref={bubbleRef}
          className={`tooltip${placement === 'top' ? ' tooltip--top' : ''}`}
          style={{ left, top: anchor.y }}
        >
          {label}
        </div>,
        document.body
      )
  }
}

/** A custom styled tooltip (portal, fixed-positioned) shown on hover after a short delay. */
export function Tooltip({ label, children, delay, placement }: TooltipProps) {
  const { triggerProps, bubble } = useTooltip(label, { delay, placement })

  return (
    <span className="tooltip-trigger nodrag" {...triggerProps}>
      {children}
      {bubble}
    </span>
  )
}
