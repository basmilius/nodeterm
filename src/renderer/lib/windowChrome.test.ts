import { describe, expect, it } from 'vitest'
import { hasMacTrafficLights } from './windowChrome'

describe('hasMacTrafficLights', () => {
  it('is true only for the desktop app on macOS', () => {
    expect(hasMacTrafficLights(false, true)).toBe(true)
  })

  it('is false in a browser tab, macOS included', () => {
    // The trap this predicate exists for: the Server Edition serves the same TabBar, and
    // `isMacPlatform()` is navigator-based, so a Mac browser would otherwise reserve 86px for
    // traffic lights that only an Electron window has — issue #564 pointed the other way.
    expect(hasMacTrafficLights(true, true)).toBe(false)
  })

  it('is false off macOS on either shell', () => {
    expect(hasMacTrafficLights(false, false)).toBe(false)
    expect(hasMacTrafficLights(true, false)).toBe(false)
  })
})
