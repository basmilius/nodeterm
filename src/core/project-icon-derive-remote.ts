// The SSH leg of the well-known project identity: an SSH project's folder lives on the HOST, so
// the reads must happen there. Core owns the generated `sh` AND its parsing; the shell owns the
// ControlMaster — the same division of labour as remote-claude-usage.ts and session-memory-remote.ts,
// and the reason `project-icon-derive-remote.test.ts` runs these scripts under a real `/bin/sh`
// against a fake host tree instead of asserting on the strings.
//
// Round-trip budget: the shared algorithm asks `exists` ONCE for every path it could need, so a
// normal derive is 1 exec + 1 read for the icon (+1 for `.idea/.name`). That is why `exists` takes
// the whole list — a per-path implementation would be ~30 logins on someone else's machine. The
// whole feature is on demand (never polled), which is what makes even that acceptable.

import {
  isJailedRelativePath,
  type DeriveReader,
  type DerivedProjectIdentity,
  deriveProjectIdentity,
  NO_DERIVED_IDENTITY
} from '../shared/project-icon-derive'
import { posixQuote } from '../shared/ssh'

/** Opens the file-list section; a line is `##F <relative path>`. */
const FOUND = '##F'
/** Printed unconditionally at the end of both scripts: its ABSENCE means the stream was cut short
 *  (dead master, killed mid-read), which is NOT the same fact as "the host has none of these". */
const END = '##END'
/** The folder itself could not be entered. */
const ERR = '##ERR'
/** The requested file is not there — an ANSWER, distinct from `##ERR`. */
const NONE = '##NONE'
/** Opens the base64 payload of a read. */
const B64 = '##B64'

/** Runs one generated `sh` line on the host. `code` is the ssh exit status; a non-zero one means
 *  the transport failed, which is never read as "the host has no icon". */
export type RemoteRun = (script: string) => Promise<{ code: number; stdout: string }>

/**
 * `cd` into the project folder or print `##ERR` and stop. `exit 0` on that branch is deliberate:
 * the transport succeeded, so the FAILURE we want to report is the missing marker, not an ssh
 * exit code the caller would have to disambiguate from a network error.
 */
function preamble(root: string): string {
  return `cd ${posixQuote(root)} 2>/dev/null || { printf '%s\\n' ${posixQuote(ERR)}; exit 0; }; `
}

/** One `sh` line that reports which of `paths` exist as regular files inside `root`. */
export function remoteExistsScript(root: string, paths: readonly string[]): string {
  const list = paths.filter(isJailedRelativePath).map(posixQuote).join(' ')
  // The markers are QUOTED: an unquoted word-initial `#` starts a comment in POSIX sh, so
  // `printf ##F` would print nothing and every host would look empty. Same trap as
  // session-memory-remote.ts's `echo ##MEM`.
  return (
    preamble(root) +
    (list ? `for f in ${list}; do [ -f "$f" ] && printf '%s %s\\n' ${posixQuote(FOUND)} "$f"; done; ` : '') +
    `printf '%s\\n' ${posixQuote(END)}`
  )
}

/** The paths `remoteExistsScript` reported, or null when the stream was cut short / the folder
 *  could not be entered. Null is "we could not look", never "there is nothing". */
export function parseRemoteExists(stdout: string, requested: readonly string[]): string[] | null {
  if (!stdout.includes(END)) return null
  const wanted = new Set(requested)
  const found: string[] = []
  for (const line of stdout.split('\n')) {
    if (!line.startsWith(`${FOUND} `)) continue
    const rel = line.slice(FOUND.length + 1).trimEnd()
    // Only ever believe a path we asked about: the reply is host-controlled text.
    if (wanted.has(rel)) found.push(rel)
  }
  return found
}

/**
 * One `sh` line that base64s at most `maxBytes` of `rel`. It asks for maxBytes + 1 on purpose, so
 * an oversized file comes back one byte over the cap and the parser can answer `null` — "skip this
 * candidate" — instead of handing on a truncated image.
 *
 * `base64` is coreutils on Linux and BSD-derived on macOS; both accept stdin and differ only in
 * line wrapping, which `tr -d` flattens. `openssl` is the fallback for the busybox-shaped host
 * that has neither.
 */
