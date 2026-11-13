# AGENTS.md — working on CityFlows

CityFlows is a browser-based city traffic sandbox: individual vehicles on lane-level road
networks that are imported from OpenStreetMap or drawn by hand, driven by place-based
work/life demand. Read this file first, then:

- `docs/architecture.md` — the frozen contracts: data model, module boundaries, simulation,
  routing, editing, persistence. Changing a contract needs lead approval and a doc update in
  the same PR.
- `docs/plan.md` — gates, task graph, ownership, acceptance matrix.
- `docs/tasks/TASK-xxx.md` — the task you were assigned. Its scope and acceptance tests are
  the definition of done.
- `docs/20261103_browser_city_traffic_game_agent_handoff.md` — the product brief (R1–R8 are
  binding requirements).

## Engineering principles

### 1. Prefer simplicity over defensive engineering

- Implement the simplest solution that correctly satisfies the requirements.
- Do not add speculative abstractions, unnecessary fallback paths, excessive validation, or
  defensive checks for impossible internal states.
- Validate external and untrusted inputs at system boundaries (imported maps, project files,
  Overpass responses). Trust well-defined internal interfaces and invariants.
- Fail clearly when assumptions are violated. Do not silently swallow errors, fabricate
  defaults, or conceal broken states.
- Avoid premature optimization, overengineering, and designing for hypothetical future
  requirements.

### 2. Reuse before reinventing

- Search the existing codebase and relevant open-source libraries before implementing
  substantial functionality.
- Prefer established libraries and reusable modules for road-network processing, routing,
  vehicle simulation, geometry, rendering, and import/export.
- Evaluate reuse on functionality, maintainability, performance, licensing, and integration
  cost.
- Do not reinvent standard algorithms or infrastructure unless existing solutions are
  demonstrably unsuitable.
- Avoid introducing dependencies for trivial functionality (a binary heap, a seeded RNG, a
  hash, a Mercator projection are each a few dozen lines; write them).

### 3. Keep the architecture modular but lightweight

- Maintain clear boundaries between simulation, road-network data, travel demand, routing,
  rendering, and UI. The layer rule below is enforced by ESLint.
- Keep simulation logic independent of rendering and UI frameworks.
- Build abstractions only when they solve an existing problem or support a committed
  requirement.
- Prefer explicit data structures, straightforward interfaces, and composable modules over
  elaborate class hierarchies.
- The browser is the primary interface. Introduce backend dependencies only when justified by
  actual requirements or measured performance constraints.

### 4. Implement complete, usable features

- Prioritize end-to-end functionality over architectural scaffolding.
- Each feature works through the actual user workflow, not only through internal APIs.
- No placeholders, mock implementations, TODO-only features, or UI controls that do nothing.
- Do not simplify away committed product requirements for implementation convenience.
- When full implementation is impractical, deliver a clearly scoped working subset and state
  in the PR and in `docs/plan.md` what remains unsupported.

### 5. Test strategically, not excessively

- Write focused tests for important algorithms, invariants, and regressions.
- Prioritize road-network connectivity, routing correctness, vehicle behavior, traffic
  generation, import/export fidelity, and simulation determinism.
- Prefer a small number of meaningful integration tests over many trivial unit tests.
- Do not write tests to raise coverage numbers. Avoid excessive mocking, snapshot tests, and
  tests of implementation details.
- Run the relevant tests, typecheck, lint and build before considering work complete.

### 6. Maintain a clean, purposeful UI

- CityFlows is an interactive game and simulation sandbox, not an enterprise dashboard or an
  AI-generated demo.
- Avoid generic AI-generated UI patterns: excessive cards, decorative gradients, meaningless
  badges, oversized rounded containers, unnecessary icons, repetitive explanatory text.
- Never add AI-oriented boilerplate, promotional copy, or self-referential text to the
  interface.
- Use concise, functional labels and contextual help only where needed.
- Prioritize map readability, direct manipulation, responsive interactions, and clear visual
  feedback.
- Keep the visual language consistent across simulation, road editing, traffic controls, and
  scenario management.

### 7. Minimize code and documentation noise

- Keep code concise, readable, and idiomatic.
- Avoid unnecessary wrappers, helper functions, configuration layers, and file fragmentation.
- Do not write comments that restate the code. Document non-obvious algorithms, assumptions,
  and consequential design decisions.
- No lengthy boilerplate documentation, repetitive summaries, or extra Markdown files. The
  docs that exist are listed at the top of this file; add a doc only when the plan asks for it.
- Do not introduce new dependencies, architectural layers, or configuration systems without a
  concrete justification stated in the PR.

### 8. Work efficiently and respect existing decisions

- Inspect relevant code and project documentation before making changes.
- Preserve established architectural decisions and conventions unless there is a compelling
  technical reason to change them; raise it with the lead instead of working around it.
- Make focused changes. Do not refactor unrelated code while implementing a feature.
- Prefer incremental, verifiable changes that keep the application functional.
- Do not claim a feature is complete unless it is integrated, usable, and verified.
- When delegating, define ownership, interfaces, dependencies, and acceptance criteria.

