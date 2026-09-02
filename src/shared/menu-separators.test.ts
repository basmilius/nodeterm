import { describe, expect, it } from 'vitest'
import { tidySeparators } from './menu-separators'

const sep = { type: 'separator' as const }
const item = (label: string) => ({ type: 'item' as const, label })
const label = (text: string) => ({ type: 'label' as const, label: text })

describe('tidySeparators', () => {
  it('leaves a menu with no dangling rules alone', () => {
    const items = [item('a'), sep, item('b')]
    expect(tidySeparators(items)).toEqual(items)
  })

  it('drops a leading separator', () => {
    expect(tidySeparators([sep, item('a')])).toEqual([item('a')])
  })

  it('drops a trailing separator', () => {
    expect(tidySeparators([item('a'), sep])).toEqual([item('a')])
  })

  it('collapses a run of separators left by an empty section', () => {
    expect(tidySeparators([item('a'), sep, sep, sep, item('b')])).toEqual([item('a'), sep, item('b')])
  })

  it('drops a separator directly under a section label', () => {
    expect(tidySeparators([label('Group'), sep, item('a')])).toEqual([label('Group'), item('a')])
  })

  it('keeps a separator that precedes a label', () => {
    expect(tidySeparators([item('a'), sep, label('Group'), item('b')])).toEqual([
      item('a'),
      sep,
      label('Group'),
      item('b')
    ])
  })

  it('empties a menu that is nothing but rules', () => {
    expect(tidySeparators([sep, sep])).toEqual([])
  })

  it('returns an empty list untouched', () => {
    expect(tidySeparators([])).toEqual([])
  })

  it('does not mutate its input', () => {
    const items = [sep, item('a'), sep]
    tidySeparators(items)
    expect(items).toHaveLength(3)
  })

  it('passes through items whose type it does not know', () => {
    const colors = { type: 'colors' as const }
    expect(tidySeparators([colors, sep, item('a')])).toEqual([colors, sep, item('a')])
  })

  it('treats an item with no type as a real row, not a rule', () => {
    // The renderer's plain menu rows omit `type` entirely, so an absent one must never read as a
    // separator. Typed explicitly because a bare `{ label }` literal trips weak-type detection.
    const untyped: { type?: string; label: string } = { label: 'a' }
    expect(tidySeparators([untyped, sep, untyped])).toEqual([untyped, sep, untyped])
  })
})
