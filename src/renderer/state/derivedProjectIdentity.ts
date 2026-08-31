import { useEffect } from 'react'
import { create } from 'zustand'
import type { DerivedProjectIdentity } from '@shared/project-icon-derive'
import { renderableDerivedIcon, type RenderableDerivedIcon } from '@renderer/lib/projectIdentity'
import { derivedIconColor } from '@renderer/lib/iconColor'
import { useSshConn } from './sshConn'

/**
 * What each project's own folder declares about itself (`.idea/icon.svg`, a favicon, `.idea/.name`
 * — see @shared/project-icon-derive), held for the app run.
 *
 * TRANSIENT BY DESIGN: nothing here is persisted, not to localStorage and certainly not to
 * `.nodeterm/project.json`. A derived value is a re-read of the folder, so remembering it would
 * only create a second, staler source of truth — and writing it back would push one machine's
 * reading of a repository into everyone else's clone.
 *
 * The read is on demand: `ensure` fires ONCE per project per app run (an SSH project that had no
 * live master when we asked is retried, because "could not look" is not an answer), `refresh`
 * re-reads on request — the icon picker's Reset, so removing a custom icon immediately shows what
 * the folder offers instead. Never on a timer: an SSH derive is an `ssh` exec on someone else's
 * machine, the same budget rule remote usage and session memory follow.
 */

export interface DerivedIdentityEntry {
  /** Ready to paint, already sanitized (SVG included). Null = the folder declares no usable icon. */
  icon: RenderableDerivedIcon | null
  /** `.idea/.name`, or null. Applied by `effectiveProjectName`, never by this store. */
  name: string | null
  /**
   * The icon's own dominant colour (@shared/icon-color), applied by `effectiveProjectColor`.
   * Arrives AFTER `icon` for a raster icon — reading its pixels means decoding it in the browser —
   * so the glyph paints immediately and the accent catches up a frame later. Null when the icon
   * offers no colour (a monochrome mark) or could not be decoded.
   */
  color?: string | null
}

interface DerivedIdentityState {
  byId: Record<string, DerivedIdentityEntry>
  ensure(projectId: string): void
  refresh(projectId: string): Promise<void>
  /** Drop a project's answer (project deleted / folder re-picked), so the next ask re-reads. */
  forget(projectId: string): void
}

/** Projects whose derive has been asked for in this app run — including the ones still in flight,
 *  so a canvas with six glyph sites for one project still issues exactly one request. */
const asked = new Set<string>()

async function read(projectId: string, refresh: boolean): Promise<DerivedProjectIdentity | null> {
  const workspace = window.nodeTerminal?.workspace
  // An older preload (or a surface without the channel) simply has no derived icons — the
  // monogram fallback every site had before this feature is what remains.
  if (!workspace?.deriveIdentity) return null
  try {
    return await workspace.deriveIdentity(projectId, refresh ? { refresh: true } : undefined)
  } catch {
    return null
  }
}

export const useDerivedProjectIdentity = create<DerivedIdentityState>((set) => {
  const apply = (projectId: string, identity: DerivedProjectIdentity | null): void => {
    if (!identity || identity.unresolved) return
    const entry: DerivedIdentityEntry = {
      icon: renderableDerivedIcon(identity.icon),
      name: identity.name
    }
    // An empty answer is still an answer: store it, so the site renders its fallback without
    // waiting, and no further request is made for this project.
    set((s) => ({ byId: { ...s.byId, [projectId]: entry } }))
    if (!identity.icon || !entry.icon) return
    // Second pass, deliberately not awaited: the accent is a nicety and a raster icon has to be
    // decoded for it, while the glyph itself is already on screen. Written only if this project's
    // entry is still the one we computed for — a refresh in between owns the slot now.
    void derivedIconColor(identity.icon).then((color) => {
      if (!color) return
      set((s) => (s.byId[projectId] === entry ? { byId: { ...s.byId, [projectId]: { ...entry, color } } } : s))
    })
  }

  return {
    byId: {},
    ensure(projectId) {
      if (!projectId || asked.has(projectId)) return
      asked.add(projectId)
      void read(projectId, false).then((identity) => {
        // Null = the request itself failed (no channel, rejected call); `unresolved` = the host
        // could not read the folder (an SSH project whose master is not up yet). Neither is this
        // project's answer, so allow a retry — the hooks below re-fire when a project connects.
        if (!identity || identity.unresolved) asked.delete(projectId)
        apply(projectId, identity)
      })
    },
    async refresh(projectId) {
      if (!projectId) return
      asked.add(projectId)
      apply(projectId, await read(projectId, true))
    },
    forget(projectId) {
      asked.delete(projectId)
      set((s) => {
        if (!(projectId in s.byId)) return s
        const byId = { ...s.byId }
        delete byId[projectId]
        return { byId }
      })
    }
  }
})

const EMPTY: DerivedIdentityEntry = { icon: null, name: null }

/**
 * The derived identity of one project, requesting it once if nobody has yet. Every glyph/name site
 * calls this, so a surface the canvas is not mounted behind (the welcome screen, the settings
 * sidebar) fills in on its own.
 */
export function useProjectDerivedIdentity(projectId: string | undefined): DerivedIdentityEntry {
  const entry = useDerivedProjectIdentity((s) => (projectId ? s.byId[projectId] : undefined))
  const ensure = useDerivedProjectIdentity((s) => s.ensure)
  // An SSH project is opened BEFORE its ControlMaster is up, and a read with no master answers
  // `unresolved` (not "no icon"), which the store deliberately does not keep. Re-asking when the
  // connection lands is what makes the icon appear without a restart — the same on-connect trigger
  // remote usage and session memory use, and just as deliberately not a timer.
  const sshUp = useSshConn((s) => (projectId ? !!s.byProject[projectId] : false))
  useEffect(() => {
    if (projectId) ensure(projectId)
  }, [projectId, sshUp, ensure])
  return entry ?? EMPTY
}

/**
 * The same, for a surface that renders a LIST of projects (the tab strip, the sessions sidebar,
 * the settings sidebar). It returns the store's whole map rather than a per-id slice on purpose:
 * a selector that built a new object per render would re-render the list on every store touch,
 * and a hook per row is not available inside a `.map`.
 */
export function useProjectDerivedIdentities(
  projectIds: readonly string[]
): Record<string, DerivedIdentityEntry> {
  const byId = useDerivedProjectIdentity((s) => s.byId)
  const ensure = useDerivedProjectIdentity((s) => s.ensure)
  const key = projectIds.join(',')
  // Which of these are connected, as ONE primitive — see the single-project hook for why a
  // connection coming up must re-ask. A string keeps the effect dependency comparable by value.
  const connectedKey = useSshConn((s) => projectIds.filter((id) => !!s.byProject[id]).join(','))
  useEffect(() => {
    for (const id of key ? key.split(',') : []) ensure(id)
  }, [key, connectedKey, ensure])
  return byId
}

/** What a site should hand `ProjectGlyph`: the derived icon ONLY when the project has no icon of
 *  its own. One helper so no site has to remember the precedence itself. */
export function derivedGlyphFor(
  hasOwnIcon: boolean,
  entry: DerivedIdentityEntry | undefined
): DerivedIdentityEntry['icon'] {
  return hasOwnIcon ? null : (entry?.icon ?? null)
}
