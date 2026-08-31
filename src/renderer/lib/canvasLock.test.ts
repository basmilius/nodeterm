import { describe, expect, it } from 'vitest'
import {
  ALL_LOCKED,
  CANVAS_LOCK_ASPECTS,
  isAllLocked,
  isAnyLocked,
  lockSummary,
  NO_LOCK,
  toggleAll,
  toggleAspect
} from './canvasLock'

describe('canvas lock aspects', () => {
  it('starts with nothing locked', () => {
    expect(isAnyLocked(NO_LOCK)).toBe(false)
    expect(isAllLocked(NO_LOCK)).toBe(false)
  })

  it('toggles one aspect without touching the others', () => {
    const next = toggleAspect(NO_LOCK, 'zoom')
    expect(next).toEqual({ pan: false, zoom: true, drag: false, resize: false })
    expect(toggleAspect(next, 'zoom')).toEqual(NO_LOCK)
  })

  it('reports a partial lock as any-but-not-all', () => {
    const partial = toggleAspect(NO_LOCK, 'drag')
    expect(isAnyLocked(partial)).toBe(true)
    expect(isAllLocked(partial)).toBe(false)
  })

  it('the everything row locks all from any partial state, and clears only when full', () => {
    expect(toggleAll(NO_LOCK)).toEqual(ALL_LOCKED)
    expect(toggleAll(toggleAspect(NO_LOCK, 'pan'))).toEqual(ALL_LOCKED)
    expect(toggleAll(ALL_LOCKED)).toEqual(NO_LOCK)
  })

  it('names what is locked instead of just saying locked', () => {
    expect(lockSummary(NO_LOCK)).toBe('Lock canvas')
    expect(lockSummary(ALL_LOCKED)).toBe('Locked: everything')
    expect(lockSummary(toggleAspect(toggleAspect(NO_LOCK, 'pan'), 'zoom'))).toBe(
      'Locked: panning, zooming'
    )
  })

  it('every aspect in the menu has a key in the lock record', () => {
    for (const aspect of CANVAS_LOCK_ASPECTS) {
      expect(ALL_LOCKED[aspect.id]).toBe(true)
      expect(NO_LOCK[aspect.id]).toBe(false)
    }
  })
})
