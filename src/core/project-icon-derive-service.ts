// The service both shells register for the well-known project identity (@shared/project-icon-derive):
// one IPC channel, a per-project cache, and the local/SSH split. Registered by `src/main`
// (with the SSH leg wired to the project's ControlMaster) and by `src/server` (without it — the
// Server Edition has no SSH projects, so those answer the empty identity, exactly like the
// context-link deps it mirrors).
//
// The read is ON DEMAND and never polled: the renderer asks once per project per app run, plus
// when the icon picker opens or the user hits refresh. That budget is what makes the SSH leg's
// couple of `ssh` execs acceptable — see project-icon-derive-remote.ts.

import { IPC } from '../shared/ipc'
import { platform } from './platform'
import {
  NO_DERIVED_IDENTITY,
  type DerivedProjectIdentity
} from '../shared/project-icon-derive'
import { deriveLocalIdentity } from './project-icon-derive'
import { deriveRemoteIdentity, type RemoteRun } from './project-icon-derive-remote'

/** How long a resolved identity is served from memory. Long enough that switching tabs costs
 *  nothing, short enough that adding `.idea/icon.svg` to a repo shows up without a restart. */
export const DERIVE_TTL_MS = 5 * 60_000

export interface ProjectIconDeriveDeps {
  /** Where a project's files are: a local `cwd`, or an SSH project's `remoteCwd`. `{}` for a
   *  cwd-less (inline) project — a real, cacheable "nothing to read". NULL for a project this
   *  machine cannot place at all, which answers `unresolved` and is never cached. */
  target(projectId: string): { cwd?: string; remoteCwd?: string } | null
  /**
   * The SSH leg: a runner for one generated `sh` line on that project's host, or null when the
   * project has no live master. ABSENT ⇒ SSH projects answer the empty identity (Server Edition).
   */
  remoteRun?(projectId: string): RemoteRun | null
  ttlMs?: number
  now?(): number
}

type Entry = { at: number; value: DerivedProjectIdentity }

export function createProjectIconDeriver(deps: ProjectIconDeriveDeps): {
  derive(projectId: string, opts?: { refresh?: boolean }): Promise<DerivedProjectIdentity>
  forget(projectId?: string): void
} {
  const ttl = deps.ttlMs ?? DERIVE_TTL_MS
  const now = deps.now ?? Date.now
  const cache = new Map<string, Entry>()
  const inFlight = new Map<string, Promise<DerivedProjectIdentity>>()

  const resolve = async (projectId: string): Promise<DerivedProjectIdentity | null> => {
    const target = deps.target(projectId)
    // No target is "we could not look", NOT "this project has no folder": both shells register
    // this before `workspaceStore.load()`, so an early ask hits an index that is not there yet.
    // Caching that answer would leave the project iconless for the rest of the TTL. A project that
    // genuinely has no folder answers `{}` below and IS cached.
    if (!target) return null
    if (target.remoteCwd) {
      const run = deps.remoteRun?.(projectId)
      // No SSH leg on this shell, or no live master: "we could not look", so nothing is cached
      // and the next ask (typically once the project connects) tries again.
      return run ? await deriveRemoteIdentity(run, target.remoteCwd) : null
    }
    return target.cwd ? await deriveLocalIdentity(target.cwd) : NO_DERIVED_IDENTITY
  }

  return {
    async derive(projectId, opts) {
      if (typeof projectId !== 'string' || !projectId) return NO_DERIVED_IDENTITY
      const cached = cache.get(projectId)
      if (!opts?.refresh && cached && now() - cached.at < ttl) return cached.value
      const running = inFlight.get(projectId)
      if (running && !opts?.refresh) return running
      const task = (async () => {
        const value = await resolve(projectId)
        // A null resolve is "we could not look": say so on the wire (`unresolved`) and do NOT
        // remember it, so a disconnected SSH project picks its icon up the moment the master is
        // back instead of being remembered as iconless for the rest of the TTL.
        if (value) cache.set(projectId, { at: now(), value })
        return value ?? { ...NO_DERIVED_IDENTITY, unresolved: true }
      })().finally(() => {
        if (inFlight.get(projectId) === task) inFlight.delete(projectId)
      })
      inFlight.set(projectId, task)
      return task
    },
    forget(projectId) {
      if (projectId === undefined) cache.clear()
      else cache.delete(projectId)
    }
  }
}

/** Register the `workspace:derive-identity` channel on the global core platform. Returns the
 *  deriver so a shell can drop a project's cached answer when its folder changes hands. */
export function registerProjectIconDeriveIpc(
  deps: ProjectIconDeriveDeps
): ReturnType<typeof createProjectIconDeriver> {
  const deriver = createProjectIconDeriver(deps)
  platform().handle(
    IPC.workspaceDeriveIdentity,
    async (projectId: string, opts?: { refresh?: boolean }) => {
      try {
        return await deriver.derive(projectId, opts)
      } catch {
        return { ...NO_DERIVED_IDENTITY, unresolved: true }
      }
    }
  )
  return deriver
}