## Stack

TypeScript (strict), Vite, React 19 + Zustand (UI only), PixiJS 8 (renderer), Zod (boundary
validation), fflate (project ZIP), Vitest (headless tests), Playwright (browser scenarios),
ESLint + Prettier, GitHub Actions. Node 22+ and npm. Versions are pinned in `package.json`;
do not add or upgrade dependencies in a task that is not about them.

## Repository layout and layer rule

```
src/geo         pure geometry: Vec2, projection, polyline ops          (no deps)
src/schema      canonical types, Zod schemas, IDs, migrations          -> geo
src/network     compile(City) -> CompiledCity, diagnostics             -> schema, geo
src/editor      commands, patches, undo/redo, commit validation        -> network
src/routing     RouteProvider: road-level search + lane feasibility    -> network
src/demand      places, persons, agendas, trip generation              -> network
src/sim         fixed-step engine: vehicles, IDM, MOBIL, signals       -> network, routing
src/importers   OSM XML / GeoJSON / Overpass -> City + diagnostics     -> network
src/project     save/open/export, manifest, hashes, ZIP                -> schema, editor, demand
src/fixtures    synthetic world generators used by tests and demos     -> schema
src/host        Web Worker entry + typed protocol + main-thread client -> sim, demand, routing
src/render      PixiJS scene, layers, camera, picking                  -> network, host types
src/ui          React app, panels, tools, Zustand store                -> everything above
fixtures/       data files (OSM extracts with attribution, saved projects)
tests/          integration tests named by handoff T-IDs; tests/e2e for Playwright
```

Rules, enforced by `eslint.config.js`:

- Core modules (`geo`, `schema`, `network`, `editor`, `routing`, `demand`, `sim`,
  `importers`, `project`, `fixtures`) never import React, Zustand, PixiJS, DOM APIs, or
  anything from `render`, `ui`, `host`.
- `render` never imports React, Zustand or `ui`.
- `sim`, `routing`, `demand`, `editor`, `network` never use `Math.random`, `Date`, or
  `performance.now`. All randomness comes from the seeded RNG; all time is simulation time.

## Conventions

- Units: meters, seconds, meters per second, radians. Internal coordinates: local metric
  frame, x east, y south (see `docs/architecture.md` section 3). Never mix degrees with meters.
- IDs: `n:<int>` nodes, `r:<int>` roads, `p:<int>` places, `c:<int>` connectors, allocated
  from `City.nextId`. Derived lane IDs are `<roadId>#<laneIndex>`; movement IDs are
  `<laneId>><laneId>`. Lane index 0 is the leftmost lane in travel direction.
- Determinism: fixed-order iteration (sorted ids or dense indices), seeded RNG, no wall
  clock. If a test needs randomness, seed it.
- Errors: throw on violated invariants; return structured results (`{ ok, reason }` or
  diagnostics) for expected failures at boundaries (import, routing, editing).
- Naming: `camelCase` values, `PascalCase` types, file names `kebab-case.ts`. Tests sit next
  to the unit they test (`foo.test.ts`) or in `tests/` when they span modules.
- Simulation and compile code use dense arrays indexed by compiled indices, not maps keyed by
  string IDs, on hot paths.

## Commands

```
npm run dev            # Vite dev server
npm run check          # typecheck + lint + format:check + unit tests + build (run before a PR)
npm test               # Vitest unit tier: no Munich import or simulation (about 20 s)
npm run test:city      # Munich's import and geometry tests
npm run test:traffic:light # the 10:00 traffic gate at 0.15 and T53 (about 5 min)
npm run test:traffic   # the whole traffic tier, with full demand (checkpoints; 10 min or more)
npm run traffic:quick  # advisory: Munich at 0.15 to 09:30 against main, phase timings
npm run seed-report -- --out <dir> # advisory: Munich 0.15 to 10:00, seeds 1-3, choice off and on, drain criteria (the nightly Full report)
npm run test:e2e:light # the light Playwright set: synthetic-city flows (about 5 min)
npm run test:e2e       # the whole Playwright suite (checkpoints; first run: npx playwright install chromium)
npm run test:e2e:smoke # the @smoke Playwright tests, including heavy Munich cases
npm run format         # Prettier
```

