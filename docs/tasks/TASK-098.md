# TASK-098 — A 3D view of the running city (viewer only)

Owner: unassigned
Gate: 6 (visual representation, owner 2026-11-07)
Branch: `task/098-3d-viewer` (created by the lead from main)
Depends on: TASK-090 (tiers). Phase B depends on TASK-096 (surroundings). Design: this file;
`docs/architecture.md` sections 5 (compiled model), 11 (rendering) and 13 step 4 (grades).
Read those before the code.

## Goal

The owner: "possibly 3d scene". The 3D view was deferred in architecture decision 15; the owner
brought it in on 2026-11-07 as a viewer. Add a 2D/3D switch. The 3D view shows the same compiled
city and the same running simulation, with roads at their real heights, so bridges and
interchanges read as built. Editing stays in 2D.

Hard rule: no change to the importer, the network, the simulation or the schema. The 3D view
only reads `CompiledCity`, the canonical `City` (grades, places, and `context` once TASK-096 is
in) and `VehicleSnapshot`.

## Design

1. **Library.** Add `three` (pin the exact current version) and `@types/three` as
   dependencies (owner-approved). Load the 3D module with a dynamic `import()` so three.js
   lands in its own chunk: the main chunk may grow by at most 5 kB (report before and
   after from `npm run build`).
2. **Module.** New folder `src/render3d/` with a `Scene3D` class mirroring the parts of
   `src/render/types.ts`'s `Scene` it needs: `setCity(compiled, source)`,
   `setSnapshot(snapshot)`, `setSignals(timeS)` (or whatever 2D uses for signal state),
   `setView(centre, zoom)`, `getView()`, `destroy()`. Its own canvas and WebGL context.
3. **Heights.**
   - Grade `g` stands at `5 * g` metres. Read grades the way `scene.ts` does (`nodeGrades`,
     `roadGrades`); factor that into a shared function instead of copying it.
   - A road whose grade differs from an end node's grade (a bridge deck ending at a ground
     node) ramps between them: z eases (smoothstep) from the node's height to the deck's over
     `min(60 m, half the road's length)` from that end. One pure function
     `heightAt(road, s)` gives z along a road; lanes, markings and vehicles all use it.
   - Movements (junction paths) take the height of their node.
