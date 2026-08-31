import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions, WebContents } from 'electron'
import {
  DevToolsWindows,
  DEVTOOLS_JOINS_ALL_SPACES,
  DEVTOOLS_WORKSPACE_OPTIONS,
  devToolsWindowOptions,
  isDevToolsWindow
} from './devtools-window'

type Listener = () => void

function fakeWindow() {
  const once = new Map<string, Listener[]>()
  const win = {
    webContents: { id: 999 },
    destroyed: false,
    shown: 0,
    focused: 0,
    closed: 0,
    workspaces: [] as unknown[],
    isDestroyed: () => win.destroyed,
    show: () => void win.shown++,
    focus: () => void win.focused++,
    close: () => {
      win.closed++
      win.destroyed = true
      for (const fn of once.get('closed') ?? []) fn()
    },
    setVisibleOnAllWorkspaces: (visible: boolean, options: unknown) =>
      void win.workspaces.push({ visible, options }),
    once: (event: string, fn: Listener) => {
      once.set(event, [...(once.get(event) ?? []), fn])
      return win
    }
  }
  return win
}

function fakeTarget(id = 7) {
  const on = new Map<string, Listener[]>()
  const target = {
    id,
    destroyed: false,
    devToolsOpen: false,
    host: null as unknown,
    openedWith: null as unknown,
    inspected: [] as { x: number; y: number }[],
    closeDevToolsCalls: 0,
    isDestroyed: () => target.destroyed,
    isDevToolsOpened: () => target.devToolsOpen,
    setDevToolsWebContents: (wc: unknown) => void (target.host = wc),
    openDevTools: (opts: unknown) => {
      target.openedWith = opts
      target.devToolsOpen = true
    },
    closeDevTools: () => {
      target.closeDevToolsCalls++
      target.devToolsOpen = false
      target.emit('devtools-closed')
    },
    inspectElement: (x: number, y: number) => void target.inspected.push({ x, y }),
    on: (event: string, fn: Listener) => {
      on.set(event, [...(on.get(event) ?? []), fn])
      return target
    },
    once: (event: string, fn: Listener) => target.on(event, fn),
    off: (event: string, fn: Listener) => {
      on.set(event, (on.get(event) ?? []).filter((f) => f !== fn))
      return target
    },
    emit: (event: string) => {
      for (const fn of [...(on.get(event) ?? [])]) fn()
    }
  }
  return target
}

function setup(platform: NodeJS.Platform = 'darwin') {
  const windows: ReturnType<typeof fakeWindow>[] = []
  const optionsSeen: BrowserWindowConstructorOptions[] = []
  const manager = new DevToolsWindows({
    platform,
    createWindow: (options) => {
      optionsSeen.push(options)
      const win = fakeWindow()
      windows.push(win)
      return win as unknown as BrowserWindow
    }
  })
  return { manager, windows, optionsSeen }
}

const asTarget = (t: ReturnType<typeof fakeTarget>): WebContents => t as unknown as WebContents

describe('devToolsWindowOptions', () => {
  it('never sets a parent and refuses to be made fullscreen', () => {
    const opts = devToolsWindowOptions('Page') as Record<string, unknown>
    // Both are measured requirements, not defaults: a parented window is invisible on the
    // parent's fullscreen Space, and a fullscreenable one gets taken over by macOS.
    expect('parent' in opts).toBe(false)
    expect(opts.fullscreenable).toBe(false)
  })

  it('creates the host unshown and unnavigated', () => {
    // setDevToolsWebContents requires a host that has never navigated.
    const opts = devToolsWindowOptions('Page') as Record<string, unknown>
    expect(opts.show).toBe(false)
    expect('url' in opts).toBe(false)
  })
})

