// How tall a web node should be once its page has told us how tall the page is.
//
// WHY THE WIDTH IS NOT MEASURED: a `<webview>` is given a CSS size, and the page lays itself out to
// that width. Reading `scrollWidth` back therefore returns the width we just handed it, for every
// page that is not deliberately wider than its viewport. The width is a choice
// (`settings.webNodeWidth`); only the height is a measurement.

/** The measurement and the bounds a fit is decided against. All in canvas (flow) pixels. */
export interface WebNodeFit {
  /** `document.documentElement.scrollHeight` as the guest reported it. */
  pageHeight: number
  /** The node's height minus the guest's, i.e. the header and borders around it. Measured rather
   *  than assumed, so a change to the node's chrome does not silently cut the page off. */
  chromeHeight: number
  /** The node's current height, so an unchanged answer can be skipped. */
  currentHeight: number
  /** `settings.webNodeMaxHeight`. */
  maxHeight: number
  /** The node kind's minimum, so a blank or one-line page still leaves something to grab. */
  minHeight: number
}

/** Ignore a difference smaller than this: sub-pixel layout noise must not write to project.json. */
const FIT_EPSILON_PX = 4

/**
 * The height to apply, or null to leave the node alone.
 *
 * Null covers every case where we know nothing useful: a guest that answered with a non-number, a
 * zero-height page (a document that has not painted, or an error page), and bounds that make no
 * sense. Leaving the node at the size it opened with is always a safe answer; guessing is not.
 */
export function webNodeFitHeight(fit: WebNodeFit): number | null {
  const { pageHeight, chromeHeight, currentHeight, maxHeight, minHeight } = fit
  const usable = (v: number): boolean => Number.isFinite(v) && v > 0
  if (!usable(pageHeight) || !usable(maxHeight) || !usable(minHeight)) return null
  if (!Number.isFinite(chromeHeight) || chromeHeight < 0) return null
  const wanted = Math.round(pageHeight + chromeHeight)
  const next = Math.min(Math.max(wanted, minHeight), Math.max(minHeight, maxHeight))
  if (Number.isFinite(currentHeight) && Math.abs(next - currentHeight) < FIT_EPSILON_PX) return null
  return next
}

/** The one expression the guest is asked to evaluate. Kept here beside the maths that consumes it
 *  so the two cannot describe different things. `body` is read as well because a document with an
 *  absolutely positioned layout can leave `documentElement.scrollHeight` at the viewport height. */
export const PAGE_HEIGHT_EXPRESSION =
  'Math.max(document.documentElement ? document.documentElement.scrollHeight : 0,' +
  ' document.body ? document.body.scrollHeight : 0)'
