import { describe, expect, it } from 'vitest'
import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM } from '../canvas/zoom-limits'
import { snapViewportZoom, snappedZoom } from './zoomSnap'

const CENTER = { x: 800, y: 450 }

describe('snappedZoom', () => {
  it('rounds to the percentage the dock already displays', () => {
    expect(snappedZoom(1.0734)).toBe(1.07)
    expect(snappedZoom(0.7551)).toBe(0.76)
    expect(snappedZoom(0.5)).toBe(0.5)
  })

  it('stays inside the canvas range, so a rounding cannot land the camera outside it', () => {
    expect(snappedZoom(CANVAS_MAX_ZOOM)).toBe(CANVAS_MAX_ZOOM)
    expect(snappedZoom(CANVAS_MIN_ZOOM)).toBe(CANVAS_MIN_ZOOM)
    expect(snappedZoom(0.004)).toBe(CANVAS_MIN_ZOOM)
  })
})

describe('snapViewportZoom', () => {
  it('holds the anchor still while the scale rounds', () => {
    const anchor = { x: 300, y: 200 }
    const vp = { x: -120, y: -40, zoom: 1.0734 }
    const next = snapViewportZoom(vp, anchor)!

    // The canvas point under the anchor is the same before and after.
    const before = { x: (anchor.x - vp.x) / vp.zoom, y: (anchor.y - vp.y) / vp.zoom }
    const after = { x: (anchor.x - next.x) / next.zoom, y: (anchor.y - next.y) / next.zoom }

    expect(next.zoom).toBe(1.07)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('answers null on a zoom already whole, so the caller writes no viewport at all', () => {
    expect(snapViewportZoom({ x: 10, y: 20, zoom: 1 }, CENTER)).toBeNull()
    expect(snapViewportZoom({ x: 10, y: 20, zoom: 0.25 }, CENTER)).toBeNull()
  })

  it('never corrects by more than half a percentage point', () => {
    for (let pct = CANVAS_MIN_ZOOM * 100; pct <= CANVAS_MAX_ZOOM * 100; pct += 0.13) {
      const zoom = pct / 100
      const next = snapViewportZoom({ x: 0, y: 0, zoom }, CENTER)
      if (next) expect(Math.abs(next.zoom - zoom)).toBeLessThanOrEqual(0.005 + 1e-9)
    }
  })

  it('is idempotent: snapping a snapped viewport is a no-op', () => {
    const once = snapViewportZoom({ x: -120, y: -40, zoom: 1.0734 }, CENTER)!

    expect(snapViewportZoom(once, CENTER)).toBeNull()
  })
})
