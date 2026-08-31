/**
 * The accent colour a project icon offers — so a project wearing its own logo stops being labelled
 * with an unrelated palette colour (a blue Flux mark beside a red dot, which is what prompted this).
 *
 * A project's `color` is assigned from the palette at creation, before anything is known about what
 * the project looks like. When its folder declares an icon we can do better: read the mark's own
 * dominant colour and use that instead — but only while the user has not chosen a colour
 * themselves (`Project.colorPicked`), the same "a deliberate choice always wins" rule the derived
 * icon and name follow.
 *
 * Both readers below are PURE and shared: the SVG one over markup, the raster one over pixels the
 * renderer sampled. Keeping the scoring in one place is the point — an SVG logo and its PNG
 * favicon are the same mark, and they must not resolve to different accents.
 *
 * Browser-safe (no node builtins): bundled into the renderer.
 */

/** A colour is only a candidate if it is actually a colour: greys, near-black and near-white carry
 *  no identity (every logo has white in it) and would make every project look the same. */
const MIN_SATURATION = 0.2
/** Low on purpose: a deep navy or bottle green IS a brand colour, and the saturation floor above
 *  is what actually rejects near-black. Anything that survives both is lifted to
 *  `ACCENT_MIN_LIGHTNESS` before it is returned, so "too dark to see" is handled by brightening
 *  the colour rather than by discarding it and falling back to an unrelated palette colour. */
const MIN_LIGHTNESS = 0.08
const MAX_LIGHTNESS = 0.85

/**
 * Floor for the returned colour's lightness. The accent is painted as a ~6px dot on a near-black
 * strip, where a deep navy or maroon reads as "off". Hue and saturation — what makes it that
 * brand's colour — are preserved; only the value is lifted.
 *
 * Deliberately LOW. The floor exists for colours that are genuinely invisible on black, not to
 * normalise everything into one brightness: at 0.4 a perfectly readable teal (#12b886, l = 0.396)
 * was already being nudged to a colour its own logo does not contain. Flux's #2970FF (0.58) and
 * anything like it pass through byte-exact.
 */
const ACCENT_MIN_LIGHTNESS = 0.3

export interface Rgb {
  r: number
  g: number
  b: number
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()`/`rgba()`. Anything else — `none`, `currentColor`,
 *  `url(#grad)`, a named colour, a gradient — is not a literal colour and answers null. */
export function parseCssColor(raw: string): Rgb | null {
  const value = raw.trim().toLowerCase()
  if (!value) return null
  const hex = /^#([0-9a-f]{3,8})$/.exec(value)
  if (hex) {
    const digits = hex[1]
    if (digits.length === 3 || digits.length === 4) {
      const [r, g, b] = [0, 1, 2].map((i) => parseInt(digits[i] + digits[i], 16))
      // A fully transparent shorthand colour paints nothing, so it is not this icon's colour.
      if (digits.length === 4 && parseInt(digits[3] + digits[3], 16) < 128) return null
      return { r, g, b }
    }
    if (digits.length === 6 || digits.length === 8) {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16))
      if (digits.length === 8 && parseInt(digits.slice(6, 8), 16) < 128) return null
      return { r, g, b }
    }
    return null
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value)
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const channel = (p: string): number =>
      p.endsWith('%') ? Math.round((parseFloat(p) / 100) * 255) : Math.round(parseFloat(p))
    const [r, g, b] = parts.slice(0, 3).map(channel)
    if ([r, g, b].some((c) => !Number.isFinite(c) || c < 0 || c > 255)) return null
    if (parts.length >= 4) {
      const alpha = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])
      if (Number.isFinite(alpha) && alpha < 0.5) return null
    }
    return { r, g, b }
  }
  return null
}

/** HSL of an RGB triple, each component 0..1. */
export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h =
    max === rn
      ? ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
      : max === gn
        ? ((bn - rn) / d + 2) / 6
        : ((rn - gn) / d + 4) / 6
  return { h, s, l }
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  if (s === 0) {
    const v = Math.round(l * 255)
    return { r: v, g: v, b: v }
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const channel = (t: number): number => {
    let v = t
    if (v < 0) v += 1
    if (v > 1) v -= 1
    if (v < 1 / 6) return p + (q - p) * 6 * v
    if (v < 1 / 2) return q
    if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6
    return p
  }
  return {
    r: Math.round(channel(h + 1 / 3) * 255),
    g: Math.round(channel(h) * 255),
    b: Math.round(channel(h - 1 / 3) * 255)
  }
}

