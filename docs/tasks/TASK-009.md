# TASK-009 — App shell, run controls and inspectors

Owner: unassigned
Gate: 1
Depends on: TASK-005, TASK-006, TASK-008, TASK-011 (and 002, 003 through the host)

## Goal

The playable app: open a synthetic city, watch vehicles, control the run, inspect vehicles,
streets, nodes and places, save and open projects. Gate 1 checklist items 1 to 4 and 7. The
layout and style follow architecture section 11 and `AGENTS.md`.

## In scope

- `src/main.tsx`, `src/ui/`: `App.tsx` (layout grid: top bar, toolbox, map, inspector, run
  bar), `store.ts` (one Zustand store: project, editor, compiled, engine client state,
  selection, run state), `map-view.tsx` (mounts the renderer, forwards pointer events to
  picking, requests snapshots per animation frame), `top-bar.tsx` (project name, New from
  fixture, Open, Save, Undo, Redo as buttons that are disabled when not applicable), `run-
  bar.tsx` (clock, play, pause, step, speed 1 2 5 10 20 with achieved multiplier, trip
  counts, synthetic-traffic notice, validation count that opens the diagnostics list),
  `toolbox.tsx` (Select only in this task; Road and Place tools arrive with TASK-022 and
  TASK-010 and are not shown before they work), `inspector/vehicle.tsx` (origin, destination,
  state, speed, route highlighted on the map, route reason, waiting time), `inspector/
  street.tsx`, `inspector/node.tsx`, `inspector/place.tsx` (read-only in this task; editing
  arrives in TASK-010), `inspector/diagnostics.tsx`.
- Save uses a download; Open uses a file input. Both accept ZIP and JSON.
- `tests/e2e/gate1-run.spec.ts`.

## Out of scope

- Editing controls (TASK-010), drawing tools (TASK-022), import wizard (TASK-021).
- Any new dependency.

## Interfaces

Consumes `EngineClient`, `Scene`, `Editor`, `openProject`, `saveProject`,
`generatePopulation`, `scheduleTrips`. The store calls `editor.compiled` for rendering and
sends it to the engine on load and restart. Expose `window.cityflows = { metrics(),
hash(), inspect(id) }` in development and test builds for Playwright assertions.

Notes after wave 1:

- `Scene.setCity(compiled, city)` takes the canonical `City` as well (place shapes, node
  layers). `Scene.setRouteOverlay({ lanes, movements })` takes compiled indices; map a `Route`
  to it from `targetLanes` and `movements`. `Scene.ready` is a promise to await before use.
- `openProject` returns `{ ok, project }` or `{ ok: false, file, error }`; `saveProject`
  returns ZIP bytes, `saveProjectJson` a string. `Project.history` is the editor's
  `history` array.
- `generatePopulation(city, scenario.demand)` then `scheduleTrips(city, persons, scenario)`;
  keep the persons in the project so restart reuses them.

## Acceptance

- Start the app: it opens the bundled `grid5x5` project. Vehicles appear and move within a
  second of pressing Play. Speed changes take effect and the achieved multiplier is shown.
  Pause freezes vehicles; Step advances exactly one step; Restart reproduces the same hash
  after the same number of steps (shown in the diagnostics panel).
- Clicking a vehicle highlights its route and shows its detail; clicking a street, node or
  place shows the read-only inspector; Escape clears the selection.
- Save downloads a `.cityflows` file; Open loads it and the run bar shows the project name.
- `gate1-run.spec.ts`: loads the app, presses Play, waits until `driving > 0`, pauses, reads
  the hash, restarts, steps the same count, asserts equal hash; opens a vehicle inspector and
  asserts a route is shown.
- No console errors; `npm run check` and `npm run test:e2e` green.

## Commands

`npm run check`, `npx playwright install chromium`, `npm run test:e2e`

## Deliverable

PR with the app, the e2e test and three screenshots (overview, vehicle selected, diagnostics
open).
