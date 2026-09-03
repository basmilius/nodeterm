import { describe, expect, it } from 'vitest'
import { PAGE_HEIGHT_EXPRESSION, webNodeFitHeight, type WebNodeFit } from './webNodeFit'

const fit = (over: Partial<WebNodeFit> = {}): WebNodeFit => ({
  pageHeight: 1400,
  chromeHeight: 44,
  currentHeight: 520,
  maxHeight: 3000,
  minHeight: 200,
  ...over
})

describe('webNodeFitHeight', () => {
  it('grows the node to the page plus the chrome around it', () => {
    // The whole point: a report that is 1400px tall opens showing all 1400px, instead of the user
    // dragging the node bigger every single time.
    expect(webNodeFitHeight(fit())).toBe(1444)
  })

  it('holds a long page at the configured ceiling', () => {
    // A live site is routinely tens of thousands of pixels tall. Without this one node becomes the
    // whole canvas.
    expect(webNodeFitHeight(fit({ pageHeight: 40000 }))).toBe(3000)
    expect(webNodeFitHeight(fit({ pageHeight: 40000, maxHeight: 1600 }))).toBe(1600)
  })

  it('does not shrink below the node kind minimum', () => {
    expect(webNodeFitHeight(fit({ pageHeight: 20 }))).toBe(200)
  })

  it('keeps the minimum when the ceiling is set below it', () => {
    // settings.json is hand-editable, and a max under the min must not produce a node too small to
    // grab. The floor wins.
    expect(webNodeFitHeight(fit({ pageHeight: 900, maxHeight: 100 }))).toBe(200)
  })

  it('leaves the node alone when it is already the right height', () => {
    // Sub-pixel layout noise must not rewrite the node, because that writes project.json and, on a
    // shared or SSH project, bumps the workspace rev.
    expect(webNodeFitHeight(fit({ currentHeight: 1444 }))).toBeNull()
    expect(webNodeFitHeight(fit({ currentHeight: 1446 }))).toBeNull()
    expect(webNodeFitHeight(fit({ currentHeight: 1400 }))).toBe(1444)
  })

  it('refuses a measurement it cannot use, so the node keeps the size it opened at', () => {
    // A guest that has not painted, an error page, or a value that came back as anything but a
    // number. Guessing a height here is worse than leaving the node where it is.
    expect(webNodeFitHeight(fit({ pageHeight: 0 }))).toBeNull()
    expect(webNodeFitHeight(fit({ pageHeight: NaN }))).toBeNull()
    expect(webNodeFitHeight(fit({ chromeHeight: -10 }))).toBeNull()
    expect(webNodeFitHeight(fit({ maxHeight: 0 }))).toBeNull()
  })
})

describe('PAGE_HEIGHT_EXPRESSION', () => {
  it('reads both roots, because either can be the one that knows', () => {
    // A document laid out with absolute positioning can leave documentElement.scrollHeight at the
    // viewport height while body knows the real extent.
    expect(PAGE_HEIGHT_EXPRESSION).toContain('documentElement')
    expect(PAGE_HEIGHT_EXPRESSION).toContain('document.body')
  })

  it('survives a document with neither, instead of throwing inside the guest', () => {
    const evaluate = new Function('document', `return ${PAGE_HEIGHT_EXPRESSION}`)
    expect(evaluate({})).toBe(0)
    expect(evaluate({ documentElement: { scrollHeight: 900 } })).toBe(900)
    expect(evaluate({ body: { scrollHeight: 1200 } })).toBe(1200)
  })
})
