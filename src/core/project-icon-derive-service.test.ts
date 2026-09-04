import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProjectIconDeriver } from './project-icon-derive-service'
import type { RemoteRun } from './project-icon-derive-remote'

const dirs: string[] = []

async function folder(files: Record<string, string>): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nt-derive-svc-'))
  dirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content)
  }
  return root
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('createProjectIconDeriver', () => {
  it('separates "nothing to read" from "could not look"', async () => {
    // A project this machine cannot place: an answer the caller must not keep.
    const unknown = createProjectIconDeriver({ target: () => null })
    expect(await unknown.derive('nope')).toEqual({ icon: null, name: null, unresolved: true })
    // An empty id is not a project at all — nothing to retry later.
    expect(await unknown.derive('')).toEqual({ icon: null, name: null })
    // A cwd-less (inline) project: a real, final "this project has no folder".
    const inline = createProjectIconDeriver({ target: () => ({}) })
    expect(await inline.derive('p1')).toEqual({ icon: null, name: null })
  })

  it('does not cache an unknown project — both shells register before the index is loaded', async () => {
    const root = await folder({ '.idea/.name': 'Loaded' })
    let known = false
    const deriver = createProjectIconDeriver({ target: () => (known ? { cwd: root } : null) })

    expect(await deriver.derive('p1')).toEqual({ icon: null, name: null, unresolved: true })
    known = true
    expect((await deriver.derive('p1')).name).toBe('Loaded')
  })

  it('DOES cache a project that genuinely has no folder', async () => {
    const target = vi.fn(() => ({}))
    const deriver = createProjectIconDeriver({ target })
    await deriver.derive('p1')
    await deriver.derive('p1')
    expect(target).toHaveBeenCalledTimes(1)
  })

  it('caches a resolved answer and re-reads on refresh', async () => {
    const root = await folder({ '.idea/.name': 'First' })
    const deriver = createProjectIconDeriver({ target: () => ({ cwd: root }) })

    expect((await deriver.derive('p1')).name).toBe('First')
    await fsp.writeFile(path.join(root, '.idea/.name'), 'Second')
    expect((await deriver.derive('p1')).name).toBe('First')
    expect((await deriver.derive('p1', { refresh: true })).name).toBe('Second')
  })

  it('lets the cache lapse after the TTL', async () => {
    const root = await folder({ '.idea/.name': 'First' })
    let clock = 1_000
    const deriver = createProjectIconDeriver({
      target: () => ({ cwd: root }),
      ttlMs: 100,
      now: () => clock
    })
    expect((await deriver.derive('p1')).name).toBe('First')
    await fsp.writeFile(path.join(root, '.idea/.name'), 'Second')
    clock += 101
    expect((await deriver.derive('p1')).name).toBe('Second')
  })

  it('coalesces concurrent asks into one read', async () => {
    const root = await folder({ '.idea/.name': 'One' })
    const target = vi.fn(() => ({ cwd: root }))
    const deriver = createProjectIconDeriver({ target })
    const [a, b, c] = await Promise.all([
      deriver.derive('p1'),
      deriver.derive('p1'),
      deriver.derive('p1')
    ])
    expect([a.name, b.name, c.name]).toEqual(['One', 'One', 'One'])
    expect(target).toHaveBeenCalledTimes(1)
  })

  it('does NOT cache a failed look, so the next ask tries again', async () => {
    const root = await folder({ '.idea/.name': 'Later' })
    let cwd = path.join(root, 'not-yet')
    const deriver = createProjectIconDeriver({ target: () => ({ cwd }) })

    expect(await deriver.derive('p1')).toEqual({ icon: null, name: null, unresolved: true })
    cwd = root
    expect((await deriver.derive('p1')).name).toBe('Later')
  })

  it('routes an SSH project to the remote runner, and answers empty without one', async () => {
    const run: RemoteRun = vi.fn(async () => ({ code: 255, stdout: '' }))
    const withLeg = createProjectIconDeriver({
      target: () => ({ remoteCwd: '/srv/app' }),
      remoteRun: () => run
    })
    // A dead master is "could not look", so the icon still appears once it comes up.
    expect(await withLeg.derive('p1')).toEqual({ icon: null, name: null, unresolved: true })
    expect(run).toHaveBeenCalled()

    // No SSH leg on this shell (Server Edition): same answer, and nothing cached.
    const withoutLeg = createProjectIconDeriver({ target: () => ({ remoteCwd: '/srv/app' }) })
    expect(await withoutLeg.derive('p1')).toEqual({ icon: null, name: null, unresolved: true })
  })

  it('forgets one project or all of them', async () => {
    const root = await folder({ '.idea/.name': 'First' })
    const deriver = createProjectIconDeriver({ target: () => ({ cwd: root }) })
    expect((await deriver.derive('p1')).name).toBe('First')
    await fsp.writeFile(path.join(root, '.idea/.name'), 'Second')
    deriver.forget('p1')
    expect((await deriver.derive('p1')).name).toBe('Second')
  })
})
