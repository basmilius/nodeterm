# Project icons and names

A project on the canvas wears an icon and a name in five places: the tab strip, the sessions
sidebar (group header and each status row), the welcome screen's "Recently closed" list, the
settings sidebar, and the icon picker's own preview. This document is about where those two values
come from, because there are **two layers** and only one of them is stored.

## The two layers

| | Where it lives | Who writes it | Travels to a clone |
|---|---|---|---|
| **Chosen** | `Project.icon` / `Project.name` in `.nodeterm/project.json` | the user (icon picker, rename) | yes |
| **Derived** | nothing — re-read from the folder | nobody | no |

**The chosen value always wins.** The derived one fills the gap where a repository has already said
what it looks like and the user has not overridden it. That is the whole feature: a freshly cloned
repo with an `.idea/icon.svg` shows its own mark on the tab without anyone configuring anything.

Nothing derived is ever persisted — not to `project.json`, not to `localStorage`. It is a read of
the folder, cached in memory for the app run (`DERIVE_TTL_MS`, 5 minutes, on demand only). Writing
it back would turn one machine's reading of a repository into a shared edit that arrives in
everyone else's checkout.

## What is looked at, in order

`WELL_KNOWN_ICON_CANDIDATES` (`src/shared/project-icon-derive.ts`):

1. `.nodeterm/icon.svg`, `.nodeterm/icon.png` — ours, so a project can be given an icon without
   touching a path the repository already uses for something else.
2. `.idea/icon.svg`, `.idea/icon.png` — JetBrains' project icon.
3. `.vscode/icon.svg`, `.vscode/icon.png`.
4. The favicon list ported from [t3code]'s `ProjectFaviconResolver` — `favicon.*`, `public/favicon.*`,
   `app/icon.*`, `src/app/icon.*`, `assets/{icon,logo}.*` — in t3code's own order.

If none matched, `ICON_SOURCE_FILES` (`index.html`, `public/index.html`, `app/root.tsx`,
`src/root.tsx`, `app/routes/__root.tsx`, `src/routes/__root.tsx`, `src/index.html`) are scanned for
a `<link rel="icon" href>` or the equivalent route metadata, and the href is resolved as
`public/<href>` then `<href>`.

The groups deviate from t3code in one way and it is deliberate: t3code appends `.idea/icon.svg`
last, we put the explicit project-icon conventions **first**. A file at one of those paths says
"this is the PROJECT's icon"; a favicon says "this is the icon of the site this project builds".

The name comes from `.idea/.name` (first usable line, control characters stripped, capped at 64
characters).

## The colour comes from the icon too

A project's `color` is assigned from the palette at creation — before anything is known about what
the project looks like. So a repository with a blue logo could end up labelled with a red dot,
which is what prompted this half of the feature.

When a derived icon exists, `effectiveProjectColor` prefers **the icon's own dominant colour**:

- **SVG** — read from the markup: `fill`, `stroke`, `stop-color`, `flood-color`, as attributes or
  inside a `style="…"`. Gradient stops count, because a shape filled with `url(#g)` keeps its real
  colours there (the Flux mark is exactly that).
- **Raster** — the renderer draws the icon into a 32×32 canvas and samples the pixels. Only that
  step is renderer-only; the scoring is shared (`@shared/icon-color`), so an SVG logo and its PNG
  favicon cannot resolve to different accents.

Scoring rules: transparent pixels and greys / near-white / near-black are skipped (every logo has
those, and they identify nothing); the most-painted colour wins with saturation as the tiebreak;
near-identical pixels are bucketed so an anti-aliased edge votes with its own shape. A winner that
is too dark to read as a 6px dot on the near-black tab strip is **lifted** to a minimum lightness,
keeping hue and saturation — an invisible dot and no dot are both worse than a brightened one. A
mark with no colour of its own (monochrome, `currentColor`) answers null and the palette colour
stands.

**`Project.colorPicked` is the opt-out**, and unlike `viewport` or `breadcrumbs` it is
**git-shared**: `color` itself travels in `project.json`, so a colleague's deliberate pick has to
outrank the derived accent in every clone, not just on the machine where it was made. Absent means
"never chosen" — which is what every project written before the field looks like, and the safe
reading, since those colours were assigned rather than picked. `setProjectColor` sets it; the read
is strict `=== true`.

Where the derived colour shows: the tab accent dot, the sessions sidebar, session rows, the
welcome screen and the settings sidebar — the same places the derived icon and name reach. Note
that the icon picker's colour swatches still show and edit the **stored** colour, so a project
running on a derived accent shows no ringed swatch until one is clicked.

## The rules that keep it safe

The folder can arrive by `git clone`, so everything read out of it is hostile input.