4. **Scene content.**
   - Ground: one flat plane under the city's bounds. Opaque by default; a toggle "See below
     ground" makes it 40% transparent so tunnels (grade < 0) show.
   - Road surfaces from `CRoad.surface` and junction areas from `CNode.outline`, triangulated
     (three's built-in earcut via `ShapeUtils`), draped at `heightAt`. Raised roads get side
     faces down 0.8 m (a deck slab) and simple piers every 30 m down to the ground.
   - Lane markings (dividers, centre lines, edge lines) as thin flat strips 2 cm above the
     surface, from the same marking polylines the 2D layer draws. Reuse the 2D marking
     geometry functions; do not reimplement offsets. Crossings and arrows may wait.
   - Signal heads: small boxes on poles at the stop line, lamp colour by state, updated each
     frame like 2D.
   - Vehicles: one `InstancedMesh` of boxes about 4.5 × 1.8 × 1.5 m, coloured by state like
     2D, placed from the snapshot's `x`, `y`, `heading`, at `heightAt` of their lane or
     their node's height for movements, pitched to the ramp's slope. Reuse the 2D pose code in
     `src/render/layers/vehicles.ts` (`advanceAlong`, `laneChangePose`) for interpolation
     between snapshots; factor out what both need instead of copying.
   - Places: polygons as flat tinted areas, as in 2D.
   - Light: a hemisphere light and one directional light from the north-west with a shadow
     map (2048, fitted to the view), so decks cast real shadows.
5. **Camera.** three's `MapControls`: drag pans, right-drag orbits, wheel zooms toward the
   pointer; pitch limited to 10–85 degrees. Entering 3D starts above the 2D camera's centre
   at a matching scale and a 55-degree pitch; leaving 3D puts the 2D camera on the 3D view's
   ground target.
6. **UI.**
   - A "3D" toggle on the map (next to the zoom controls or in the run bar; follow the
     existing visual language in `AGENTS.md`). Keyboard: `V` toggles.
   - In 3D the editing toolbox is disabled with a tooltip "Editing is available in 2D".
     Playback, speed and the run bar keep working. Clicking a vehicle selects it (raycast on
     the instanced mesh) and the inspector shows it as in 2D; other picking may wait.
   - While 3D is shown, the Pixi app's ticker is stopped; on return it resumes and redraws.
   - `canvas.dataset.view = '3d'` and `dataset.meshes` (count) for e2e.
7. **Phase B (after TASK-096 merges; the lead will rebase this branch or ask you to).** When
   `city.context` exists: buildings extruded to `heightM`, else `levels × 3 m`, else 10 m,
   with flat roofs; water, green and land use as flat areas on the ground; rail as thin
   strips. A toggle "Buildings" (default on). If TASK-096 is not merged when phase A is done,
   commit phase A and stop.

## In scope

`src/render3d/` (new), `src/render/scene.ts` and `src/render/layers/vehicles.ts` (only to
factor out the grade and pose functions both views share), `src/render/types.ts`, the map
view and toolbar in `src/ui` (`map-view.tsx`, the run bar or map controls, the toolbox's
disabled state), `src/ui/store.ts` (view mode), `package.json` / `package-lock.json` (three,
@types/three), `docs/architecture.md` section 11 (a "3D view" paragraph describing what you
built), tests (unit tests next to the module, an e2e case tagged `@smoke`), and the
expectations that move, each named.

## Out of scope

Editing in 3D, `src/importers`, `src/network`, `src/sim`, the schema,
`src/render/layers/roads.ts` and `nodes.ts` beyond exporting an existing marking function
(TASK-095 is editing them; if you need a refactor there, stop and report), 2D shadows
(TASK-097), terrain elevation (the ground is flat).

## Gates

1. **Heights.** Unit tests:
   - `heightAt` is 0 along every grade-0 road of Munich and Sindelfingen, and `5 * g` along
     the middle of a grade-`g` road;
   - at a bridge end it equals the end node's height and has no step (|Δz| < 0.05 m per 0.5 m
     sample) anywhere along the road;
   - no NaN in any vertex buffer for the four audit cities.
2. **Vehicles.** In a test, the 3D vehicle instances' x/y equal the 2D layer's positions for
   the same snapshot within 0.01 m, and z equals `heightAt` within 0.05 m.
3. **Shots.** Add a mode to `bench/geometry-shots.ts` (or a sibling script) that renders 3D
   cameras: `V98-donnersberger` (the bridge and Arnulfstraße from the south-east at 45
   degrees), `V98-n967`, `V98-sindelfingen-a81` (with the Sindelfingen extract), and
   `V98-munich-overview`. Read every image yourself: decks join the ground without steps or
   gaps, markings lie on the surface, no z-fighting flicker in two consecutive frames.
4. **Performance.** On Munich with the simulation running at 1x and at least 1 000 vehicles,
   3D runs at 30 FPS or more on this machine; report FPS in 3D and in 2D, and the static
   build time. Main chunk growth under 5 kB.
5. **Switching.** e2e (`@smoke`): load Munich, toggle 3D, `dataset.view` is `3d` and meshes
   are drawn, playback continues, toggle back, the 2D map shows the same centre and the
   toolbox is enabled again. Run with `CITYFLOWS_TEST_PORT=5295`; never use port 4173.
6. Benchmark hashes unchanged; `npm run check`, `npm run test:city` and
   `npm run test:e2e:smoke` green.

## Acceptance

All gates for phase A (phase B adds the buildings shots when it runs). Open the app
(`npm run dev -- --port 5295`), load Munich, run the morning, switch to 3D, fly along the
Donnersberger bridge and over `n:967`, select a car, switch back. Describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- the library version, chunk sizes before and after;
- the height rule and constants as implemented;
- what was factored out of the 2D code and why;
- FPS and build times;
- image paths;
- expectations changed, each with its reason;
- the final lines of `npm run check`.

Commit on `task/098-3d-viewer`; do not push or merge. The lead reviews only commits.
