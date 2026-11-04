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
npm test               # Vitest, headless
npm run test:e2e       # Playwright (first run: npx playwright install chromium)
npm run format         # Prettier
```

## Delivering a task

1. Read your task file, `docs/architecture.md`, and the code you will touch. Do not restart
   the architectural investigation.
2. Branch `task/<id>-<short-name>` from `main` (or a worktree). Touch only the files listed
   under "In scope"; if you must touch another module, stop and ask the lead.
3. Build the feature end to end, including the test IDs listed in the task. Tests named by a
   handoff T-ID live in `tests/<module>/<Txx>-<name>.test.ts`.
4. `npm run check` must pass. Playwright tasks also run `npm run test:e2e`.
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

CityFlows is a polished minimalist transportation game in the spirit of Mini Motorways and
Mini Metro, not an engineering simulator, a GIS tool or a dashboard. The references are
inspiration for an original CityFlows identity, not interfaces to copy.

- The map is the interface. Panels, borders, buttons and labels are kept to the minimum that
  still exposes every capability; advanced controls (lanes, turns, signals, demand,
  diagnostics) appear contextually, one tap from the thing they belong to.
- Soft pastel palette on a light, slightly warm background; clean geometric shapes; roads
  with rounded ends whose width and tone show hierarchy; junctions as discs; places as simple
  colored shapes, each with a hue from a fixed palette; vehicles as rounded pills tinted by
  their destination's hue; signal state as a small glow; selection as a soft ring; lane
  markings and arrows that fade out at low zoom. Arrows exist only for legal movements.
- Motion matters: eased zoom at the pointer, inertia on pan, smooth lane-change animation,
  subtle transitions when panels appear. The city should feel alive while idle.
- Direct manipulation over forms: drag to pan, scroll to zoom, click to select, drag handles
  to move connectors, draw to create. Compact floating run controls; metrics and
  configuration only when asked for.
- Restrained typography: the system UI font, two sizes, one weight contrast. No cards inside
  cards, no decorative gradients, no emoji or icon packs, no headings that only name a panel,
  no copy that repeats what a control already says, no AI-oriented or self-referential text.
- Simplify how features are presented, never what the application can do. Every control
  changes something visible. Metrics use plain words and carry the "synthetic traffic, not
  observed traffic" notice.
