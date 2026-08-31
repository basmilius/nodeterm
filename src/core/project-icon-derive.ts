// The LOCAL leg of the well-known project identity (@shared/project-icon-derive): a `DeriveReader`
// over this machine's filesystem. The algorithm itself lives in shared and is not repeated here —
// this file only answers "does that relative path exist inside the folder" and "give me its first
// N bytes", so the local and SSH legs cannot drift apart in what they LOOK for.
//
// Two boundaries live here, both because the folder can arrive by `git clone`:
//  - every path is re-jailed against the project root AFTER symlink resolution, so a repository
//    that ships `favicon.png -> ~/.ssh/id_rsa` reads as a missing candidate rather than a read
//    outside the project (the magic-byte check would reject the bytes anyway; this refuses the
//    read itself, which is the boundary that should hold);
//  - a file larger than the caller's cap answers `null`, never a truncated head: half a PNG is
//    not a PNG, and the caller's contract is "skip this candidate, try the next".

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  deriveProjectIdentity,
  isJailedRelativePath,
  NO_DERIVED_IDENTITY,
  type DeriveReader,
  type DerivedProjectIdentity
} from '../shared/project-icon-derive'

/** The absolute, symlink-resolved path of `rel` inside `root`, or null when it escapes / is gone. */
async function resolveInside(root: string, rel: string): Promise<string | null> {
  if (!isJailedRelativePath(rel)) return null
  try {
    const rootReal = await fsp.realpath(root)
    const target = await fsp.realpath(path.resolve(rootReal, rel))
    return target === rootReal || target.startsWith(rootReal + path.sep) ? target : null
  } catch {
    return null
  }
}

/** A `DeriveReader` over a local project folder. Every method answers rather than throws. */
export function localDeriveReader(root: string): DeriveReader {
  return {
    async exists(paths) {
      const found = await Promise.all(
        paths.map(async (rel) => {
          const abs = await resolveInside(root, rel)
          if (!abs) return null
          try {
            return (await fsp.stat(abs)).isFile() ? rel : null
          } catch {
            return null
          }
        })
      )
      return found.filter((rel): rel is string => rel !== null)
    },
    async read(rel, maxBytes) {
      const abs = await resolveInside(root, rel)
      if (!abs) return null
      try {
        const stats = await fsp.stat(abs)
        if (!stats.isFile() || stats.size > maxBytes) return null
        const buf = await fsp.readFile(abs)
        // Re-check: the file may have grown between the stat and the read.
        return buf.length > maxBytes ? null : new Uint8Array(buf)
      } catch {
        return null
      }
    }
  }
}

/**
 * What the folder at `root` declares about itself, or **null** when the folder itself could not be
 * read (deleted, unmounted, permission). Never throws. The null is not pedantry: the caller caches
 * an answer for the app run, and "the drive was not mounted yet" must not be remembered as "this
 * project has no icon" — the same reason the SSH leg distinguishes a dead master from an empty
 * folder.
 */
export async function deriveLocalIdentity(root: string): Promise<DerivedProjectIdentity | null> {
  if (!root) return NO_DERIVED_IDENTITY
  try {
    if (!(await fsp.stat(root)).isDirectory()) return null
    return await deriveProjectIdentity(localDeriveReader(root))
  } catch {
    return null
  }
}
