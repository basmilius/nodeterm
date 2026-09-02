/**
 * Drop the separators a hidden or empty section leaves dangling: a menu's rules are written
 * between blocks, so a block that contributed nothing would otherwise emit two rules in a row, or
 * one hanging at the top or bottom. A separator directly under a section label goes too, which
 * reads as a double line.
 *
 * Cheap and total, so builders can stay plain array literals instead of tracking what is left.
 *
 * It lives in `@shared` because BOTH shells need the rule and neither may import the other: the
 * renderer's own menus (`ContextMenu`'s `MenuItem`) and the main process's native menus for
 * <webview> guests (Electron's `MenuItemConstructorOptions`). It was duplicated once, and the two
 * copies had already drifted apart on the label rule.
 *
 * Generic over the item shape rather than over a menu type: the two callers share nothing but a
 * `type` discriminator, and `label` simply never occurs in an Electron template, so that clause is
 * inert there rather than wrong.
 *
 * Pass the element type explicitly when the argument is a fresh array literal
 * (`tidySeparators<MenuItem>([...])`): inference otherwise falls back to the constraint and the
 * literal loses its contextual type. A caller that forgets fails to compile, never silently.
 */
export function tidySeparators<T extends { type?: string }>(items: readonly T[]): T[] {
  const out: T[] = []
  for (const item of items) {
    if (item.type === 'separator') {
      const prev = out[out.length - 1]
      if (!prev || prev.type === 'separator' || prev.type === 'label') {
        continue
      }
    }
    out.push(item)
  }
  while (out.length > 0 && out[out.length - 1]?.type === 'separator') {
    out.pop()
  }
  return out
}