Real-city imports are cached in `node_modules/.cache/cityflows` (`bench/city-cache.ts`, keyed by
the importer's sources); `CITYFLOWS_NO_CACHE=1` imports fresh. `tests/warm-cache.ts` fills it
before the workers start. On a loaded machine: `CITYFLOWS_TEST_TIMEOUT_MS` (default 60000) is the
per-test limit and scales every limit written in a test file (`limit()`, `tests/timeouts.ts`), so
240000 quadruples them all; `CITYFLOWS_TEST_WORKERS` caps the test files running at once (default:
8, or 4 for the Munich tier, or the cores minus one if fewer; 1 runs them one at a time).

## Delivering a task

1. Read your task file, `docs/architecture.md`, and the code you will touch. Do not restart
   the architectural investigation.
2. Branch `task/<id>-<short-name>` from `main` (or a worktree). Touch only the files listed
   under "In scope" plus whatever else the feature needs to be wired in, type-check or be
   tested, and list those extra files in your report. Stop and ask the lead only for a file
   under "Out of scope", a contract change the task does not describe, or a behaviour
   change to another feature.
3. Build the feature end to end, including the test IDs listed in the task. Tests named by a
   handoff T-ID live in `tests/<module>/<Txx>-<name>.test.ts`.
4. `npm run check` must pass, plus the light tiers that match the task: `npm run test:city`
   for network, importer and render geometry; `npm run test:traffic:light` for anything that
   moves traffic (`npm run traffic:quick` while iterating); `npm run test:e2e:light` for UI;
   and every spec or test your task file names. The lead runs the same light tiers at merge,
   and so does CI on every push. The full tier (`test:traffic` with full demand, the whole
   `test:e2e`, `npm run bench`) runs only at checkpoints: a pushed `checkpoint-*` tag, a manual
   run of the Full workflow, or the nightly run. A red full run blocks new merges until it is
   fixed.
5. Open a PR with: what works, what is explicitly unsupported, how it was verified, any
   contract change (requires lead approval), any new dependency (with justification), any
   copied code (with a `NOTICE` entry). Commit messages use Conventional Commits
   (`feat(sim): ...`, `fix(editor): ...`).
6. The lead reviews semantic compatibility (connectivity, movement legality, determinism,
   license) before merging. Do not merge your own PR.

## Licensing

- The project is GPL-3.0-or-later. Code may be adapted from permissive (MIT/BSD/Apache/ISC)
  and GPL-compatible sources only, with an entry in `NOTICE` naming source, commit, license,
  and destination file, in the same PR.
- PolyForm Noncommercial and other non-free sources (for example Nitai Aharoni's traffic
  simulator) are study-only. Never copy their code, assets or screenshots.
- OpenStreetMap data is ODbL. Every imported city carries attribution in its manifest and the
  UI shows it. Bundled OSM fixtures include an `ATTRIBUTION.txt`.
- Upstream screenshots are design references, never redistributed assets.

## Design direction

CityFlows looks and behaves like a clean Mac app in the Sonoma / Ventura flat manner (owner,
2026-11-13; TASK-160). Not Liquid Glass: solid surfaces, no translucency, blur or vibrancy.

- **Window.** A docked window: a unified toolbar (city name over "CityFlows", file actions,
  history, the tool segmented control, run controls, speed, 3D, the sidebar toggles), a left
  sidebar of collapsible sections (the active tool's options, Layers, Chart, Demand, Compare,
  Validation), a right inspector for the selection, a status bar (clock, trip counts, the
  synthetic-traffic notice, map attribution), and the map filling the content area. Both sidebars
  collapse from the toolbar and resize by their inner edge. Nothing floats over the map but its
  own transient overlays. Under 900 px the sidebars float over the map, and toolbar items that do
  not fit move into the » overflow menu in priority order, never wrapping.
- **Controls.** One control set (`src/ui/controls.tsx`, `src/ui/app.css`), reused everywhere:
  push, primary and toolbar buttons, segmented control, pop-up and pull-down menus, checkbox,
  switch, slider, text and number fields with a stepper, disclosure sections, popovers with an
  arrow for edits that belong to one item, sheets dropping from the toolbar for import, export
  and new city, tooltips. Build new UI from these; do not add one-off styles.
- **Type and colour.** Arimo (bundled, OFL-1.1), 13 px body and 11 px small, regular and bold.
  The tokens in `app.css`: light grey chrome, hairline separators, 6 px control and 10 px window
  radius, shadows on popovers and sheets only. macOS blue `#007AFF` for focus rings, switches,
  sliders and map selection; `#0064D1` behind white text (primary button, selected rows) so text
  meets WCAG AA. Every text and control meets AA, focus is always visible, and every control is
  reachable by keyboard.
- **Dark appearance.** Every token has a dark value under `:root[data-appearance='dark']`
  (TASK-166), in the same flat Sonoma manner, with the accent at `#0A84FF`. Add any new colour
  as a token with both values; `src/ui/contrast.test.ts` checks AA in both appearances.
- **Map.** A neutral, Apple-Maps-like light palette in 2D and 3D (TASK-162): a plain warm-grey
  canvas, white roads with soft casings, quiet place tints, vehicles in the system colours by
  destination. Marking themes keep their regulatory colours. The dark map (TASK-166) darkens the
  canvas, land use and place tints only; roads, markings, rail, vehicles and street furniture keep
  their real colours in both appearances (owner, 2026-11-13).
- **Behaviour.** Direct manipulation over forms: drag to pan, scroll to zoom, click to select,
  drag handles to move, draw to create. Every control changes something visible. Simplify how
  features are presented, never what the application can do.
- **Words.** Plain, short labels; contextual help only where needed. No emoji, no decorative
  gradients, no cards inside cards, no headings that only repeat a control, no copy that repeats
  what a control already says, no AI-oriented or self-referential text. Metrics use plain words
  and carry the "synthetic traffic, not observed traffic" notice.
