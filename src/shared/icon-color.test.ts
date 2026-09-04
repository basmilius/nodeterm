import { describe, expect, it } from 'vitest'
import {
  dominantPixelColor,
  dominantSvgColor,
  parseCssColor,
  rgbToHsl,
  toHex
} from './icon-color'

/** RGBA pixel buffer of `n` copies of a colour, so a test can weight one colour against another. */
function pixels(...runs: [hex: string, count: number][]): Uint8ClampedArray {
  const out: number[] = []
  for (const [hex, count] of runs) {
    const rgb = parseCssColor(hex)!
    for (let i = 0; i < count; i++) out.push(rgb.r, rgb.g, rgb.b, 255)
  }
  return Uint8ClampedArray.from(out)
}

describe('parseCssColor', () => {
  it('reads the hex and rgb() forms an icon actually uses', () => {
    expect(parseCssColor('#2970FF')).toEqual({ r: 41, g: 112, b: 255 })
    expect(parseCssColor('#29f')).toEqual({ r: 34, g: 153, b: 255 })
    expect(parseCssColor('rgb(41, 112, 255)')).toEqual({ r: 41, g: 112, b: 255 })
    expect(parseCssColor('rgba(41 112 255 / 0.9)')).toEqual({ r: 41, g: 112, b: 255 })
  })

  it('refuses what is not a literal colour', () => {
    for (const v of ['none', 'currentColor', 'url(#gradient)', 'transparent', 'rebeccapurple', '']) {
      expect(parseCssColor(v), v).toBeNull()
    }
  })

  it('refuses a colour that paints nothing', () => {
    expect(parseCssColor('#2970FF10')).toBeNull()
    expect(parseCssColor('rgba(41,112,255,0.1)')).toBeNull()
  })
})

describe('dominantSvgColor', () => {
  it('reads the mark’s colour off a real logo (the Flux .idea/icon.svg shape)', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" fill="none">' +
      '<path fill="#2970FF" d="M126 42C134 17 157 0 184 0h266z"/></svg>'
    expect(dominantSvgColor(svg)).toBe('#2970ff')
  })

  it('reads gradient stops — a shape filled with url(#g) has its colours there', () => {
    const svg =
      '<svg><defs><linearGradient id="g">' +
      '<stop stop-color="#ff8a3d"/><stop stop-color="#e0245e"/>' +
      '</linearGradient></defs><rect fill="url(#g)"/></svg>'
    expect(['#ff8a3d', '#e0245e']).toContain(dominantSvgColor(svg))
  })

  it('reads a style="fill:…" as well as an attribute', () => {
    expect(dominantSvgColor('<svg><path style="fill:#12b886;stroke:none"/></svg>')).toBe('#12b886')
  })

  it('ignores white, black and greys — every logo has those and none of them identify it', () => {
    const svg =
      '<svg><rect fill="#ffffff"/><rect fill="#ffffff"/><rect fill="#000"/>' +
      '<rect fill="#888888"/><path fill="#e0245e"/></svg>'
    expect(dominantSvgColor(svg)).toBe('#e0245e')
  })

  it('answers null for a monochrome or colourless mark, leaving the palette colour in charge', () => {
    expect(dominantSvgColor('<svg><path fill="currentColor"/></svg>')).toBeNull()
    expect(dominantSvgColor('<svg><path fill="#fff"/><path fill="#111"/></svg>')).toBeNull()
    expect(dominantSvgColor('')).toBeNull()
  })

  it('picks the most-painted colour, and the more saturated one on a tie', () => {
    const most = '<svg><path fill="#e0245e"/><path fill="#e0245e"/><path fill="#12b886"/></svg>'
    expect(dominantSvgColor(most)).toBe('#e0245e')
    const tie = '<svg><path fill="#7a8a99"/><path fill="#0a84ff"/></svg>'
    expect(dominantSvgColor(tie)).toBe('#0a84ff')
  })

  it('leaves a colour that is already readable exactly as the logo painted it', () => {
    expect(dominantSvgColor('<svg><path fill="#2970FF"/></svg>')).toBe('#2970ff')
    expect(dominantSvgColor('<svg><path fill="#12b886"/></svg>')).toBe('#12b886')
  })

  it('lifts a too-dark accent to stay visible as a 6px dot, keeping its hue', () => {
    const navy = dominantSvgColor('<svg><path fill="#001133"/></svg>')
    expect(navy).not.toBeNull()
    const lifted = rgbToHsl(parseCssColor(navy!)!)
    expect(lifted.l).toBeGreaterThanOrEqual(0.29)
    // Same hue as the source, not a different colour.
    expect(Math.abs(lifted.h - rgbToHsl({ r: 0, g: 0x11, b: 0x33 }).h)).toBeLessThan(0.02)
  })
})

describe('dominantPixelColor', () => {
  it('picks the colour most of the icon is painted in', () => {
    expect(dominantPixelColor(pixels(['#2970ff', 20], ['#e0245e', 5]))).toBe('#2970ff')
  })

  it('skips transparent padding — a favicon is mostly nothing', () => {
    const transparent = Uint8ClampedArray.from([0, 0, 0, 0, 255, 255, 255, 0])
    const mark = pixels(['#2970ff', 3])
    const buf = Uint8ClampedArray.from([...transparent, ...mark])
    expect(dominantPixelColor(buf)).toBe('#2970ff')
  })

  it('ignores a white/grey background', () => {
    expect(dominantPixelColor(pixels(['#ffffff', 100], ['#767676', 40], ['#0a84ff', 6]))).toBe(
      '#0a84ff'
    )
  })

  it('groups near-identical pixels (anti-aliasing) instead of splintering them', () => {
    // Nine shades one step apart plus a flat competitor with fewer pixels: the shades belong to
    // one mark and must out-vote it together.
    const shades = pixels(
      ['#2970ff', 3],
      ['#2a71ff', 3],
      ['#2b72ff', 3],
      ['#e0245e', 7]
    )
    expect(dominantPixelColor(shades)?.startsWith('#2')).toBe(true)
  })

  it('answers null for an icon with no colour of its own', () => {
    expect(dominantPixelColor(pixels(['#ffffff', 40], ['#101010', 40]))).toBeNull()
    expect(dominantPixelColor(new Uint8ClampedArray())).toBeNull()
  })
})

describe('toHex', () => {
  it('clamps and pads', () => {
    expect(toHex({ r: 0, g: 5, b: 300 })).toBe('#0005ff')
  })
})