- **The MIME comes from magic bytes, never the extension.** A text placeholder at `favicon.ico` is
  common, and an ICO whose type field is 2 is a *cursor*, which no browser paints as an icon.
- **Every path is jailed** (`isJailedRelativePath`: relative, no `..` on either separator, no drive
  letter, no UNC), and the local reader re-checks the resolved path after `realpath`, so a
  repository that ships `favicon.png -> ~/.ssh/id_rsa` reads as a missing candidate rather than a
  read outside the project.
- **A bad candidate is skipped, never fatal.** Wrong magic, unreadable, or over
  `DERIVED_ICON_MAX_BYTES` (256 KB) ⇒ try the next candidate. An oversized file is never truncated:
  half a PNG is not a PNG.
- **"Could not look" is not "there is nothing."** A dead ControlMaster, an unmounted folder or a
  failed request answers `null`, and null is **not cached** — so the icon appears the moment an SSH
  project's master comes up, instead of being remembered as "this project has no icon" for the run.

## SVG

`sanitizeProjectIcon` refuses `image/svg+xml` for a *stored* icon, and that stays true: it is a
git-shared value re-rendered on every load. A derived icon cannot take that shortcut — the file we
are asked to show IS an SVG — so it is a **separate type** (`DerivedProjectIcon`), which keeps the
stored-value rules untouched.

Core hands the SVG on as **text**. The renderer sanitizes it (`src/renderer/lib/svgIcon.ts`,
DOMPurify's svg + svgFilters profile) and paints the result inside an `<img>`. Two independent
guards: DOMPurify strips script/handlers/`foreignObject`, and an SVG loaded as an image runs no
script and fetches no subresource whatever survived.

**One trap, measured:** DOMPurify's `ALLOWED_URI_REGEXP` is not "which attributes are URIs" — every
attribute value that is not on its URI-safe list is run through it. Narrowing it to "a fragment or
a data: image" (the obvious spelling) strips `width="16"`, `viewBox`, `fill="url(#g)"` and leaves
an empty shape behind. Ours is DOMPurify's own default **minus the network schemes** plus embedded
raster, so an icon can still reference its own gradients but cannot name a network location (a
repository must not be able to beacon everyone who opens its tab).

## Where the work happens

| | |
|---|---|
| `src/shared/project-icon-derive.ts` | candidate lists, magic bytes, path jail, href scan, the algorithm over a `DeriveReader` |
| `src/core/project-icon-derive.ts` | the local `DeriveReader` (fs + realpath jail) |
| `src/core/project-icon-derive-remote.ts` | the SSH `DeriveReader`: generated `sh`, tested under a real `/bin/sh` |
| `src/core/project-icon-derive-service.ts` | the `workspace:derive-identity` channel, cache and local/SSH split — registered by BOTH shells |
| `src/renderer/state/derivedProjectIdentity.ts` | one request per project per app run; sanitizes on the way in |
| `src/renderer/lib/projectIdentity.ts` | `effectiveProjectName` and the render-ready icon |

The shared algorithm asks `exists` **once** for every path it could need, which is why the SSH leg
costs one `ssh` exec for the batch plus one per file actually read, rather than ~30 logins on
someone else's machine. Same budget rule as remote usage and session memory: on demand, never
polled.

## Surfaces

- **Desktop** — full, including SSH projects (read over that project's ControlMaster).
- **Server Edition** — the same core service runs, so a local project's folder icon shows in the
  browser. No SSH leg is injected, which is complete rather than a gap: that shell has no SSH
  projects.
- **Relay tabs** — the empty identity. The project belongs to the host machine and is not in this
  machine's workspace index; deriving locally would read the wrong disk.
- **Mobile companion** — N/A. There is no canvas or tab strip there; if a project list ever grows
  one, the icon would have to ride the transport protocol (follow-up in the iOS repo).

## Known gaps

- **No dark variant.** JetBrains supports `.idea/icon_dark.svg`; we read `icon.svg` only.
- **No file watching.** The derive runs once per project per app run (plus the picker's Reset,
  which forces a re-read). Dropping an `.idea/icon.svg` into a project while the app is open shows
  up after that Reset, the TTL, or a restart.
- **The picker does not show the derived colour.** Its swatches edit `Project.color`; a project
  currently wearing its icon's accent shows no selected swatch until the user picks one (which is
  also what makes the pick stick, via `colorPicked`).
- **The name is display-only.** `.idea/.name` is shown while the project still wears its folder
  basename; it never writes `Project.name`, and there is no UI saying where the shown name came
  from (the icon has one — the picker's "Detected from …" line).

[t3code]: https://github.com/pingdotgg/t3code