export function remoteReadScript(root: string, rel: string, maxBytes: number): string | null {
  if (!isJailedRelativePath(rel) || !Number.isInteger(maxBytes) || maxBytes <= 0) return null
  const quoted = posixQuote(rel)
  return (
    preamble(root) +
    `[ -f ${quoted} ] || { printf '%s\\n' ${posixQuote(NONE)}; exit 0; }; ` +
    // Unquoted on purpose: the fallback must word-split into three argv entries.
    `b=base64; command -v base64 >/dev/null 2>&1 || b='openssl enc -base64'; ` +
    `printf '%s\\n' ${posixQuote(B64)}; ` +
    `head -c ${maxBytes + 1} ${quoted} | $b | tr -d '\\n'; ` +
    `printf '\\n%s\\n' ${posixQuote(END)}`
  )
}

/** The bytes `remoteReadScript` returned, or null for every other outcome: missing file, folder
 *  gone, cut-short stream, undecodable payload, or a file over the cap. */
export function parseRemoteRead(stdout: string, maxBytes: number): Uint8Array | null {
  if (!stdout.includes(END)) return null
  const start = stdout.indexOf(B64)
  if (start === -1) return null
  const payload = stdout
    .slice(start + B64.length, stdout.lastIndexOf(END))
    .replace(/[^A-Za-z0-9+/=]/g, '')
  if (!payload) return null
  let bytes: Buffer
  try {
    bytes = Buffer.from(payload, 'base64')
  } catch {
    return null
  }
  // The script asked for one byte over the cap, so this length means the host's file is larger.
  if (bytes.length === 0 || bytes.length > maxBytes) return null
  return new Uint8Array(bytes)
}

/**
 * A `DeriveReader` over an SSH project's folder. Unlike the local leg this does NOT resolve
 * symlinks before reading: that would cost another round trip per candidate, and what it would
 * refuse is a host file the user is already logged in to — while the path jail (no `..`, no
 * absolute paths) and the magic-byte check still stand.
 */
export function remoteDeriveReader(
  run: RemoteRun,
  remoteCwd: string
): { reader: DeriveReader; transportFailed: () => boolean } {
  // A dead master and an empty folder both produce "no candidates", but they are different facts:
  // one is cacheable for the app run, the other must be retried on the next ask. The reader still
  // ANSWERS (the algorithm is not the place to handle transport), and records that it could not
  // look — see `deriveRemoteIdentity`'s null.
  let failed = false
  return {
    transportFailed: () => failed,
    reader: {
      async exists(paths) {
        try {
          const { code, stdout } = await run(remoteExistsScript(remoteCwd, paths))
          const found = code === 0 ? parseRemoteExists(stdout, paths) : null
          if (found === null) failed = true
          return found ?? []
        } catch {
          failed = true
          return []
        }
      },
      async read(rel, maxBytes) {
        const script = remoteReadScript(remoteCwd, rel, maxBytes)
        if (!script) return null
        try {
          const { code, stdout } = await run(script)
          if (code !== 0) {
            failed = true
            return null
          }
          // A clean `##NONE`/oversize answer is not a transport failure — only a missing END is.
          if (!stdout.includes(END)) failed = true
          return parseRemoteRead(stdout, maxBytes)
        } catch {
          failed = true
          return null
        }
      }
    }
  }
}

/** What the folder at `remoteCwd` on the project's host declares about itself, or **null** when we
 *  could not look at all (master down, host unreachable, folder gone). Never throws; null is what
 *  keeps a transient failure out of the service's cache. */
export async function deriveRemoteIdentity(
  run: RemoteRun,
  remoteCwd: string
): Promise<DerivedProjectIdentity | null> {
  if (!remoteCwd) return NO_DERIVED_IDENTITY
  const { reader, transportFailed } = remoteDeriveReader(run, remoteCwd)
  try {
    const identity = await deriveProjectIdentity(reader)
    return transportFailed() && !identity.icon && !identity.name ? null : identity
  } catch {
    return null
  }
}
