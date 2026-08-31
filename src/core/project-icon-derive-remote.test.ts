import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { WELL_KNOWN_ICON_CANDIDATES } from '../shared/project-icon-derive'
import {
  deriveRemoteIdentity,
  parseRemoteExists,
  parseRemoteRead,
  remoteExistsScript,
  remoteReadScript,
  type RemoteRun
} from './project-icon-derive-remote'

// The scripts are generated shell no compiler checks, so they are RUN — under a real /bin/sh
// against a real (temporary) directory standing in for the host tree. Same discipline as
// session-memory-remote.test.ts and remote-claude-usage.test.ts: asserting on the command string
// would have happily accepted `echo ##F` (which prints an empty line under POSIX sh).

const exec = promisify(execFile)
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const dirs: string[] = []

async function host(files: Record<string, string | Buffer>): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nt-derive-remote-'))
  dirs.push(root)
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content)
  }
  return root
}

/** Runs a generated line the way the ControlMaster would: `/bin/sh -c <script>` on this machine. */
const shell: RemoteRun = async (script) => {
  try {
    const { stdout } = await exec('/bin/sh', ['-c', script], { maxBuffer: 8 * 1024 * 1024 })
    return { code: 0, stdout }
  } catch (err) {
    const e = err as { code?: number; stdout?: string }
    return { code: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '' }
  }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fsp.rm(d, { recursive: true, force: true })))
})

describe('remoteExistsScript (real /bin/sh)', () => {
  it('reports exactly the candidates that are regular files', async () => {
    const root = await host({ '.idea/icon.svg': '<svg></svg>', 'README.md': 'x' })
    await fsp.mkdir(path.join(root, 'favicon.png')) // a DIRECTORY named like a candidate
    const asked = ['.idea/icon.svg', 'favicon.png', 'assets/logo.svg']
    const { stdout } = await shell(remoteExistsScript(root, asked))
    expect(parseRemoteExists(stdout, asked)).toEqual(['.idea/icon.svg'])
  })

  it('survives a folder name with spaces and quotes', async () => {
    const root = await host({ '.idea/icon.svg': '<svg></svg>' })
    const odd = path.join(path.dirname(root), `it's a project ${path.basename(root)}`)
    await fsp.rename(root, odd)
    dirs.push(odd)
    const { stdout } = await shell(remoteExistsScript(odd, ['.idea/icon.svg']))
    expect(parseRemoteExists(stdout, ['.idea/icon.svg'])).toEqual(['.idea/icon.svg'])
  })

  it('prints the END marker even when nothing matched — an empty answer is still an answer', async () => {
    const root = await host({})
    const { stdout } = await shell(remoteExistsScript(root, ['favicon.png']))
    expect(stdout).toContain('##END')
    expect(parseRemoteExists(stdout, ['favicon.png'])).toEqual([])
  })

  it('answers ##ERR (parsed as "could not look") for a folder that is gone', async () => {
    const root = await host({})
    await fsp.rm(root, { recursive: true, force: true })
    const { stdout } = await shell(remoteExistsScript(root, ['favicon.png']))
    expect(stdout.trim()).toBe('##ERR')
    expect(parseRemoteExists(stdout, ['favicon.png'])).toBeNull()
  })

  it('carries the whole candidate list in one invocation', async () => {
    const root = await host({ 'assets/logo.png': PNG })
    const asked = [...WELL_KNOWN_ICON_CANDIDATES]
    const { stdout } = await shell(remoteExistsScript(root, asked))
    expect(parseRemoteExists(stdout, asked)).toEqual(['assets/logo.png'])
  })

  it('never believes a path it did not ask about', () => {
    expect(parseRemoteExists('##F /etc/passwd\n##END\n', ['favicon.png'])).toEqual([])
  })
})

describe('remoteReadScript (real /bin/sh)', () => {
  it('round-trips a binary file byte for byte', async () => {
    const root = await host({ 'favicon.png': PNG })
    const script = remoteReadScript(root, 'favicon.png', 1024)!
    const { stdout } = await shell(script)
    expect(Buffer.from(parseRemoteRead(stdout, 1024)!)).toEqual(PNG)
  })

  it('answers null for a file over the cap instead of a truncated head', async () => {
    const root = await host({ 'favicon.png': Buffer.concat([PNG, Buffer.alloc(200)]) })
    const { stdout } = await shell(remoteReadScript(root, 'favicon.png', 16)!)
    expect(parseRemoteRead(stdout, 16)).toBeNull()
  })

  it('answers ##NONE for a missing file — an answer, not a failure', async () => {
    const root = await host({})
    const { stdout } = await shell(remoteReadScript(root, 'favicon.png', 1024)!)
    expect(stdout).toContain('##NONE')
    expect(parseRemoteRead(stdout, 1024)).toBeNull()
  })

  it('refuses to build a script for a path that escapes the project', () => {
    expect(remoteReadScript('/srv/app', '../../.ssh/id_rsa', 1024)).toBeNull()
    expect(remoteReadScript('/srv/app', '/etc/passwd', 1024)).toBeNull()
  })

  it('treats a cut-short stream as unreadable', () => {
    expect(parseRemoteRead('##B64\nAAAA', 1024)).toBeNull()
  })
})

describe('deriveRemoteIdentity (real /bin/sh)', () => {
  it('derives icon and name over the generated scripts', async () => {
    const root = await host({
      '.idea/icon.svg': '<svg viewBox="0 0 2 2"></svg>',
      '.idea/.name': 'Remote Project\n'
    })
    expect(await deriveRemoteIdentity(shell, root)).toEqual({
      icon: { kind: 'svg', svg: '<svg viewBox="0 0 2 2"></svg>', from: '.idea/icon.svg' },
      name: 'Remote Project'
    })
  })

  it('follows a declared <link rel="icon"> on the host', async () => {
    const root = await host({
      'index.html': '<html><link rel="icon" href="/brand/mark.png"></html>',
      'public/brand/mark.png': PNG
    })
    const identity = await deriveRemoteIdentity(shell, root)
    expect(identity?.icon).toMatchObject({ kind: 'raster', from: 'public/brand/mark.png' })
  })

  it('answers the empty identity for a host folder that declares nothing', async () => {
    expect(await deriveRemoteIdentity(shell, await host({ 'README.md': 'x' }))).toEqual({
      icon: null,
      name: null
    })
  })

  it('answers NULL when the master is dead — never "this project has no icon"', async () => {
    const dead: RemoteRun = async () => ({ code: 255, stdout: '' })
    expect(await deriveRemoteIdentity(dead, '/srv/app')).toBeNull()
  })

  it('answers NULL when the folder is gone on the host', async () => {
    const root = await host({})
    await fsp.rm(root, { recursive: true, force: true })
    expect(await deriveRemoteIdentity(shell, root)).toBeNull()
  })

  it('spends one exec on the batch and one per file it actually reads', async () => {
    const root = await host({ 'favicon.png': PNG, '.idea/.name': 'x' })
    const scripts: string[] = []
    const counting: RemoteRun = async (script) => {
      scripts.push(script)
      return shell(script)
    }
    await deriveRemoteIdentity(counting, root)
    expect(scripts).toHaveLength(3) // exists batch + .idea/.name + favicon.png
  })
})
