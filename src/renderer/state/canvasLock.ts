import { create } from 'zustand'
import {
  NO_LOCK,
  toggleAll,
  toggleAspect,
  type CanvasLock,
  type CanvasLockAspect
} from '../lib/canvasLock'

/**
 * The live canvas lock. A STORE rather than Canvas state because the resize aspect is read by
 * every node component (each renders its own `NodeResizer`), which React Flow gives no prop path
 * to — and a second copy of the flag beside Canvas's own is exactly the dual-source drift this
 * codebase avoids elsewhere.
 *
 * Transient by design: nothing here is persisted, so every launch starts unlocked. A lock that
 * survives a restart reads as "the app is frozen" to whoever opens it next.
 */
interface CanvasLockState {
  lock: CanvasLock
  toggle(aspect: CanvasLockAspect): void
  toggleAll(): void
}

export const useCanvasLock = create<CanvasLockState>((set) => ({
  lock: { ...NO_LOCK },
  toggle: (aspect) => set((s) => ({ lock: toggleAspect(s.lock, aspect) })),
  toggleAll: () => set((s) => ({ lock: toggleAll(s.lock) }))
}))

/** Node-side read: the selector returns a BOOLEAN, so an unrelated aspect never re-renders a node. */
export function useResizeLocked(): boolean {
  return useCanvasLock((s) => s.lock.resize)
}