export function toHex({ r, g, b }: Rgb): string {
  const part = (c: number): string =>
    Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** Whether a colour carries enough identity to stand for the icon (see the constants above). */
function isCandidate(rgb: Rgb): boolean {
  const { s, l } = rgbToHsl(rgb)
  return s >= MIN_SATURATION && l >= MIN_LIGHTNESS && l <= MAX_LIGHTNESS
}

/** Lift a too-dark accent to the readable floor, keeping its hue and saturation. */
function forAccent(rgb: Rgb): string {
  const { h, s, l } = rgbToHsl(rgb)
  return toHex(l < ACCENT_MIN_LIGHTNESS ? hslToRgb(h, s, ACCENT_MIN_LIGHTNESS) : rgb)
}

/**
 * The winner of a weighted vote: most painted wins, and saturation breaks a tie — between two
 * colours a logo uses equally, the more chromatic one is the one people would name.
 */
function pick(votes: Map<string, { rgb: Rgb; weight: number }>): string | null {
  let best: { rgb: Rgb; weight: number } | null = null
  for (const vote of votes.values()) {
    if (
      !best ||
      vote.weight > best.weight ||
      (vote.weight === best.weight && rgbToHsl(vote.rgb).s > rgbToHsl(best.rgb).s)
    ) {
      best = vote
    }
  }
  return best ? forAccent(best.rgb) : null
}

/** Colour-bearing SVG attributes, plus the same names inside a `style="…"`. `stop-color` is in
 *  here because a logo whose shape is filled with `url(#gradient)` keeps its actual colours in
 *  the gradient stops — the Flux mark is one. */
const SVG_COLOR_ATTRS = /(?:^|[\s;"'{])(fill|stroke|stop-color|flood-color)\s*[:=]\s*["']?([^"';)\s>]+)/gi

/**
 * The dominant colour of an SVG, read from its markup. Null when it declares no colour we would
 * show (a monochrome or `currentColor`-only mark) — which correctly leaves the palette colour in
 * charge rather than inventing an accent.
 */
export function dominantSvgColor(svg: string): string | null {
  if (typeof svg !== 'string' || !svg) return null
  const votes = new Map<string, { rgb: Rgb; weight: number }>()
  for (const match of svg.matchAll(SVG_COLOR_ATTRS)) {
    const rgb = parseCssColor(match[2])
    if (!rgb || !isCandidate(rgb)) continue
    const key = toHex(rgb)
    const seen = votes.get(key)
    if (seen) seen.weight += 1
    else votes.set(key, { rgb, weight: 1 })
  }
  return pick(votes)
}

/** How coarsely pixels are grouped before the vote: 5 bits per channel, so the anti-aliased edge
 *  of a shape counts towards the shape's own colour instead of splintering into hundreds of
 *  near-identical entries that each lose to a flat background. */
const PIXEL_BUCKET = 8

/**
 * The dominant colour of a decoded raster icon (RGBA, 4 bytes per pixel — what a canvas'
 * `getImageData` hands back). Transparent pixels are skipped entirely: a favicon is mostly
 * transparent padding, and counting it would make every icon's colour the same.
 */
export function dominantPixelColor(pixels: Uint8ClampedArray | Uint8Array): string | null {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const alpha = pixels[i + 3]
    if (alpha < 128) continue
    const rgb = { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }
    if (!isCandidate(rgb)) continue
    const key =
      (Math.floor(rgb.r / PIXEL_BUCKET) << 16) |
      (Math.floor(rgb.g / PIXEL_BUCKET) << 8) |
      Math.floor(rgb.b / PIXEL_BUCKET)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.r += rgb.r
      bucket.g += rgb.g
      bucket.b += rgb.b
      bucket.n += 1
    } else {
      buckets.set(key, { ...rgb, n: 1 })
    }
  }
  // Vote on the bucket AVERAGE, not on its quantized key: the answer should be a colour that is
  // actually in the icon, not the corner of the box it fell in.
  const votes = new Map<string, { rgb: Rgb; weight: number }>()
  for (const [key, b] of buckets) {
    const rgb = { r: b.r / b.n, g: b.g / b.n, b: b.b / b.n }
    votes.set(String(key), { rgb, weight: b.n })
  }
  return pick(votes)
}
