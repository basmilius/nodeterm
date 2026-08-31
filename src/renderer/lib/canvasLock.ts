/**
 * Canvas lock — which gestures the canvas refuses, as a SET rather than one boolean.
 *
 * The lock used to be a single flag that froze the camera (pan + zoom) and nothing else. That is
 * one useful answer out of several: a user tidying a layout wants the map to stop sliding while
 * nodes stay draggable, and a user showing the canvas to someone else wants the opposite — the
 * camera free, the layout untouchable. So each gesture is its own aspect and the dock button opens
 * a menu over them, with an "everything" row for the old one-click behavior.
 *
 * Deliberately NOT a lock on selecting, connecting or editing: those are work, not layout, and a
 * lock that stops a click from reaching a terminal reads as "the app is frozen" — the same reason
 * the state is transient (see `state/canvasLock.ts`).
 */

export type CanvasLockAspect = 'pan' | 'zoom' | 'drag' | 'resize'

export type CanvasLock = Record<CanvasLockAspect, boolean>

export interface CanvasLockAspectSpec {
  id: CanvasLockAspect
  label: string
  /** What the row actually freezes, shown as the row's tooltip. */
  hint: string
}

/** Menu order: the two camera aspects first (what the old lock did), then the two node ones. */
export const CANVAS_LOCK_ASPECTS: readonly CanvasLockAspectSpec[] = [
  { id: 'pan', label: 'Panning', hint: 'Freezes dragging and scrolling the canvas' },
  { id: 'zoom', label: 'Zooming', hint: 'Freezes pinch, wheel zoom and the double-click overview' },
  { id: 'drag', label: 'Moving nodes', hint: 'Nodes cannot be dragged to a new position' },
  { id: 'resize', label: 'Resizing nodes', hint: 'Hides the resize handles on every node' }
]

export const NO_LOCK: CanvasLock = { pan: false, zoom: false, drag: false, resize: false }

export const ALL_LOCKED: CanvasLock = { pan: true, zoom: true, drag: true, resize: true }

export function isAnyLocked(lock: CanvasLock): boolean {
  return CANVAS_LOCK_ASPECTS.some((a) => lock[a.id])
}

export function isAllLocked(lock: CanvasLock): boolean {
  return CANVAS_LOCK_ASPECTS.every((a) => lock[a.id])
}

export function toggleAspect(lock: CanvasLock, aspect: CanvasLockAspect): CanvasLock {
  return { ...lock, [aspect]: !lock[aspect] }
}

/** The "everything" row: locks all four, or clears them when they are already all locked. */
export function toggleAll(lock: CanvasLock): CanvasLock {
  return isAllLocked(lock) ? { ...NO_LOCK } : { ...ALL_LOCKED }
}

/**
 * The dock button's tooltip. It names what is locked rather than saying "locked", because the
 * button is one icon over four independent aspects and "Locked" would leave the user to guess
 * which of their gestures just stopped working.
 */
export function lockSummary(lock: CanvasLock): string {
  if (isAllLocked(lock)) return 'Locked: everything'
  const locked = CANVAS_LOCK_ASPECTS.filter((a) => lock[a.id])
  if (locked.length === 0) return 'Lock canvas'
  return `Locked: ${locked.map((a) => a.label.toLowerCase()).join(', ')}`
}
