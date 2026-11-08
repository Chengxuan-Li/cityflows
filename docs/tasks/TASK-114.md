# TASK-114 — US and UK marking themes, chosen per project

Owner: unassigned
Gate: 8 (more realistic visuals, owner 2026-11-07), feature 8.5 (low priority); Phase 2 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/114-marking-themes` (created by the lead from main)
Depends on: TASK-108 (marking geometry and the German theme). Design: this file;
`docs/architecture.md` sections 4 (City) and 11 (rendering). Read those before the code.

## Goal

TASK-108 drew lane markings to the German standard through one marking geometry module
(`src/render/marking-geometry.ts`) that both renderers read, with a single module-level
`markingTheme` in `src/render/style.ts`. Add the US and UK themes and choose the theme per
project, defaulting from the import area's country: US cities get yellow centre lines between
opposing traffic and US arrows, UK cities white centre lines, yellow edge lines and UK arrows.

## Design

1. **Theme per project (contract change, pre-approved).** `City.markingTheme?: 'de' | 'us' |
   'uk'`, display-only like `context`, no `schemaVersion` bump, ignored by compile, routing and
   simulation. Absent means the default from the city's geography (below), else `de`. Describe
   it in section 4.
2. **Default by country.** At import, from the country of the area: OSM `addr:country` /
   `is_in:country_code` tags where present (`src/importers/osm/controls.ts` already reads
   them), else coarse built-in bounding regions (United States and Canada → `us`; United
   Kingdom and Ireland → `uk`; elsewhere → `de`), no external lookup. The fixtures
   `downtown.osm` and `suburb.osm` lie in the United States; Munich and Sindelfingen in Germany.
3. **Themes as data.** Turn `markingTheme` into a theme table keyed by `de`, `us`, `uk`, with the
   marking geometry taking the theme as a parameter (or reading it from the city) instead of the
   module constant. Each theme sets colours per role, widths, dash patterns per class, arrow
   glyphs and the guide and gore styles:
   - `us` (MUTCD): yellow centre line between opposing directions (double solid on multi-lane
     two-way roads, dashed yellow where passing is allowed on two-lane roads if you can infer
     it, else double solid), white lane lines 3 m dash / 9 m gap, white edge lines, yellow left
     edge on divided roads and one-way ramps, US arrow shapes, white stop bars.
   - `uk` (TSRGD): white centre lines (warning-line pattern where the class suggests it), white
     lane lines, yellow edge lines along the kerb (the owner's roadmap, Gate 8.5), UK arrow
     shapes (elongated), give-way double dashed lines at yield approaches.
   - `de`: today's output unchanged byte for byte.
4. **UI.** A "Marking style" choice (Germany, United States, United Kingdom) in the Layers panel
   or project settings, with undo if it is a city edit; switching redraws 2D and 3D markings.
5. **Measure.** Marking build time per theme on Munich; frame time unchanged.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
renderer layers and setters, editor command for the setting, dev pages, fixture builders,
shared types, test helpers), as long as it is not named under "Out of scope"; list each such
file and why in your report. Stop and ask the lead only for a file named under "Out of scope",
a contract change this task does not describe, or a behaviour change to another feature.

Pre-approved, no need to ask: `src/schema/city.ts`, `city.schema.ts` (`markingTheme`);
`src/importers/osm/index.ts`, `controls.ts` (country detection); `src/render/style.ts`,
`src/render/marking-geometry.ts`, `src/render/layers/roads.ts`, `junction-markings.ts`,
`transitions.ts`, `src/render/scene.ts`; `src/render3d/markings.ts`, `src/render3d/scene.ts`;
`src/editor/**` (a command for the setting), `src/ui/layers.tsx`, `src/ui/store.ts`,
`src/ui/map-view.tsx`; `bench/geometry-shots.ts` (theme per shot and new cameras);
`docs/architecture.md` sections 4 and 11; tests (a new `tests/render/V114-themes.test.ts`, an
importer case, an e2e case tagged `@smoke`), and the expectations that move, each named with
its reason.

## Out of scope

`src/network`, `src/sim`, `src/routing`, road and junction geometry, crossings layout (TASK-091),
street furniture and `BUS` text (TASK-107; it reads the theme's colours if both land),
parking-restriction kerb lines, other countries.

## Gates

1. **German output unchanged.** With `de`, the marking geometry for Munich and Sindelfingen is
   identical to main's (V108's expectations and its shots do not move).
2. **Themes.** In V114: on a synthetic two-way, multi-lane road, `us` yields a yellow double
   centre line between opposing directions and white lane lines with the US dash; `uk` white
   centre and lane lines with UK arrows; arrows differ per theme; the default theme is `us` for
   `downtown.osm`, `de` for Munich and `uk` for a synthetic city with a UK bounding box;
   switching the theme does not change `compile(city)` (pinned hashes unchanged).
3. **Project.** Save and open keep `markingTheme`; a file without it opens and takes the default.
4. **Render.** 2D and 3D shots per theme on Munich and on `downtown.osm` (new cameras
   `V114-downtown-us`, `V114-munich-us`, `V114-munich-uk`, plus `V108-munich-arrows` in each
   theme); read them yourself: colours and arrows match the theme, nothing else moves.
5. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Run e2e with
   `CITYFLOWS_TEST_PORT=5314`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, the full `npm run test:e2e` or
  `npm run bench`; the lead runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5314`), import
`fixtures/osm/downtown.osm` and Munich, check each opens in its default theme, switch themes in
2D and 3D; describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the theme table as
implemented, country detection, image paths, files changed outside the pre-approved list and
why, expectations changed with their reasons, and the final lines of `npm run check`. Write any
Markdown or docs as UTF-8.

Commit on `task/114-marking-themes`; do not push or merge. The lead reviews only commits.
