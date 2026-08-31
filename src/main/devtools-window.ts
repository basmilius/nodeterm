import type { BrowserWindow, BrowserWindowConstructorOptions, WebContents } from 'electron'

/**
 * DevTools for a <webview> guest, hosted in our OWN window.
 *
 * Two measured facts drive every option below; both cost a probe to establish, so do not
 * "simplify" them away.
 *
 * **1. A `<webview>` may not host DevTools.** Chromium forbids guest views as DevTools containers
 * (electron/electron#14095, of which #15874 is a duplicate). Measured on Electron 42.10: routing a
 * guest's DevTools into a second `<webview>` renders the frontend shell — every panel tab is in the
 * DOM — while Elements, Console and Network all stay empty, because no data ever arrives. The
 * `debugger.attach()` workaround from #17168 and the `remote-debugging-port` route from #15874 both
 * reproduce it byte for byte. A `BrowserWindow` IS a supported host, which is what this module uses.
 *
 * **2. macOS makes a new window fullscreen when the app is in a fullscreen Space.** Measured: five
 * windows asking for 501..505 x 400 all came back at 2056 x 1290, each in its own Space, so the
 * DevTools window replaced the app instead of floating over it. `fullscreenable: false` is what
 * prevents that; every window kept its own size with it set.
 *
 * **`parent` is the trap.** The obvious `new BrowserWindow({ parent: mainWindow })` is exactly
 * wrong: measured over three sweeps, EVERY child-window config was invisible on the parent's
 * fullscreen Space, `visibleOnFullScreen` and `alwaysOnTop` included. A child window does not
 * follow its parent into fullscreen; it stays behind on the old Space. So these windows are
 * deliberately parentless, and {@link isDevToolsWindow} exists to keep the rest of the app from
 * mistaking one for an ordinary app window.
 *
 * Surfaces: desktop only. The Server Edition has no `<webview>` and no Electron windows, and the
 * mobile companion has no browser nodes, so there is nothing to degrade there.
 */

/** Opened at a readable default; the user resizes from there. */
export const DEVTOOLS_WINDOW_SIZE = { width: 1100, height: 720 }

/** Marks our hosts so `activate` / `window-all-closed` can tell them from real app windows. */
const DEVTOOLS_WINDOW_FLAG = Symbol.for('nodeterm.devToolsWindow')

export interface DevToolsWindowDeps {
  createWindow(options: BrowserWindowConstructorOptions): BrowserWindow
  /** Injected so the darwin-only calls are exercised off a Mac. */
  platform: NodeJS.Platform
}

/**
 * The window options. No `parent`, and `fullscreenable: false` — see the module doc for what each
 * one is measured to prevent.
 *
 * `show: false` matters for a different reason: `setDevToolsWebContents` requires a host that has
 * NOT navigated, so the window is created empty and never loaded; `openDevTools` is what fills it,
 * and only then is it shown.
 */
export function devToolsWindowOptions(title: string): BrowserWindowConstructorOptions {
  return {
    ...DEVTOOLS_WINDOW_SIZE,
    title,
    show: false,
    fullscreenable: false,
    backgroundColor: '#1e1e1e',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false }
  }
}

/**
 * What makes the window float over a fullscreen app (darwin only).
 *
 * `skipTransformProcessType` is not an optimization: without it Electron flips the process type
 * around every call, which hides the window and the dock icon for a moment each time.
 */
export const DEVTOOLS_WORKSPACE_OPTIONS = {
  visibleOnFullScreen: true,
  skipTransformProcessType: true
} as const

/**
 * The `visible` argument to `setVisibleOnAllWorkspaces`, which is FALSE on purpose.
 *
 * The two halves of that call set independent NSWindow collection behaviors: `visible` sets
 * `canJoinAllSpaces` and the option sets `fullScreenAuxiliary`. Only the second one is wanted
 * here. Passing `true` put the inspector on literally every Space, so swiping to the desktop
 * dragged it along, and it is measured to be unnecessary: with `visible: false` the window still
 * floats over the app's fullscreen Space.
 */
export const DEVTOOLS_JOINS_ALL_SPACES = false

/** Whether a window is one of our DevTools hosts rather than an app window. */
export function isDevToolsWindow(win: BrowserWindow): boolean {
  return (win as unknown as Record<symbol, unknown>)[DEVTOOLS_WINDOW_FLAG] === true
}

interface Host {
  win: BrowserWindow
  target: WebContents
  onDevToolsClosed: () => void
}

/**
 * One DevTools host window per inspected guest, opened on demand and torn down with whichever of
 * the two sides goes first.
 */
export class DevToolsWindows {
  private readonly hosts = new Map<number, Host>()

  constructor(private readonly deps: DevToolsWindowDeps) {}

  /** Live host count; the app's window bookkeeping reads it, and the tests assert on it. */
  get size(): number {
    return this.hosts.size
  }

  /**
   * Open (or re-focus) DevTools for `target`. When `at` is given the element under that point is
   * selected, which is what the guest context menu's "Inspect Element" wants.
   */
  open(target: WebContents, title: string, at?: { x: number; y: number }): void {
    if (target.isDestroyed()) return

    const existing = this.hosts.get(target.id)
    if (existing && !existing.win.isDestroyed()) {
      existing.win.show()
      existing.win.focus()
      if (at) target.inspectElement(at.x, at.y)
      return
    }

    const win = this.deps.createWindow(devToolsWindowOptions(title))
    ;(win as unknown as Record<symbol, unknown>)[DEVTOOLS_WINDOW_FLAG] = true

    // Order matters: the host must be handed over before DevTools is opened, and `detach` is the
    // only mode that applies once an external host owns the UI.
    target.setDevToolsWebContents(win.webContents)
    target.openDevTools({ mode: 'detach' })

    if (this.deps.platform === 'darwin') {
      win.setVisibleOnAllWorkspaces(DEVTOOLS_JOINS_ALL_SPACES, DEVTOOLS_WORKSPACE_OPTIONS)
    }
    win.show()
    if (at) target.inspectElement(at.x, at.y)

    const onDevToolsClosed = (): void => this.close(target.id)
    target.on('devtools-closed', onDevToolsClosed)
    target.once('destroyed', onDevToolsClosed)
    // Closing the window is the user ending the session; drop the entry FIRST so the
    // closeDevTools below cannot bounce back in through 'devtools-closed'.
    win.once('closed', () => {
      this.hosts.delete(target.id)
      target.off('devtools-closed', onDevToolsClosed)
      if (!target.isDestroyed() && target.isDevToolsOpened()) target.closeDevTools()
    })

    this.hosts.set(target.id, { win, target, onDevToolsClosed })
  }

  /** Tear down the host for one target, if any. */
  close(targetId: number): void {
    const host = this.hosts.get(targetId)
    if (!host) return
    this.hosts.delete(targetId)
    if (!host.target.isDestroyed()) host.target.off('devtools-closed', host.onDevToolsClosed)
    if (!host.win.isDestroyed()) host.win.close()
  }

  closeAll(): void {
    for (const id of [...this.hosts.keys()]) this.close(id)
  }
}
