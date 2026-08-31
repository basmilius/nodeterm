// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DerivedProjectIdentity } from '@shared/project-icon-derive'
import { derivedGlyphFor, useDerivedProjectIdentity } from './derivedProjectIdentity'

type Api = { workspace?: { deriveIdentity?: (id: string, opts?: unknown) => Promise<unknown> } }

function install(
  deriveIdentity: ((id: string, opts?: unknown) => Promise<DerivedProjectIdentity>) | undefined
): void {
  ;(globalThis as unknown as { window: { nodeTerminal?: Api } }).window.nodeTerminal =
    deriveIdentity ? { workspace: { deriveIdentity } } : {}
}

/** The store's `ensure` is fire-and-forget; give its promise chain a turn to land. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  useDerivedProjectIdentity.setState({ byId: {} })
  // The module-level "already asked" set is not exported; `forget` is the supported way to clear
  // it, and it is what a project deletion calls.
  useDerivedProjectIdentity.getState().forget('p1')
})

afterEach(() => {
  install(undefined)
  vi.restoreAllMocks()
})

describe('useDerivedProjectIdentity', () => {
  it('asks the host once per project, however many sites want the glyph', async () => {
    const derive = vi.fn(async () => ({ icon: null, name: 'From folder' }))
    install(derive)
    const { ensure } = useDerivedProjectIdentity.getState()
    ensure('p1')
    ensure('p1')
    ensure('p1')
    await settle()
    expect(derive).toHaveBeenCalledTimes(1)
    expect(useDerivedProjectIdentity.getState().byId.p1).toEqual({ icon: null, name: 'From folder' })
  })

  it('stores an empty answer, so a folder that declares nothing is not asked again', async () => {
    const derive = vi.fn(async () => ({ icon: null, name: null }))
    install(derive)
    useDerivedProjectIdentity.getState().ensure('p1')
    await settle()
    useDerivedProjectIdentity.getState().ensure('p1')
    await settle()
    expect(derive).toHaveBeenCalledTimes(1)
    expect(useDerivedProjectIdentity.getState().byId.p1).toEqual({ icon: null, name: null })
  })

  it('does not keep an `unresolved` answer — an SSH project whose master is not up yet', async () => {
    const derive = vi
      .fn()
      .mockResolvedValueOnce({ icon: null, name: null, unresolved: true })
      .mockResolvedValueOnce({ icon: null, name: 'Connected' })
    install(derive as never)
    useDerivedProjectIdentity.getState().ensure('p1')
    await settle()
    expect(useDerivedProjectIdentity.getState().byId.p1).toBeUndefined()

    // What the hooks do when the project's connection lands.
    useDerivedProjectIdentity.getState().ensure('p1')
    await settle()
    expect(useDerivedProjectIdentity.getState().byId.p1?.name).toBe('Connected')
  })

  it('retries after a request that could not be made at all', async () => {
    const derive = vi
      .fn()
      .mockRejectedValueOnce(new Error('no channel'))
      .mockResolvedValueOnce({ icon: null, name: 'Second try' })
    install(derive as never)
    useDerivedProjectIdentity.getState().ensure('p1')
    await settle()
    expect(useDerivedProjectIdentity.getState().byId.p1).toBeUndefined()

    useDerivedProjectIdentity.getState().ensure('p1')
    await settle()
    expect(useDerivedProjectIdentity.getState().byId.p1?.name).toBe('Second try')
  })

  it('sanitizes a derived SVG on the way into the store', async () => {
    install(async () => ({
      icon: { kind: 'svg', svg: '<svg><script>alert(1)</script></svg>', from: '.idea/icon.svg' },
      name: null
    }))
    useDerivedProjectIdentity.getState().ensure('p1')
    await settle()
    const icon = useDerivedProjectIdentity.getState().byId.p1?.icon
    expect(icon?.from).toBe('.idea/icon.svg')
    expect(Buffer.from(icon!.src.split(',')[1], 'base64').toString()).not.toContain('script')
  })

  it('does nothing when the surface has no channel for it', async () => {
    install(undefined)
    useDerivedProjectIdentity.getState().ensure('p1')
    await settle()
    expect(useDerivedProjectIdentity.getState().byId.p1).toBeUndefined()
  })

  it('re-reads on refresh', async () => {
    const derive = vi
      .fn()
      .mockResolvedValueOnce({ icon: null, name: 'Old' })
      .mockResolvedValueOnce({ icon: null, name: 'New' })
    install(derive as never)
    useDerivedProjectIdentity.getState().ensure('p1')
    await settle()
    await useDerivedProjectIdentity.getState().refresh('p1')
    expect(useDerivedProjectIdentity.getState().byId.p1?.name).toBe('New')
    expect(derive).toHaveBeenLastCalledWith('p1', { refresh: true })
  })
})

describe('derivedGlyphFor', () => {
  const entry = { icon: { src: 'data:image/png;base64,AA', from: 'favicon.png' }, name: null }

  it('hands the derived icon on only when the project has none of its own', () => {
    expect(derivedGlyphFor(false, entry)).toBe(entry.icon)
    expect(derivedGlyphFor(true, entry)).toBeNull()
    expect(derivedGlyphFor(false, undefined)).toBeNull()
  })
})
