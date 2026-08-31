import { describe, expect, it } from 'vitest'
import {
  DERIVED_ICON_MAX_BYTES,
  deriveProjectIdentity,
  hrefCandidates,
  ICON_SOURCE_FILES,
  iconFromBytes,
  iconHrefFromSource,
  iconMimeFromBytes,
  isJailedRelativePath,
  parseDerivedName,
  WELL_KNOWN_ICON_CANDIDATES,
  type DeriveReader
} from './project-icon-derive'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const GIF = new Uint8Array([...Buffer.from('GIF89a'), 1, 2])
const ICO = new Uint8Array([0x00, 0x00, 0x01, 0x00, 1, 0])
const CURSOR = new Uint8Array([0x00, 0x00, 0x02, 0x00, 1, 0])
const SVG = new Uint8Array(Buffer.from('<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"></svg>'))

/** A reader over an in-memory `{ path: bytes }` host tree, recording what it was asked. */
function fakeReader(tree: Record<string, Uint8Array | string>): DeriveReader & {
  existsCalls: number
  reads: string[]
} {
  const bytes = (v: Uint8Array | string): Uint8Array =>
    typeof v === 'string' ? new Uint8Array(Buffer.from(v)) : v
  const reader = {
    existsCalls: 0,
    reads: [] as string[],
    async exists(paths: readonly string[]) {
      reader.existsCalls++
      return paths.filter((p) => p in tree)
    },
    async read(p: string, maxBytes: number) {
      reader.reads.push(p)
      const v = tree[p]
      if (v === undefined) return null
      const b = bytes(v)
      return b.length > maxBytes ? null : b
    }
  }
  return reader
}

