import { dominantPixelColor, dominantSvgColor } from '@shared/icon-color'
import type { DerivedProjectIcon } from '@shared/project-icon-derive'

/**
 * The accent colour a derived icon offers, resolved for whichever kind it is. The scoring lives in
 * @shared/icon-color (pure, tested); this file is only the part that cannot: turning a raster
 * data: URL into pixels needs a real decoder, i.e. the browser's.
 *
 * Deliberately best-effort at every step — a colour we could not read leaves the project's own
 * colour in charge, which is exactly the pre-feature behaviour.
 */

/** Sampling size. Small on purpose: this is a vote about the dominant colour, not a thumbnail, and
 *  the browser's own downscale averages neighbouring pixels for free. */
const SAMPLE_SIZE = 32

/** Never let a broken/huge image hold the icon's colour hostage — the glyph is already painted. */
const DECODE_TIMEOUT_MS = 3_000

function decodePixels(dataUrl: string): Promise<Uint8ClampedArray | null> {
  return new Promise((resolve) => {
    let done = false
    const finish = (value: Uint8ClampedArray | null): void => {
      if (done) return
      done = true
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), DECODE_TIMEOUT_MS)
    const img = new Image()
    img.onload = () => {
      clearTimeout(timer)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = SAMPLE_SIZE
        canvas.height = SAMPLE_SIZE
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) return finish(null)
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE)
        finish(ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data)
      } catch {
        // A tainted canvas cannot happen here (a data: URL is same-origin), but a getImageData
        // that throws for any other reason must not take the glyph down with it.
        finish(null)
      }
    }
    img.onerror = () => {
      clearTimeout(timer)
      finish(null)
    }
    img.src = dataUrl
  })
}

/** The icon's own dominant colour, or null when it offers none (monochrome mark, unreadable file). */
export async function derivedIconColor(icon: DerivedProjectIcon): Promise<string | null> {
  if (icon.kind === 'svg') return dominantSvgColor(icon.svg)
  const pixels = await decodePixels(icon.dataUrl)
  return pixels ? dominantPixelColor(pixels) : null
}