describe('DevToolsWindows', () => {
  it('hands the window over before opening, and only in detach mode', () => {
    const { manager, windows } = setup()
    const target = fakeTarget()
    manager.open(asTarget(target), 'Page')
    expect(target.host).toBe(windows[0].webContents)
    expect(target.openedWith).toEqual({ mode: 'detach' })
    expect(windows[0].shown).toBe(1)
  })

  it('floats over fullscreen on darwin, and skips the process-type flip', () => {
    const { manager, windows } = setup('darwin')
    manager.open(asTarget(fakeTarget()), 'Page')
    expect(windows[0].workspaces).toEqual([
      { visible: DEVTOOLS_JOINS_ALL_SPACES, options: DEVTOOLS_WORKSPACE_OPTIONS }
    ])
  })

  it('never joins all Spaces, which would drag the inspector onto the desktop on a swipe', () => {
    // fullScreenAuxiliary (the option) is what floats it; canJoinAllSpaces (the boolean) is not
    // needed and is what made a Space swipe carry the window along.
    expect(DEVTOOLS_JOINS_ALL_SPACES).toBe(false)
    expect(DEVTOOLS_WORKSPACE_OPTIONS.visibleOnFullScreen).toBe(true)
  })

  it('does not touch workspaces off darwin', () => {
    for (const platform of ['win32', 'linux'] as NodeJS.Platform[]) {
      const { manager, windows } = setup(platform)
      manager.open(asTarget(fakeTarget()), 'Page')
      expect(windows[0].workspaces).toEqual([])
    }
  })

  it('marks its windows so app window bookkeeping can skip them', () => {
    const { manager, windows } = setup()
    manager.open(asTarget(fakeTarget()), 'Page')
    expect(isDevToolsWindow(windows[0] as unknown as BrowserWindow)).toBe(true)
    expect(isDevToolsWindow(fakeWindow() as unknown as BrowserWindow)).toBe(false)
  })

  it('reuses the window for a second open on the same target', () => {
    const { manager, windows } = setup()
    const target = fakeTarget()
    manager.open(asTarget(target), 'Page')
    manager.open(asTarget(target), 'Page', { x: 4, y: 5 })
    expect(windows).toHaveLength(1)
    expect(windows[0].focused).toBe(1)
    expect(target.inspected).toEqual([{ x: 4, y: 5 }])
    expect(manager.size).toBe(1)
  })

  it('keeps one window per target', () => {
    const { manager, windows } = setup()
    manager.open(asTarget(fakeTarget(1)), 'A')
    manager.open(asTarget(fakeTarget(2)), 'B')
    expect(windows).toHaveLength(2)
    expect(manager.size).toBe(2)
  })

  it('inspects the clicked point when one is given', () => {
    const { manager } = setup()
    const target = fakeTarget()
    manager.open(asTarget(target), 'Page', { x: 12, y: 34 })
    expect(target.inspected).toEqual([{ x: 12, y: 34 }])
  })

  it('closes the window when the inspected guest goes away', () => {
    const { manager, windows } = setup()
    const target = fakeTarget()
    manager.open(asTarget(target), 'Page')
    target.destroyed = true
    target.emit('destroyed')
    expect(windows[0].closed).toBe(1)
    expect(manager.size).toBe(0)
  })

  it('closes the window when DevTools is closed on the target side', () => {
    const { manager, windows } = setup()
    const target = fakeTarget()
    manager.open(asTarget(target), 'Page')
    target.emit('devtools-closed')
    expect(windows[0].closed).toBe(1)
    expect(manager.size).toBe(0)
  })

  it('closing the window ends the DevTools session exactly once, without bouncing back', () => {
    const { manager, windows } = setup()
    const target = fakeTarget()
    manager.open(asTarget(target), 'Page')
    // closeDevTools re-emits 'devtools-closed'; the entry must already be gone or this recurses.
    windows[0].close()
    expect(target.closeDevToolsCalls).toBe(1)
    expect(windows[0].closed).toBe(1)
    expect(manager.size).toBe(0)
  })

  it('does not call closeDevTools on a target that is already gone', () => {
    const { manager, windows } = setup()
    const target = fakeTarget()
    manager.open(asTarget(target), 'Page')
    target.destroyed = true
    windows[0].close()
    expect(target.closeDevToolsCalls).toBe(0)
  })

  it('refuses a destroyed target instead of opening a window for it', () => {
    const { manager, windows } = setup()
    const target = fakeTarget()
    target.destroyed = true
    manager.open(asTarget(target), 'Page')
    expect(windows).toHaveLength(0)
    expect(manager.size).toBe(0)
  })

  it('closeAll tears every host down', () => {
    const { manager, windows } = setup()
    manager.open(asTarget(fakeTarget(1)), 'A')
    manager.open(asTarget(fakeTarget(2)), 'B')
    manager.closeAll()
    expect(manager.size).toBe(0)
    expect(windows.map((w) => w.closed)).toEqual([1, 1])
  })
})
