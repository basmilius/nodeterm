import type { DerivedProjectIcon } from '@shared/project-icon-derive'
import type { Project } from '@shared/types'
import { svgIconToDataUrl } from './svgIcon'

/**
 * How a project's own choices and what its folder declares are combined. Pure, so the rule lives in
 * one testable place instead of in six render sites.
 *
 * The rule in one line: **the user's pick always wins, and a derived value is never persisted.**
 * A derived icon fills in only where `Project.icon` is absent, and a derived name only while the
 * project still carries the name it was created with — see `effectiveProjectName`.
 */

/** A derived icon reduced to what a render site needs: a `src` for an `<img>` and the relative
 *  path it came from (shown in the picker, so the user can see why their project wears this). */
export interface RenderableDerivedIcon {
  src: string
  from: string
}

/** Prepare a derived icon for painting: raster arrives ready, SVG is sanitized here (see
 *  `svgIconToDataUrl` — that boundary is the reason core hands SVG on as text). Null when the
 *  file could not be turned into something safe, which simply leaves the fallback in charge. */
export function renderableDerivedIcon(
  icon: DerivedProjectIcon | null | undefined
): RenderableDerivedIcon | null {
  if (!icon) return null
  if (icon.kind === 'raster') return { src: icon.dataUrl, from: icon.from }
  const src = svgIconToDataUrl(icon.svg)
  return src ? { src, from: icon.from } : null
}

/** The last segment of a path, for either separator and with trailing separators ignored. Not
 *  `path.basename`: the renderer has no node builtins, and an SSH project's path is POSIX
 *  regardless of what this machine runs. */
export function pathBasename(p: string): string {
  const segments = p.split(/[/\\]+/).filter(Boolean)
  return segments.length ? segments[segments.length - 1] : ''
}

/** The folder a project's files live in — local `cwd` or an SSH project's `remoteCwd` — or ''
 *  for a cwd-less (inline) project. */
export function projectFolderPath(project: Pick<Project, 'cwd' | 'ssh'>): string {
  return project.ssh?.remoteCwd ?? project.cwd ?? ''
}

/**
 * The colour to show. A project is handed a palette colour at creation, before anything is known
 * about what it looks like — so when its folder declares an icon, the icon's own dominant colour
 * is the better accent (a blue logo beside a red dot is what this fixes). A colour someone
 * actually chose (`colorPicked`) always wins, exactly like a chosen name and a chosen icon do.
 *
 * Display-only, like the rest of the derived identity: nothing here writes `Project.color`.
 */
export function effectiveProjectColor(
  project: Pick<Project, 'color' | 'colorPicked'>,
  derivedColor: string | null | undefined
): string {
  return project.colorPicked === true ? project.color : (derivedColor ?? project.color)
}

/**
 * The name to show. A derived `.idea/.name` applies only while the project still wears the folder
 * basename it was created with: the moment the user renames the project, that IS their answer to
 * "what is this called", and a file in the repo must not talk over it.
 *
 * Deliberately display-only — nothing here writes `Project.name`. A derived name that were
 * persisted would travel into `.nodeterm/project.json` and from there to everyone who clones the
 * repo, turning a local display convenience into a shared edit nobody asked for.
 */
export function effectiveProjectName(
  project: Pick<Project, 'name' | 'cwd' | 'ssh'>,
  derivedName: string | null | undefined
): string {
  if (!derivedName) return project.name
  const folder = projectFolderPath(project)
  if (!folder) return project.name
  return project.name === pathBasename(folder) ? derivedName : project.name
}
