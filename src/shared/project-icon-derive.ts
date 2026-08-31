/**
 * Well-known project identity: the icon (and name) a project folder ALREADY declares, used as the
 * fallback under `Project.icon` / `Project.name`. A user's own pick always wins — this only fills
 * the gap where a repository has said what it looks like and nobody has overridden it.
 *
 * The candidate list and the `<link rel="icon">` source scan follow t3code's ProjectFaviconResolver
 * (pingdotgg/t3code, apps/server/src/project/ProjectFaviconResolver.ts), extended with the two
 * IDE conventions and nodeterm's own `.nodeterm/` folder.
 *
 * A DERIVED icon is deliberately NOT a `ProjectIcon` (@shared/project-icon): that union is what
 * `.nodeterm/project.json` stores and `sanitizeProjectIcon` guards, and nothing here is ever
 * persisted — it is re-read from the folder on every app run. Keeping the two types apart is what
 * lets a derived icon carry an SVG (which the persisted union refuses) without widening the
 * stored-value rules by one byte.
 *
 * Everything a repository hands us is HOSTILE INPUT — the folder can arrive by `git clone`:
 *  - the MIME comes from MAGIC BYTES, never the extension, so a `.png` holding something else is
 *    rejected instead of announced as a PNG;
 *  - an SVG is handed on as TEXT and sanitized at the render boundary (renderer/lib/svgIcon.ts),
 *    never turned into a data: URL here;
 *  - every path — the fixed candidates and the hrefs read out of a source file alike — is checked
 *    by `isJailedRelativePath`, so a `<link rel="icon" href="../../../.ssh/id_rsa">` resolves to
 *    nothing rather than to a read outside the project;
 *  - reads are byte-capped, and an oversized candidate is SKIPPED (the next candidate still gets
 *    its turn) rather than failing the whole derive.
 *
 * Browser-safe: bundled into the renderer, so no node builtins.
 */

/** One derived icon: the bytes ready to render plus the relative path they came from (shown in the
 *  picker, so the user can see WHY their project wears this). Raster arrives as a finished data:
 *  URL; SVG arrives as raw text because only the renderer can sanitize it (DOMPurify needs a DOM). */
export type DerivedProjectIcon =
  | { kind: 'raster'; dataUrl: string; from: string }
  | { kind: 'svg'; svg: string; from: string }

/** What a folder declares about itself. Both halves are independently optional — a repo may carry
 *  an icon and no name, or the reverse. */
export interface DerivedProjectIdentity {
  icon: DerivedProjectIcon | null
  /** `.idea/.name`'s value, normalized. Display-only: it is never written to project.json. */
  name: string | null
  /**
   * Set when the folder could not be read AT ALL — an SSH project whose master is not up yet, an
   * unmounted directory, a project the workspace index has not loaded. It is not the same fact as
   * "this folder declares nothing", and the difference is load-bearing on both sides: the service
   * does not cache it, and the renderer does not treat it as this project's answer for the run.
   * Absent on every real answer, so an `{icon, name}` comparison keeps working.
   */
  unresolved?: true
}

/** The empty answer — also what every failure degrades to (a derive never throws). */
export const NO_DERIVED_IDENTITY: DerivedProjectIdentity = { icon: null, name: null }

/** Byte cap for one icon candidate. A bigger file is skipped, not shrunk: this value ends up in
 *  the DOM as a data: URL for the life of the app run, once per project, and re-encoding would
 *  need a native image decoder in a module that must also run in the browser. */
export const DERIVED_ICON_MAX_BYTES = 262_144 // 256 KB — same order as PROJECT_ICON_MAX_BYTES

/** Byte cap for a scanned source file (index.html, root.tsx, …). Only its head can hold the
 *  `<link rel="icon">` we are after, and these files can be large. */
export const DERIVED_SOURCE_MAX_BYTES = 131_072 // 128 KB

/** Byte cap for `.idea/.name` — a one-line file; anything larger is not one. */
export const DERIVED_NAME_MAX_BYTES = 4_096

/** Character cap for the derived name, so a pathological file cannot stretch a tab. */
export const DERIVED_NAME_MAX_LENGTH = 64

/**
 * Well-known icon paths, checked in this order.
 *
 * The first three groups are ours and the IDEs': a file at one of those paths is a deliberate
 * statement "this is the PROJECT's icon", which outranks a favicon (a statement about the site the
 * project happens to build). t3code orders `.idea/icon.svg` last; we deviate on purpose, and the
 * `.nodeterm/` pair leads for the same reason its `.t3` pair does — a project can be given an icon
 * without touching a path the repository already uses for something else.
 *
 * Everything from `favicon.svg` down is t3code's list, in t3code's order.
 */
