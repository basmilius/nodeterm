import DOMPurify from 'dompurify'
import { bytesToBase64 } from '@shared/project-icon-derive'

/**
 * Turn a repository's `.idea/icon.svg` (or any derived SVG) into something safe to paint.
 *
 * The persisted `ProjectIcon` union refuses `image/svg+xml` outright — it is stored in a git-shared
 * file and re-rendered on every load, so the cheapest correct answer there is "no SVG". A DERIVED
 * icon cannot take that shortcut: the file we are asked to show IS an SVG, and it comes out of a
 * repository that may have been cloned from anywhere. Two independent guards, deliberately:
 *
 *  1. **DOMPurify's svg profile** (a real parser, not a regex) strips `<script>`, event handlers
 *     and anything outside the SVG/filter vocabulary. `ALLOWED_URI_REGEXP` is narrowed to
 *     document-local refs (`#gradient`, which real icons use) and embedded raster data: URLs
 *     (self-contained), so no attribute survives that names a network location.
 *  2. **The `<img>` element** the result is painted in. An SVG loaded as an image runs no script
 *     and fetches no subresource, whatever survived step 1.
 *
 * Neither guard is load-bearing alone, and that is the point. Returns null when nothing usable is
 * left — a sanitizer that empties the document must not yield a blank icon that hides the
 * monogram fallback.
 */

/**
 * DOMPurify's own `ALLOWED_URI_REGEXP`, minus every network scheme and plus embedded raster.
 *
 * That option is not "which attributes are URIs" — DOMPurify runs EVERY attribute value that is
 * not on its URI-safe list through this, so the two permissive alternatives below (`[^a-z]` for a
 * value that does not start with a letter, and a letter run that is not followed by `:`) are what
 * keep ordinary SVG attributes alive: `width="16"`, `viewBox="0 0 16 16"`, `fill="url(#g)"`,
 * `href="#gradient"`. Narrowing this to "a fragment or a data: image" — the obvious-looking
 * spelling — silently stripped all of those and left an empty `<rect>` behind.
 *
 * What is deliberately NOT here: `https:`, `http:`, `mailto:` and the rest of DOMPurify's default
 * scheme list. An icon must not name a network location — a repository could otherwise beacon
 * every viewer of its own canvas tab.
 */
const SAFE_ICON_URI = /^(?:data:image\/(?:png|jpe?g|gif|webp);base64,|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i

export function svgIconToDataUrl(svg: string): string | null {
  if (typeof svg !== 'string' || !svg.includes('<svg')) return null
  let clean: string
  try {
    clean = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      ALLOWED_URI_REGEXP: SAFE_ICON_URI,
      // `<foreignObject>` re-opens the HTML vocabulary inside SVG; nothing an icon needs.
      FORBID_TAGS: ['script', 'foreignObject'],
      FORBID_ATTR: ['onload', 'onerror']
    })
  } catch {
    return null
  }
  const trimmed = clean.trim()
  if (!trimmed.startsWith('<svg')) return null
  const bytes = new TextEncoder().encode(trimmed)
  return `data:image/svg+xml;base64,${bytesToBase64(bytes)}`
}
