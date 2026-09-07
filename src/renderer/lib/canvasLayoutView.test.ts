import { describe, expect, it } from 'vitest'
import type { CanvasLayout } from '@shared/canvas-layout'
import {
  layoutFramingViewport,
  layoutSubtitle,
  restoreSummary,
  saveLayoutRefusal,
  sortedLayouts
} from './canvasLayoutView'

const layout = (over: Partial<CanvasLayout> = {}): CanvasLayout => ({
  id: 'l1',
  name: 'Ultrawide',
  createdAt: 1,
  updatedAt: 1,
  nodes: [],
  ...over
})

describe('sortedLayouts', () => {
  it('orders by name, ignoring case', () => {
    const rows = sortedLayouts([layout({ id: 'a', name: 'zen' }), layout({ id: 'b', name: 'Ample' })])
    expect(rows.map((l) => l.id)).toEqual(['b', 'a'])
  })

  it('answers an empty list for a project that has none', () => {
    expect(sortedLayouts(undefined)).toEqual([])
  })

  it('never reorders the array it was handed', () => {
    const input = [layout({ id: 'a', name: 'zen' }), layout({ id: 'b', name: 'Ample' })]
    sortedLayouts(input)
    expect(input.map((l) => l.id)).toEqual(['a', 'b'])
  })
})

describe('layoutSubtitle', () => {
  it('names the window it was saved on beside the node count', () => {
    expect(
      layoutSubtitle(layout({ window: { width: 3440, height: 1440 } }))
    ).toBe('3440 x 1440 - 0 nodes')
  })

  it('drops the window clause rather than inventing a size', () => {
    expect(layoutSubtitle(layout({ nodes: [{ id: 'n', x: 0, y: 0, width: 1, height: 1 }] }))).toBe(
      '1 node'
    )
  })
})

describe('layoutFramingViewport', () => {
  it('parks the top-left rect just inside the corner at zoom 1', () => {
    expect(
      layoutFramingViewport([
        { id: 'a', x: 4000, y: 2000, width: 10, height: 10 },
        { id: 'b', x: 4200, y: 1900, width: 10, height: 10 }
      ])
    ).toEqual({ x: 80 - 4000, y: 80 - 1900, zoom: 1 })
  })

  it('anchors on a framed child too - layout rects are root-space', () => {
    // The core `framingViewport` skips a node with a parent because ITS position is
    // parent-relative. A layout of nothing but framed children would otherwise open on empty space.
    expect(
      layoutFramingViewport([{ id: 'a', x: 900, y: 700, width: 10, height: 10, parentId: 'g' }])
    ).toEqual({ x: 80 - 900, y: 80 - 700, zoom: 1 })
  })

  it('falls back to the origin for a layout that addresses nothing', () => {
    expect(layoutFramingViewport([])).toEqual({ x: 0, y: 0, zoom: 1 })
  })
})

describe('saveLayoutRefusal', () => {
  it('says nothing when the save landed', () => {
    expect(saveLayoutRefusal('saved')).toBeNull()
  })

  it('gives every refusal a sentence, including the unreachable ones', () => {
    for (const result of ['cap-reached', 'invalid-name', 'unknown-project'] as const) {
      expect(saveLayoutRefusal(result)).toBeTruthy()
    }
    expect(saveLayoutRefusal('cap-reached')).toContain('20')
  })
})

describe('restoreSummary', () => {
  it('reports only the counts that are not zero', () => {
    expect(restoreSummary('Ultrawide', { moved: 12, missing: 0, extra: 2 })).toBe(
      'Restored "Ultrawide": 12 nodes moved, 2 not in this layout.'
    )
  })

  it('speaks of one node in the singular', () => {
    expect(restoreSummary('Laptop', { moved: 1, missing: 0, extra: 0 })).toBe(
      'Restored "Laptop": 1 node moved.'
    )
  })

  it('says so when the restore changed nothing', () => {
    expect(restoreSummary('Laptop', { moved: 0, missing: 0, extra: 0 })).toBe(
      'Restored "Laptop": nothing changed.'
    )
  })
})
