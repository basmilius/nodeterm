import { CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM } from '../canvas/zoom-limits'

/**
 * Zoom moves multiplicatively (`nextWheelZoom` is `zoom * exp(...)`), so a wheel or pinch lands on
 * an arbitrary scale while the dock rounds it for display: the readout says 107% at 1.0734. The
 * snap moves the camera to the number already on screen, so `+` then `-` returns where it started
 * and two nodes at "100%" are the same size.
 *
 * Applied once at rest. Rounding mid-gesture would fight the input and pin zoom to the snapped
 * step.
 */
export interface SnapViewport {
  x: number
  y: number
  zoom: number
}

/** Where a snap holds the camera still. Wrapper-relative pixels, like the wheel handler's. */
export interface SnapAnchor {
  x: number
  y: number
}

/** The whole-percent scale the dock already displays for `zoom`, kept inside the canvas range. */
export function snappedZoom(zoom: number): number {
  return Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, Math.round(zoom * 100) / 100))
}

/**
 * The viewport that puts `vp` on a whole percent with `anchor` held still, or `null` when it is
 * already there.
 *
 * Null rather than an equal viewport, so the caller can skip the `setViewport` entirely: a
 * no-op write still runs the whole move pipeline (dirty marking, glyph camera, the gesture latch)
 * for a camera that did not move.
 */
export function snapViewportZoom(vp: SnapViewport, anchor: SnapAnchor): SnapViewport | null {
  const zoom = snappedZoom(vp.zoom)
  if (zoom === vp.zoom || !Number.isFinite(zoom) || zoom <= 0) return null

  const k = zoom / vp.zoom
  return {
    x: anchor.x - (anchor.x - vp.x) * k,
    y: anchor.y - (anchor.y - vp.y) * k,
    zoom
  }
}
