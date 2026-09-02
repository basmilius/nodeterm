/**
 * Does THIS window have macOS's inset traffic lights floating over its top-left? Published as one
 * class on `<html>`, which gates the `--titlebar-inset-left` the tab bar reserves for them
 * (issue #564).
 *
 * The tab bar is the title bar, and on macOS `titleBarStyle: 'hiddenInset'` paints the traffic
 * lights over it, so 86px on the left belongs to the OS. Everywhere else that space is nobody's:
 * Windows and Linux keep their native title bar with the buttons in it, and a Server Edition
 * browser tab has no window controls of ours at all — but the padding was unconditional, so the
 * logo sat 86px in and the tab strip lost the same 86px of width.
 *
 * The predicate is deliberately NOT `isMacPlatform()` alone. That check is navigator-based (it has
 * to be — the same renderer runs in both shells), so on a Mac it answers true in a BROWSER tab too,
 * where there are no traffic lights either. "Electron AND darwin" is the only form that is right on
 * all four combinations.
 */

const MAC_CLASS = 'mac-traffic-lights'

/** True when this window has macOS's inset traffic lights floating over its top-left. */
export function hasMacTrafficLights(isBrowser: boolean, isMac: boolean): boolean {
  return !isBrowser && isMac
}

/**
 * Stamps the class on `<html>`.
 *
 * Called from the boot switch, BEFORE the app renders: the tab bar's padding depends on it, and
 * setting it in a React effect would paint one frame at the wrong inset.
 */
export function applyWindowChromeClasses(isBrowser: boolean, isMac: boolean): void {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle(MAC_CLASS, hasMacTrafficLights(isBrowser, isMac))
}
