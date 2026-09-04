import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DERIVED_ICON_MAX_BYTES } from '../shared/project-icon-derive'
import { deriveLocalIdentity, localDeriveReader } from './project-icon-derive'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const dirs: string[] = []

async function tree(files: Record<string, string | Buffer>): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nt-derive-'))
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

describe('deriveLocalIdentity', () => {
  it('reads the folder’s icon and name', async () => {
    const root = await tree({
      '.idea/icon.svg': '<svg viewBox="0 0 1 1"></svg>',
      '.idea/.name': 'Node Terminal\n'
    })
    expect(await deriveLocalIdentity(root)).toEqual({
      icon: { kind: 'svg', svg: '<svg viewBox="0 0 1 1"></svg>', from: '.idea/icon.svg' },
      name: 'Node Terminal'
    })
  })

  it('answers the empty identity for a folder that declares nothing', async () => {
    expect(await deriveLocalIdentity(await tree({ 'README.md': 'hi' }))).toEqual({
      icon: null,
      name: null
    })
  })

  it('answers NULL for a folder it could not read — never "this project has no icon"', async () => {
    const root = await tree({})
    await fsp.rm(root, { recursive: true, force: true })
    expect(await deriveLocalIdentity(root)).toBeNull()
    expect(await deriveLocalIdentity('')).toEqual({ icon: null, name: null })
  })
})

describe('localDeriveReader', () => {
  it('refuses a path that escapes the project, before reading it', async () => {
    const root = await tree({ 'favicon.png': PNG })
    const outside = path.join(root, '..', `nt-outside-${process.pid}.png`)
    await fsp.writeFile(outside, PNG)
    try {
      const reader = localDeriveReader(root)
      expect(await reader.exists(['../' + path.basename(outside)])).toEqual([])
      expect(await reader.read('../' + path.basename(outside), 1024)).toBeNull()
    } finally {
      await fsp.rm(outside, { force: true })
    }
  })

  it('refuses a symlink that leaves the project, even with an innocent name', async () => {
    const root = await tree({ 'keep.txt': 'x' })
    const secret = path.join(root, '..', `nt-secret-${process.pid}.png`)
    await fsp.writeFile(secret, PNG)
    try {
      await fsp.symlink(secret, path.join(root, 'favicon.png'))
    } catch {
      return // no symlink permission (Windows without developer mode): nothing to assert
    }
    try {
      const reader = localDeriveReader(root)
      expect(await reader.exists(['favicon.png'])).toEqual([])
      expect(await reader.read('favicon.png', 1024)).toBeNull()
      expect(await deriveLocalIdentity(root)).toEqual({ icon: null, name: null })
    } finally {
      await fsp.rm(secret, { force: true })
    }
  })

  it('follows a symlink that stays inside the project', async () => {
    const root = await tree({ 'assets/real.png': PNG })
    try {
      await fsp.symlink(path.join(root, 'assets/real.png'), path.join(root, 'favicon.png'))
    } catch {
      return
    }
    expect((await deriveLocalIdentity(root))?.icon?.from).toBe('favicon.png')
  })

  it('answers null for a file over the cap rather than a truncated head', async () => {
    const root = await tree({ 'favicon.png': Buffer.concat([PNG, Buffer.alloc(64)]) })
    const reader = localDeriveReader(root)
    expect(await reader.read('favicon.png', 8)).toBeNull()
    expect(await reader.read('favicon.png', DERIVED_ICON_MAX_BYTES)).not.toBeNull()
  })

  it('does not report a directory as a file', async () => {
    const root = await tree({ 'favicon.png/inner.txt': 'x' })
    expect(await localDeriveReader(root).exists(['favicon.png'])).toEqual([])
  })
})