describe('iconMimeFromBytes', () => {
  it('reads the type from the bytes, not the extension', () => {
    expect(iconMimeFromBytes(PNG)).toBe('image/png')
    expect(iconMimeFromBytes(GIF)).toBe('image/gif')
    expect(iconMimeFromBytes(ICO)).toBe('image/x-icon')
    expect(iconMimeFromBytes(SVG)).toBe('image/svg+xml')
    expect(iconMimeFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
  })

  it('refuses a cursor, which shares the ICO container but is not an icon', () => {
    expect(iconMimeFromBytes(CURSOR)).toBeNull()
  })

  it('refuses text that merely lives at favicon.ico', () => {
    expect(iconMimeFromBytes(new Uint8Array(Buffer.from('# placeholder\n')))).toBeNull()
  })

  it('accepts an SVG behind a doctype/BOM, and refuses HTML that only mentions svg', () => {
    const withBom = new Uint8Array(Buffer.from('\uFEFF<!DOCTYPE svg>\n<svg></svg>'))
    expect(iconMimeFromBytes(withBom)).toBe('image/svg+xml')
    expect(iconMimeFromBytes(new Uint8Array(Buffer.from('<html><p>svg</p></html>')))).toBeNull()
  })
})

describe('iconFromBytes', () => {
  it('hands SVG on as text and raster as a data URL', () => {
    expect(iconFromBytes(SVG, 'a.svg')).toEqual({
      kind: 'svg',
      svg: expect.stringContaining('<svg'),
      from: 'a.svg'
    })
    const raster = iconFromBytes(PNG, 'a.png')
    expect(raster).toMatchObject({ kind: 'raster', from: 'a.png' })
    expect(raster && 'dataUrl' in raster && raster.dataUrl.startsWith('data:image/png;base64,')).toBe(
      true
    )
  })

  it('refuses an empty or oversized file', () => {
    expect(iconFromBytes(new Uint8Array(), 'a.png')).toBeNull()
    const huge = new Uint8Array(DERIVED_ICON_MAX_BYTES + 1)
    huge.set(PNG.subarray(0, 8))
    expect(iconFromBytes(huge, 'a.png')).toBeNull()
  })
})

describe('isJailedRelativePath', () => {
  it('accepts ordinary project-relative paths', () => {
    expect(isJailedRelativePath('.idea/icon.svg')).toBe(true)
    expect(isJailedRelativePath('public/favicon.png')).toBe(true)
  })

  it('refuses traversal, absolute, UNC, drive-letter and NUL paths', () => {
    for (const bad of [
      '../../.ssh/id_rsa',
      'public/../../secret',
      '/etc/passwd',
      '\\\\host\\share\\x.png',
      'C:/Windows/x.png',
      'a\0b',
      '',
      '.'
    ]) {
      expect(isJailedRelativePath(bad), bad).toBe(false)
    }
  })

  it('refuses a Windows-style traversal too — both separators are checked', () => {
    expect(isJailedRelativePath('public\\..\\..\\secret')).toBe(false)
  })
})

describe('iconHrefFromSource', () => {
  it('reads a <link rel="icon"> in either attribute order', () => {
    expect(iconHrefFromSource('<link rel="icon" href="/favicon.png">')).toBe('/favicon.png')
    expect(iconHrefFromSource('<link href="/x.svg" rel="shortcut icon" />')).toBe('/x.svg')
  })

  it('reads route metadata, skipping a run that declares rel without href', () => {
    const source = `
      links: () => [
        { rel: 'stylesheet', href: '/app.css' },
        { rel: 'icon' },
        { rel: 'icon', href: '/brand/icon.svg' }
      ]`
    expect(iconHrefFromSource(source)).toBe('/brand/icon.svg')
  })

  it('answers null when nothing declares an icon', () => {
    expect(iconHrefFromSource('<link rel="stylesheet" href="/app.css">')).toBeNull()
  })
})

describe('hrefCandidates', () => {
  it('tries the public/ mount first, then the literal path', () => {
    expect(hrefCandidates('/favicon.png')).toEqual(['public/favicon.png', 'favicon.png'])
  })

  it('refuses anything that is not a project-relative file', () => {
    expect(hrefCandidates('https://cdn.example.com/icon.png')).toEqual([])
    expect(hrefCandidates('//cdn.example.com/icon.png')).toEqual([])
    expect(hrefCandidates('data:image/png;base64,AAAA')).toEqual([])
    expect(hrefCandidates('../../../.ssh/id_rsa')).toEqual([])
  })
})

describe('parseDerivedName', () => {
  it('takes the first usable line, stripped and capped', () => {
    expect(parseDerivedName('  My Project \n ignored\n')).toBe('My Project')
    expect(parseDerivedName('\n\n\tSecond line wins\n')).toBe('Second line wins')
    expect(parseDerivedName(`x${'y'.repeat(200)}`)).toHaveLength(64)
  })

  it('answers null for a blank or control-only file, so the folder name stays in charge', () => {
    expect(parseDerivedName('')).toBeNull()
    expect(parseDerivedName('\n \n')).toBeNull()
    expect(parseDerivedName('\u0000\u0007')).toBeNull()
  })
})

describe('deriveProjectIdentity', () => {
  it('asks for every candidate in ONE exists batch (the SSH round-trip budget)', async () => {
    const reader = fakeReader({})
    await deriveProjectIdentity(reader)
    expect(reader.existsCalls).toBe(1)
    expect(reader.reads).toEqual([])
  })

  it('prefers the project-icon conventions over a favicon', async () => {
    const identity = await deriveProjectIdentity(
      fakeReader({ 'favicon.png': PNG, '.idea/icon.svg': SVG, '.nodeterm/icon.png': PNG })
    )
    expect(identity.icon?.from).toBe('.nodeterm/icon.png')

    const withoutOwn = await deriveProjectIdentity(
      fakeReader({ 'favicon.png': PNG, '.idea/icon.svg': SVG })
    )
    expect(withoutOwn.icon?.from).toBe('.idea/icon.svg')
  })

  it('skips a candidate whose bytes are not an image and takes the next one', async () => {
    const identity = await deriveProjectIdentity(
      fakeReader({ '.idea/icon.svg': 'not markup at all', 'favicon.png': PNG })
    )
    expect(identity.icon?.from).toBe('favicon.png')
  })

  it('skips an oversized candidate rather than failing the derive', async () => {
    const huge = new Uint8Array(DERIVED_ICON_MAX_BYTES + 10)
    huge.set(PNG.subarray(0, 8))
    const identity = await deriveProjectIdentity(
      fakeReader({ '.idea/icon.png': huge, 'favicon.png': PNG })
    )
    expect(identity.icon?.from).toBe('favicon.png')
  })

  it('falls back to a declared <link rel="icon"> only when no well-known file matched', async () => {
    const identity = await deriveProjectIdentity(
      fakeReader({
        'index.html': '<link rel="icon" href="/brand/mark.png">',
        'public/brand/mark.png': PNG
      })
    )
    expect(identity.icon?.from).toBe('public/brand/mark.png')
  })

  it('never reads a source file while a well-known candidate is available', async () => {
    const reader = fakeReader({
      'favicon.png': PNG,
      'index.html': '<link rel="icon" href="/other.png">'
    })
    await deriveProjectIdentity(reader)
    expect(reader.reads).toEqual(['favicon.png'])
  })

  it('reads the name independently of the icon', async () => {
    const named = await deriveProjectIdentity(fakeReader({ '.idea/.name': 'nodeterm' }))
    expect(named).toEqual({ icon: null, name: 'nodeterm' })

    const both = await deriveProjectIdentity(
      fakeReader({ '.idea/.name': 'nodeterm', '.idea/icon.svg': SVG })
    )
    expect(both.name).toBe('nodeterm')
    expect(both.icon?.from).toBe('.idea/icon.svg')
  })

  it('refuses an href that points outside the project', async () => {
    const identity = await deriveProjectIdentity(
      fakeReader({
        'index.html': '<link rel="icon" href="../../../.ssh/id_rsa">',
        '../../../.ssh/id_rsa': PNG
      })
    )
    expect(identity.icon).toBeNull()
  })

  it('keeps the two path lists disjoint and jailed', () => {
    for (const p of [...WELL_KNOWN_ICON_CANDIDATES, ...ICON_SOURCE_FILES]) {
      expect(isJailedRelativePath(p), p).toBe(true)
    }
    const all = [...WELL_KNOWN_ICON_CANDIDATES, ...ICON_SOURCE_FILES]
    expect(new Set(all).size).toBe(all.length)
  })
})
