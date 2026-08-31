import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The canvas lock's `resize` aspect works by hiding the resize handles, and it can only do that
 * for a node that goes through `CanvasNodeResizer`. A node importing `NodeResizer` straight from
 * @xyflow/react stays resizable while the user has resizing locked — and nothing else in the
 * toolchain notices, because the bare import is perfectly valid code.
 */
const NODES_DIR = __dirname

describe('node resizers go through the lock wrapper', () => {
  const files = readdirSync(NODES_DIR).filter(
    (f) => f.endsWith('.tsx') && !f.includes('.test.') && f !== 'CanvasNodeResizer.tsx'
  )

  it('finds the node components to check', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it.each(files)('%s does not import NodeResizer directly', (file) => {
    const src = readFileSync(join(NODES_DIR, file), 'utf8')
    const xyflowImports = src.match(/import \{[^}]*\} from '@xyflow\/react'/gs) ?? []
    for (const imp of xyflowImports) expect(imp).not.toMatch(/\bNodeResizer\b/)
  })
})
