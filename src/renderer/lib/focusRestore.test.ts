import { describe, expect, it } from 'vitest'
import { nodeToRefocus, type FocusRestoreState } from './focusRestore'
import { XTERM_INPUT_CLASS } from './keyContext'

const el = (tagName: string, cls: string[] = [], contentEditable = false) => ({
  tagName,
  isContentEditable: contentEditable,
  classList: { contains: (name: string) => cls.includes(name) }
})

const state = (over: Partial<FocusRestoreState> = {}): FocusRestoreState => ({
  lastNodeId: 'term-1',
  activeElement: el('BODY'),
  openDialogs: 0,
  ...over
})

describe('nodeToRefocus', () => {
  it('restores the last focused terminal when nothing else owns the keyboard', () => {
    expect(nodeToRefocus(state())).toBe('term-1')
  })

  it('restores when focus sits on a non-typing element (a button, the canvas pane)', () => {
    expect(nodeToRefocus(state({ activeElement: el('BUTTON') }))).toBe('term-1')
  })

  it('refuses without a remembered terminal', () => {
    expect(nodeToRefocus(state({ lastNodeId: null }))).toBeNull()
  })

  it('refuses while a modal is open', () => {
    expect(nodeToRefocus(state({ openDialogs: 1 }))).toBeNull()
  })

  it('refuses when a terminal already has focus', () => {
    const term = el('TEXTAREA', [XTERM_INPUT_CLASS])
    expect(nodeToRefocus(state({ activeElement: term }))).toBeNull()
  })

  it('refuses when a text field or editor has focus', () => {
    expect(nodeToRefocus(state({ activeElement: el('INPUT') }))).toBeNull()
    expect(nodeToRefocus(state({ activeElement: el('TEXTAREA') }))).toBeNull()
    expect(nodeToRefocus(state({ activeElement: el('DIV', [], true) }))).toBeNull()
  })

  it('restores when nothing at all is focused', () => {
    expect(nodeToRefocus(state({ activeElement: null }))).toBe('term-1')
  })
})
