# TASK-047 — Renderer polish: junctions, motion, markings

Owner: unassigned
Gate: 5 (owner backlog B1, B4, B6, B7, B9 markings, B12)
Depends on: TASK-044, TASK-046

## Goal

The map reads like a street map and the cars move like cars: junctions have the shape of
the roads that meet, cars glide between simulation ticks, lane changes ease, lanes and
junctions carry realistic markings, and the OSM basemap can be hidden.

## In scope

- `src/render/layers/nodes.ts` and `roads.ts` (B1): draw each junction as the union of the
  incoming and outgoing road ends and the movement surfaces, closed with the lane-edge
  polygon between adjacent road ends; the disc stays only for degree-two nodes, scaled to
  the lane width. Verify on `fixtures/osm/munich-donnersberger.osm`, where the ring's
  junctions are the worst case, and on the grid and town.
- `src/render/layers/vehicles.ts` and the snapshot handling in `src/ui/map-view.tsx` (B6):
  between snapshots, move each car along its lane or movement polyline by its speed times
  the elapsed wall time times the run multiplier, clamped at the segment end; snap to the
  next snapshot when it arrives. No extra simulation steps, no change to the pulled
  snapshot cadence.
- `src/render/layers/vehicles.ts` (B7): ease the lateral lane-change offset (smoothstep over
  `laneChangeDurationS`) and turn the heading a few degrees into the change; model
  unchanged.
- `src/render/layers/roads.ts`, `nodes.ts`, `signals.ts` (B9 markings, B12): stop lines at
  signalized and stop-controlled approaches, give-way triangles at yield approaches, lane
  arrows at approaches with turn-specific lanes (from the compiled movements), zebra
  crossings across the approaches of signalized junctions; all fading with zoom like the
  existing markings.
- `src/ui/layers.tsx` (B4): a "Basemap" entry that toggles the tiles (`setTiles`), shown
  only for cities with `geo`.
- `src/ui/app.css` and `src/ui/panels/demand.tsx`: the demand chart keeps the metrics
  chart's size below 900 px; the Ramp tool's hint does not overlap the run bar.

## Out of scope

- Roundabouts and signs as objects (TASK-049), importer changes (TASK-048), any change to
  snapshots, the sim, the editor or the schema.

## Acceptance

- Screenshots at three zooms of a Munich ring junction, a grid signal and a town arterial,
  before and after, in the PR; markings exist only where the compiled movements justify them.
- A short clip or frame sequence showing a car crossing a junction at ×1 and a lane change.
- T16 numbers unchanged within noise (run `npx playwright test tests/e2e/T16-performance.spec.ts`
  before and after); all 37 scenarios pass; `npm run check` green.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with the renderer changes, the toggle, the two layout fixes, screenshots and the T16 numbers.
