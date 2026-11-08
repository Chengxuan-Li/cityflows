# TASK-115 — Render on demand: draw the map only when something changes

Owner: unassigned
Gate: performance (owner, 2026-11-08); Phase 2 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/115-render-on-demand` (created by the lead from main)
Depends on: nothing open. Design: this file; `docs/architecture.md` section 11 (rendering).
Read it before the code.

## Goal

The 2D map redraws every animation frame, even when nothing on it changes: PixiJS's
`Application` ticker renders the whole stage on every tick (`src/render/scene.ts`), and the
map view's own frame loop (`src/ui/map-view.tsx`) also calls the 3D renderer on every frame
while 3D is open. On CI's software GPU an idle Munich frame costs about 0.4 s, so every
Playwright click waits over a second for stable frames; the lead raised the CI e2e timeout to
120 s to compensate (plan, review log 2026-11-07). On a laptop the idle redraw wastes battery.

Draw a frame only when something visible changed, in 2D first and then in 3D, with no visible
difference to the user: panning, zooming, playing, editing, selecting, hovering, toggling
layers, loading tiles and every animation must look exactly as today.

## Design

1. **One invalidation rule per view.** Each renderer keeps a "needs a frame" flag and renders
   at most once per animation frame, only when the flag is set. Anything that changes what
   is drawn sets it: camera moves and resizes, `setCity`, layer visibility, selection and
   multi-selection, overlays (route, difference, disconnected, edit previews, tool hints),
   vehicles (only while their drawn positions change: playing, or still interpolating
   towards the last snapshot), signals and heat colours when the simulation time moves, tile
   loads and tile fades (until the fade ends), hillshade and context caches, theme changes,
   and the canvas size. Prefer a single `invalidate()` on each scene called from its setters
   over flags spread through the UI.
2. **2D.** Stop the Pixi ticker from rendering every tick (`autoStart: false` or an equivalent)
   and render the stage explicitly when invalidated. Keep the tile layer's `update`
   (it needs the frame delta for fades) running only while tiles are loading or fading.
   `setActive(false)` while 3D is open stays as today.
3. **3D.** Same rule in `src/render3d/scene.ts` and the map view's frame loop: render when the
   camera or its damping moves, vehicles move, layers or selection change, tiles or
   vegetation detail update, or the shadow cache needs a refresh. If the 3D part turns out
   much larger than the 2D part, deliver 2D complete and report what 3D still needs.
4. **Measurement stays honest.** T16, T44, V106 and `bench/geometry-shots.ts` measure the cost
   of drawing a frame through `cityflows:render` and `cityflows:render3d` measures over
   idle frames. With on-demand rendering an idle frame draws nothing, so add a test-mode switch
   (for example `window.cityflowsRenderContinuously = true`, honoured only when
   `import.meta.env.MODE === 'test'`) that makes both views draw every frame, and use it in
   those measurements so they keep reporting the real per-frame cost. Their thresholds do
   not change.
5. **Observable state for tests.** Expose a test-mode counter of drawn frames on the canvas
   (for example `data-frames` on the 2D canvas and the 3D canvas) so an e2e case can prove
   that an idle map draws nothing.
6. **CI.** Once on-demand rendering works, set the e2e `timeout` in `playwright.config.ts`
   back to 60 s on CI as locally, and update its comment. Keep the four CI groups; note in
   your report any spec whose local duration changed a lot, so the lead can rebalance.
7. **Measure.** Local wall time of `npm run test:e2e:smoke` before and after on the same
   machine, and of its slowest five specs; idle frames drawn per second at the Munich
   overview in 2D and 3D, before (60 or the display rate) and after (0 expected).

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
view wiring, renderer layers and their setters, dev pages, test helpers, fixture builders,
shared types, e2e specs and bench scripts that measure frames), as long as it is not named
under "Out of scope"; list each such file and why in your report. Stop and ask the lead only
for a file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature. A visual or interaction difference caused by a missed
invalidation is a bug in this task, not a behaviour change: fix it.

Pre-approved, no need to ask: every file under `src/render/` and `src/render3d/` that needs an
`invalidate()` call or a setter change; `src/ui/map-view.tsx` and the tools and pointer
handling it owns; `src/ui/store.ts` if a subscription is the cleanest trigger;
`playwright.config.ts` (the timeout and its comment); `tests/e2e/helpers.ts`;
`tests/e2e/T16-performance.spec.ts`, `T44-context.spec.ts`, `V106-vegetation.spec.ts`,
`view3d.spec.ts` and any other spec that reads frame timings or `data-ticker`;
`bench/geometry-shots.ts` (shots must still capture fully drawn frames);
`docs/architecture.md` section 11 (describe the invalidation rule and the test switch).

New tests: `tests/render/V115-redraw.test.ts` for the invalidation logic where it can be tested
without a GPU, and an e2e case `tests/e2e/V115-redraw.spec.ts` tagged `@smoke`.

## Out of scope

`src/network`, `src/sim`, `src/routing`, `src/importers`, `src/schema`, the worker protocol and
the snapshot format. What is drawn (geometry, colours, layer content) does not change; only
when it is drawn. `.github/workflows/ci.yml` stays as it is (the lead rebalances groups).

## Gates

1. **Idle draws nothing.** In V115 (e2e), with Munich imported and the run paused, the 2D view
   draws no frame over 2 s of idle time after the map settles, and the same in 3D. Panning,
   zooming, toggling a layer, selecting a road and pressing Play each draw frames again;
   while playing, the vehicle layer draws on every frame.
2. **No visible difference.** Geometry shots for a representative set before and after on the
   same machine (`R6-n138`, `V106-munich-streets`, `V108-munich-arrows`, `V96-sindelfingen`,
   `R6-n138-3d` and `V106-munich-streets-3d`) are pixel-identical or differ only by antialiasing noise;
   report the per-image difference. Read the images yourself.
3. **Interactions.** Drawing a road, painting a place, the ramp and roundabout tools, hover
   previews, the signal editor preview, a tile fade-in on pan and the 3D camera's damping all
   look as today. Describe what you checked in the app.
4. **Frame cost unchanged.** T16, T44 and V106 pass with their thresholds unchanged, using the
   continuous-render switch where they sample idle frames.
5. **Faster e2e.** The local `npm run test:e2e:smoke` wall time drops; report before and after.
   The lead runs the full suite at merge and confirms on CI with the 60 s timeout.
6. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Run e2e with
   `CITYFLOWS_TEST_PORT=5315`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), single e2e specs with `--grep`, and
  `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, the full `npm run test:e2e` or
  `npm run bench`; the lead runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates. Open the app (`npm run dev -- --port 5315`), import Munich, leave it idle and check
in the browser's performance panel or the `data-frames` counter that nothing redraws; then
pan, zoom, play, edit a road, toggle layers and switch to 3D and back; describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the invalidation
sources as implemented, the test switch, the files you changed outside the pre-approved list
and why, idle frames per second before and after, smoke e2e wall time before and after with
the five slowest specs, shot differences, and the final lines of `npm run check`.

Commit on `task/115-render-on-demand`; do not push or merge. The lead reviews only commits.
