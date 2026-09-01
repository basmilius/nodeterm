// The shield only works if every surface that mounts a `<webview>` marks its container, and if the
// stylesheet still keys on the two names. Both halves are invisible when broken: a new browser-ish
// node whose author never read panShield.ts renders perfectly and simply eats the pan, and a
// renamed class leaves a rule that matches nothing. Neither the type checker nor a render test can
// see it, so it is enforced by scan.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import { PAN_SHIELD_CLASS, WEBVIEW_HOST_CLASS } from './panShield'

const RENDERER_ROOT = join(__dirname, '..')

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) {
      sources(p, out)
    } else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) {
      out.push(p)
    }
  }
  return out
}

describe('pan shield', () => {
  it('every surface that mounts a <webview> marks its container', () => {
    const unmarked = sources(RENDERER_ROOT)
      // Whitespace, not `>`: prose all over the renderer spells the element as `<webview>`, while
      // a real mount always opens onto its attributes.
      .filter((file) => /<webview\s/.test(readFileSync(file, 'utf8')))
      .filter((file) => !readFileSync(file, 'utf8').includes('WEBVIEW_HOST_CLASS'))
      .map((file) => relative(RENDERER_ROOT, file).replace(/\\/g, '/'))

    expect(unmarked).toEqual([])
  })

  it('finds both surfaces, so the scan above cannot pass by matching nothing', () => {
    const marked = sources(RENDERER_ROOT).filter((file) =>
      readFileSync(file, 'utf8').includes('WEBVIEW_HOST_CLASS')
    )

    expect(marked.length).toBe(2)
  })

  it('the stylesheet still keys on both class names', () => {
    const css = readFileSync(join(RENDERER_ROOT, 'styles.css'), 'utf8')

    expect(css).toContain(`.${PAN_SHIELD_CLASS} .${WEBVIEW_HOST_CLASS}`)
    expect(css).toMatch(/\.is-panning \.webview-host \{\s*pointer-events: none;/)
  })
})