export const WELL_KNOWN_ICON_CANDIDATES = [
  '.nodeterm/icon.svg',
  '.nodeterm/icon.png',
  '.idea/icon.svg',
  '.idea/icon.png',
  '.vscode/icon.svg',
  '.vscode/icon.png',
  'favicon.svg',
  'favicon.ico',
  'favicon.png',
  'public/favicon.svg',
  'public/favicon.ico',
  'public/favicon.png',
  'app/favicon.ico',
  'app/favicon.png',
  'app/icon.svg',
  'app/icon.png',
  'app/icon.ico',
  'src/favicon.ico',
  'src/favicon.svg',
  'src/app/favicon.ico',
  'src/app/icon.svg',
  'src/app/icon.png',
  'assets/icon.svg',
  'assets/icon.png',
  'assets/logo.svg',
  'assets/logo.png'
] as const

/** Files that may declare an icon in markup or route metadata (t3code's ICON_SOURCE_FILES). */
export const ICON_SOURCE_FILES = [
  'index.html',
  'public/index.html',
  'app/routes/__root.tsx',
  'src/routes/__root.tsx',
  'app/root.tsx',
  'src/root.tsx',
  'src/index.html'
] as const

/** JetBrains writes the project's display name here when it differs from the folder name. */
export const IDEA_NAME_FILE = '.idea/.name'

// Matches <link ...> tags or object-like icon metadata where rel/href can appear in any order.
// The tag pattern is anchored on `<link`, so it only starts at real candidates. Object metadata is
// matched by scanning brace-free runs instead of one combined pattern: an unanchored pattern
// restarts at every offset and rescans forward, which is quadratic on large sources. (t3code.)
const LINK_ICON_HTML_RE =
  /<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon)["'])(?=[^>]*\bhref=["']([^"'?]+))[^>]*>/i
const ICON_REL_RE = /\brel\s*:\s*["'](?:icon|shortcut icon)["']/i
const ICON_HREF_RE = /\bhref\s*:\s*["']([^"'?]+)/i

/** The first icon href declared in a markup/metadata source, or null. */
export function iconHrefFromSource(source: string): string | null {
  const htmlMatch = source.match(LINK_ICON_HTML_RE)
  if (htmlMatch?.[1]) return htmlMatch[1]
  // Icon metadata counts when `rel` and `href` share a brace-free run, so a run holding `rel` but
  // no href falls through to the next one rather than ending the search.
  for (const run of source.split('}')) {
    if (!ICON_REL_RE.test(run)) continue
    const hrefMatch = run.match(ICON_HREF_RE)
    if (hrefMatch?.[1]) return hrefMatch[1]
  }
  return null
}

/**
 * Project-relative paths a declared href may resolve to: a site-absolute `/favicon.png` is served
 * from `public/` in every framework in ICON_SOURCE_FILES, so that is tried first, then the literal
 * path (a relative href beside the source file, or a project that serves its root directly).
 * Returns `[]` for anything that is not a project-relative file path — an absolute URL, a
 * protocol-relative `//host/x`, a `data:`/`blob:` inline icon, or a traversal.
 */
export function hrefCandidates(href: string): string[] {
  const trimmed = href.trim()
  if (!trimmed || trimmed.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return []
  const clean = trimmed.replace(/^\/+/, '')
  const candidates = [`public/${clean}`, clean]
  return candidates.filter(isJailedRelativePath)
}

/**
 * Whether a path may be read as "inside the project": relative, no traversal, no drive letter, no
 * UNC, no NUL. Both separators are rejected on the way in — every path this module handles is one
 * we compose from POSIX segments, and a Windows-style `..\..` must not slip past a `/`-only check.
 */
export function isJailedRelativePath(p: string): boolean {
  if (!p || p.includes('\0')) return false
  if (p.startsWith('/') || p.startsWith('\\')) return false
  if (/^[a-z]:/i.test(p)) return false
  const segments = p.split(/[/\\]/)
  if (segments.some((s) => s === '..')) return false
  return segments.some((s) => s !== '' && s !== '.')
}

/** Image MIME types a derived icon may claim — closed set, decided by magic bytes below. Wider
 *  than the persisted `ProjectIcon`'s set by `image/x-icon` and `image/avif` (both render in an
 *  `<img>`, and both are ordinary favicon formats) plus SVG, which is sanitized before render. */
const MAGIC_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/x-icon',
  'image/avif',
  'image/svg+xml'
] as const

export type DerivedIconMime = (typeof MAGIC_MIME_TYPES)[number]

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false
  return sig.every((byte, index) => bytes[offset + index] === byte)
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = ''
  for (let i = start; i < end && i < bytes.length; i++) out += String.fromCharCode(bytes[i])
  return out
}

/**
 * The MIME of an image, read from its own bytes. Null for anything not in the closed set above —
 * which is the whole point: the candidate list is full of extensions (`.ico`, `.png`) that say
 * nothing about the content, and a repository that ships a text placeholder at `favicon.ico`
 * (common) must not have it announced to the DOM as an image.
 */
export function iconMimeFromBytes(bytes: Uint8Array): DerivedIconMime | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'image/webp'
  // ICO: a resource directory whose type field is 1 (icon). Type 2 is a CURSOR — same container,
  // not an icon, and no browser paints it as one.
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon'
  if (ascii(bytes, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(bytes, 8, 12))) {
    return 'image/avif'
  }
  return looksLikeSvg(bytes) ? 'image/svg+xml' : null
}

