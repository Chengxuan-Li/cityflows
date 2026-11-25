# TASK-341 — Visual quality panel: lighting, shadows, vegetation style and render quality

Status: proposed 2026-11-24, renumbered from TASK-340 on 2026-11-25 (main's TASK-340 is ring-free ground ordering) (owner: "arrange all the settings into a visual quality control panel ... build this as a
new task that will be merged into main"). Proposed owner: a Claude session (Opus 5.5) started from the lead chat.
Branch `task/341-visual-quality`, its own worktree, ports 5540 / 5640. Base: `origin/main` at `47ab2d1b` (the local
`main` is stale: start the worktree from `origin/main`).

## Why

The owner's intro video (`bench/intro`, cut-only, not on main) showed how much the 3D view gains from finer lighting,
shadows, vegetation and surfaces, at very different costs. The owner wants those choices in the product as one place
where a viewer picks the look and the cost, not as enforced changes. Each choice carries a shipping category:

1. **Shipped:** cheap, on for everyone; a control only where it is a matter of taste.
2. **Option:** a quality or style setting; presets move it.
3. **Experimental:** available, lowers the frame rate noticeably.
4. **Offline:** meant for rendering videos frame by frame (very slow, or adds invented content). Interactive use is
   possible but warned.

Three findings from the intro work shape this task:

- **Mutual shading has a short range.** `src/render3d/scene.ts` (about line 1424) fits the one 2048 px shadow map to
  0.9x the camera's distance around its target. Beyond that nothing shadows anything. The range and resolution become
  settings.
- **The sun is always Munich's.** `src/render/lighting.ts` computes Clock mode's sun at 48.14 N for three seasons,
  whatever city is open. The sun should come from the project's location, a real date and a real clock time.
- **Trees have two shapes and one palette.** `src/render3d/vegetation.ts` draws broadleaf or needleleaf with
  `style.vegetation.canopy`. The owner wants a choice of pre-built species mixes, varying by climate zone, and
  foliage colour styles.

## Goal

A **Visual quality** panel holding every view-quality and lighting setting, with presets, cost hints, and category
marking. This task builds the panel, its settings model and the phase 1 settings below end to end. Later phases
(listed at the end, not in scope) add their controls to the same panel when their features land; the panel shows only
controls that change something today.

### The panel

- Opens from the toolbar (or the View menu, if one exists) as a sheet or a left-sidebar section, whichever fits the
  window rules in AGENTS.md "Design direction". It replaces the lighting controls in Layers (`src/ui/lighting.tsx`);
  Layers keeps layer toggles only.
- **Presets** at the top: Low, Balanced (the default, equal to today's look), High, Ultra, Cinematic. Changing any
  control afterwards shows the preset as Custom. Cinematic turns on the category 4 settings and so carries the
  category 4 warning.
- **Sections** (disclosure sections from `controls.tsx`): Sun, sky and time; Light by source; Shadows; Vegetation;
  Render.
- **Cost hint** beside each control whose cost depends on its value: Low, Medium or High, as small secondary text, not
  a badge.
- **Category marking:** categories 1 and 2 look like any control. A category 3 value shows a one-line note under the
  control, "Experimental: lowers the frame rate", in a warning colour. A category 4 value shows "Offline rendering: very
  slow" (or "adds invented content", per setting) in a stronger warning colour, and asks for confirmation the first
  time it is chosen in a session. Add the two colours as tokens with light and dark values; `src/ui/contrast.test.ts`
  must pass in both appearances. No icons or badges beyond this.
- Settings are a per-viewer view preference in local storage, as lighting is today (`cityflows.lighting`). Migrate the
  stored lighting value; nothing is written to the project file. Malformed stored values fall back per field, like
  `parseLighting`.

### Phase 1 settings (this task)

| Section | Setting | Values | Default | Cat. |
|---|---|---|---|---|
| Sun, sky and time | Light | Day, Evening, Night (today's presets), Clock (follow the sim clock), Fixed date and time | Day | 1 |
| | Date | Any day of the year (replaces the three seasons; migrate them to 21 Jun, 21 Mar, 21 Dec) | 21 Mar | 1 |
| | Time | Clock time, for Fixed | 12:00 | 1 |
| | Location | The project's geo origin; latitude and longitude override | project | 1 |
| | Time zone | IANA zone (`Intl.supportedValuesOf('timeZone')`), with daylight saving through `Intl`; default from the project if it records one, else the zone whose standard offset is nearest to longitude / 15 | derived | 1 |
| | Exposure | 0.5 to 3 (today 0.5 to 1.5) | 1 | 1 |
| Light by source | Sun (or moon) | Intensity 0 to 2x, colour temperature | 1x, preset | 1 |
| | Sky fill (diffuse) | Intensity 0 to 2x | 1x | 1 |
| | Street lamps | Intensity; Auto (at dusk), Always, Off | 1x, Auto | 1 |
| | Lit windows | Share lit at night, brightness | preset | 1 |
| | Vehicle lights | Intensity | 1x | 1 |
| | Airfield lights | Intensity | 1x | 1 |
| | Rail and station lights, signals | Intensity | 1x | 1 |
| Shadows | Sun shadows | On, Off (moves here from the Layers "Shadows" toggle) | On | 1 |
| | Shading range | Near (today: 0.9x camera distance), Medium (2x), Far (4x), each fitted around the view target | Near | 2 |
| | Shadow resolution | 1024, 2048, 4096; 8192 | 2048 | 2; 8192 is 4 |
| | Softness | Hard, Soft (PCF soft) | Hard | 2 |
| | Shadow casters | Buildings, trees, vehicles, aircraft, people, street furniture (each on or off) | all on | 2 |
| Vegetation | Species mix | Auto (from the climate zone), Temperate broadleaf, Boreal conifer, Mediterranean, Tropical, Arid, Street trees, Custom (weights per kit) | Auto | 1 |
| | Foliage season | Auto (from date and hemisphere), Spring, Summer, Autumn, Winter (bare broadleaves) | Auto | 1 |
| | Foliage colour | Natural, Vivid, Muted, Map (today's flat palette) | Map | 1 |
| | Colour variation | 0 to 1 between trees | 0.3 | 1 |
| Render | Render scale | 1x, 1.5x; 2x | 1x (device ratio as today) | 1.5x is 3; 2x is 4 |
| | Aircraft drop lines | On, Off | On | 1 |

Notes on phase 1:

- **Sun position:** compute the solar elevation and azimuth from latitude, longitude, date and UTC time with a
  standard formula (NOAA solar position; implement it, no dependency) in `src/render/lighting.ts`. Day, Evening and
  Night stay the fixed presets they are. Clock and Fixed use the computed sun and blend the sky, ground and artificial
  light by elevation as Clock does now. Moonlight stays as today when the sun is below the horizon.
- **Climate zone:** derive it from the project's latitude, longitude and hemisphere with a small rule set (tropical,
  arid, Mediterranean, temperate, boreal), no dataset. Show the zone Auto picked as secondary text.
- **Tree kits:** a handful of pre-built crown and trunk variants in `src/render3d/vegetation.ts` (for example round
  broadleaf, spreading broadleaf, columnar broadleaf, cone conifer, palm), each with a leaf palette per season. A
  species mix is weights over kits; each tree picks a kit deterministically from its id or position, keeping mapped
  `leafType` (needleleaved trees take conifer kits). Keep the instanced drawing and the far blobs.
- **Light sources:** route through `SceneLight` and the existing lamp, window, vehicle-light, airfield-light and
  signal code; no new light objects per lamp.
- **Shadows:** keep the cached-shadow path (`cacheShadows` in `scene.ts`). Casters map onto `castShadow` per layer.

## In scope

- `src/render/lighting.ts` (settings model, parse and migrate, sun position, light by source),
  `src/ui/lighting-store.ts` (or a renamed visual-settings store), `src/ui/lighting.tsx` (replaced by the panel),
  `src/ui/layers.tsx` (lighting and shadow controls move out), the new panel component under `src/ui/`,
  `src/ui/app.css` (tokens), `src/ui/contrast.test.ts`.
- `src/render3d/scene.ts` (shadow range, resolution, softness, casters, render scale, light by source),
  `src/render3d/vegetation.ts` (kits, species mix, season, colour), and the 3D modules that own each light source
  (street lamps, windows, vehicle lights, airfield lights, signals) as far as their intensity needs.
- `src/render/style.ts` for the foliage palettes.
- Tests: the sun position against published values for at least three places and dates; settings parsing and the
  migration from `cityflows.lighting`; the climate-zone rules; one e2e spec under `tests/e2e/` that opens the panel,
  picks a preset, a category 4 value (and its confirmation), a fixed date and time, and checks the 3D canvas changes.

## Out of scope

- Everything that exists only in `bench/intro` today (see Later phases). It is uncommitted on
  `claude/intro-video-dlr-trains-ef70d8`; do not copy from it in this task.
- `src/schema` and `docs/architecture.md` (no project-file change: the settings are viewer preferences).
- The 2D renderer, except that Map lighting there keeps following the lighting mode as today.
- Changing today's default look: Balanced must render the same as main does now, apart from the sun now following
  the project's location under Clock.

## Gates

- Balanced on a fresh profile renders the 3D view the same as `origin/main` (Freiburg and Munich e2e screenshots or
  canvas hashes within the existing tolerance), except Clock lighting's sun position.
- Sun position within 0.5 degrees of NOAA reference values in the unit test.
- Interactive frame time at London City Airport and Munich, 3D, 1920x1080, reported for Low, Balanced, High and Ultra
  (not a gate; record it in the report and the panel's cost hints should agree with it).
- `npm run check`, `test:city`, `test:e2e:light`, and the new e2e spec.

## Later phases (not this task; each becomes its own task and adds its controls to the panel)

| Phase | Settings | Cat. |
|---|---|---|
| 2: shipped and options | Tone mapping (Neutral, Filmic); sky dome with clouds and stars; haze; reflective daytime glass; tower facades and curtain glazing; surface detail (procedural paving, roofs, walls, weathering); track detail (sleepers, ballast, third rail where electrified); airfield surfaces; inferred fences; contact shadows (ambient occlusion); glow around lights; smooth track curves and turnouts and connected fences (fixes, no control) | 1 and 2 |
| 3: experimental | Whole-view shading (cascaded shadow maps); water reflections; sharp distant windows; ground relief (bump); low vegetation (hedges, scrub, long grass); detailed trees (branches, leaf sprays) at High | 3 |
| 4: offline | Detailed trees at every distance; crown width art direction; synthetic trees and traffic; filled car parks; invented site detail; Cinematic render mode with 2x capture | 4 |

The source for phases 2 to 4 is `bench/intro` (atmosphere, surfaces, weathering, foliage, tracks, track-curves,
fences, airfield, ground-detail, undergrowth, low-plants, shore). It must be committed to a branch first; the owner
decides when.

## Report

Write it as the commit body and the PR description: what works, the settings shipped and their categories, frame
times per preset, what is unsupported, and the final lines of `npm run check`. Commit on `task/341-visual-quality`.
Do not merge: the lead reviews and merges into main.
