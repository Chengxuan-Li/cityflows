# TASK-050 — Game-like UI redesign

Owner: unassigned (one agent; owns all of `src/ui` and the renderer's look for the wave)
Gate: 2 (cross-cutting; lands before every later UI task)
Depends on: TASK-010

## Goal

CityFlows looks and feels like a polished minimalist transportation game in the spirit of
Mini Motorways and Mini Metro, not an engineering simulator or a dashboard, while every
existing capability stays reachable. The direction is written in `AGENTS.md`, section
"Design direction"; this task implements it.

## In scope

- `src/ui/**` (layout, components, store presentation state, `app.css`): the map dominates;
  compact floating run controls; a small floating toolbox; a contextual inspector that appears
  only for a selection (a slim sheet or popover anchored to the side, not a permanent
  column); progressive disclosure so lane counts, turn toggles, signal phases, place
  settings and diagnostics are one tap away but hidden by default; restrained typography
  (system UI font, two sizes, one weight contrast); no cards within cards, no headings that
  only name the panel, no explanatory copy that repeats what a control already says.
- `src/render/style.ts` and the drawing code in `src/render/layers/*`: the palette tokens
  (soft pastels on a light, slightly warm background), road hierarchy by width and tone,
  rounded road ends and junction discs, lane markings that fade out at low zoom, signal state
  as a small glow, places as simple colored shapes (each place gets a hue from a fixed
  palette), vehicles as rounded pills tinted by their destination place's hue so a queue
  reads as "cars going to the offices", selection as a soft ring, route overlay as a tinted
  ribbon. Smooth camera: eased zoom at the pointer, inertia on pan, fit-to-city on load.
- A "New" picker listing bundled fixtures from `src/fixtures/scenarios.ts` (TASK-026 adds a
  second city there); Open and Save stay as they are, visually integrated.
- Keep the accessible names the Playwright scenarios rely on where the control survives
  (Play, Pause, Step, Restart, Speed, Save, Open, New, Undo, Redo, Validation, the
  inspector landmark, the phase and turn labels, "Restart to apply changes"); where the
  design replaces a control, update the tests in the same PR. All seven scenarios in
  `tests/e2e` must pass unchanged in intent.

## Out of scope

- New features (import wizard, drawing tools, signal timeline, metrics layers, place
  painting are later tasks on top of this design). Do not change `src/editor`, `src/sim`,
  `src/host`, `src/schema`.
- New dependencies (no icon packs, no animation libraries, no web fonts). Icons, if any,
  are a handful of inline SVG paths.
- Dark mode, theming systems, design-token build steps.

## Acceptance

- Every control that existed before is still reachable and does the same thing: run
  controls and speeds, New, Open, Save, Undo, Redo, street lanes, speed, class, direction,
  node control, turn toggles, signal amber, all-red and phase durations and groups, place
  population, jobs, capacity, connector throughput, diagnostics with the hash, vehicle detail
  with route overlay. Write the list in the PR and tick it.
- `npm run check` and `npm run test:e2e` green.
- Screenshots at three zoom levels of the running grid, of a selected car, a selected street
  and a selected signal, and of the New picker. A short clip or sequence showing zoom and pan
  easing is welcome.
- No per-frame React re-render introduced; snapshot handling stays in `map-view`.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with the redesign, updated tests where names changed, screenshots, and a one-paragraph
note on the palette and the hue assignment rule for places and vehicles (so later UI tasks
reuse it).