/** Whether the head of a file reads as SVG markup: the first tag in it is `<svg`, whatever XML
 *  declaration, comment, doctype or BOM precedes it. */
function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = decodeUtf8(bytes.subarray(0, 1024)).replace(/^\uFEFF/, '').trimStart()
  if (!head.startsWith('<')) return false
  return /<svg[\s>]/i.test(head)
}

/** UTF-8 decode that never throws (a lone surrogate or truncated sequence becomes U+FFFD). */
export function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/** Base64 of a byte array, without node's `Buffer` — this module is bundled into the renderer too.
 *  Chunked because `String.fromCharCode(...bytes)` blows the argument limit on a large icon. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Turn a candidate's bytes into a renderable icon, or null when they are not an image we accept
 * (unknown magic, empty file, oversized). Null means "try the next candidate", never "stop".
 */
export function iconFromBytes(bytes: Uint8Array, from: string): DerivedProjectIcon | null {
  if (bytes.length === 0 || bytes.length > DERIVED_ICON_MAX_BYTES) return null
  const mime = iconMimeFromBytes(bytes)
  if (!mime) return null
  if (mime === 'image/svg+xml') return { kind: 'svg', svg: decodeUtf8(bytes), from }
  return { kind: 'raster', dataUrl: `data:${mime};base64,${bytesToBase64(bytes)}`, from }
}

/**
 * Normalize `.idea/.name`: its first non-empty line, control characters removed, length-capped.
 * Null when nothing usable is left — a blank file must leave the folder basename in charge.
 */
export function parseDerivedName(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    // eslint-disable-next-line no-control-regex
    const cleaned = line.replace(/[\x00-\x1f\x7f]/g, '').trim()
    if (cleaned) return cleaned.slice(0, DERIVED_NAME_MAX_LENGTH)
  }
  return null
}

/**
 * The reader a derive runs against — one seam so the local (fs) and SSH (ControlMaster) legs share
 * this algorithm exactly, instead of two copies that drift.
 *
 * `exists` takes the whole candidate list at once because the remote implementation answers it in
 * ONE round trip; splitting it into per-path calls would make an SSH derive ~30 ssh execs.
 * Both methods answer, never throw: an unreadable path is indistinguishable from a missing one
 * here on purpose — either way the next candidate is what matters.
 */
export interface DeriveReader {
  /** Which of `paths` exist as regular files. Order/extra entries are ignored by the caller. */
  exists(paths: readonly string[]): Promise<readonly string[]>
  /** At most `maxBytes` of a file; null when unreadable. A file LARGER than the cap must answer
   *  null rather than a truncated head — a half-read PNG is not a PNG. */
  read(path: string, maxBytes: number): Promise<Uint8Array | null>
}

/**
 * Resolve what a project folder declares about itself. Order of business:
 *  1. one `exists` batch over every path this can possibly need;
 *  2. `.idea/.name` (independent of the icon — a repo may declare only one of the two);
 *  3. the well-known icon candidates, in list order, first one whose BYTES are an image;
 *  4. only if none matched: the source files' `<link rel="icon">`, whose href needs a second
 *     (small) `exists` batch because the path it names is not known in advance.
 */
export async function deriveProjectIdentity(
  reader: DeriveReader
): Promise<DerivedProjectIdentity> {
  const wanted = [...WELL_KNOWN_ICON_CANDIDATES, ...ICON_SOURCE_FILES, IDEA_NAME_FILE]
  const present = new Set(await reader.exists(wanted))

  let name: string | null = null
  if (present.has(IDEA_NAME_FILE)) {
    const bytes = await reader.read(IDEA_NAME_FILE, DERIVED_NAME_MAX_BYTES)
    if (bytes) name = parseDerivedName(decodeUtf8(bytes))
  }

  for (const candidate of WELL_KNOWN_ICON_CANDIDATES) {
    if (!present.has(candidate)) continue
    const bytes = await reader.read(candidate, DERIVED_ICON_MAX_BYTES)
    const icon = bytes ? iconFromBytes(bytes, candidate) : null
    if (icon) return { icon, name }
  }

  for (const source of ICON_SOURCE_FILES) {
    if (!present.has(source)) continue
    const bytes = await reader.read(source, DERIVED_SOURCE_MAX_BYTES)
    if (!bytes) continue
    const href = iconHrefFromSource(decodeUtf8(bytes))
    if (!href) continue
    const candidates = hrefCandidates(href)
    if (candidates.length === 0) continue
    const declared = new Set(await reader.exists(candidates))
    for (const candidate of candidates) {
      if (!declared.has(candidate)) continue
      const iconBytes = await reader.read(candidate, DERIVED_ICON_MAX_BYTES)
      const icon = iconBytes ? iconFromBytes(iconBytes, candidate) : null
      if (icon) return { icon, name }
    }
  }

  return { icon: null, name }
}
