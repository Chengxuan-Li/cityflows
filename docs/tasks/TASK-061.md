# TASK-061 — Junction geometry: setbacks, curb arcs, tapers

Owner: unassigned
Gate: 5 (owner backlog B16)
Depends on: TASK-047, TASK-048, TASK-049, TASK-055. Design: `docs/architecture.md` section
5.1 (setbacks, `CNode.setbacks`, `CNode.outline`), section 5.2 (movement curves from the
trimmed ends, the `addRamp` taper), section 11 (node areas and markings), section 14 (T20).
Read those before the code.

## Goal

Every node trims its roads by one radius, so at irregular junctions (acute Y, skewed
crossings, five legs, offset T, ramp merges) lanes of different roads run into each other,
stop lines sit at a fixed distance that is wrong for every leg but one, and the junction
surface is a polygon through corners that do not match the roads. Junctions should look
built: each road end set back to where its lane block clears its neighbours, rounded curbs
between adjacent road ends, stop lines and give-way markings at the set-back lane ends,
movement curves that run from one trimmed end to the other, and a ramp that merges along a
taper lane rather than at a point. The simulation reads lane and movement polylines and
lengths; it does not change here.

## In scope

- `src/network`: `lanes.ts` (trim by the road end's setback), a new `junctions.ts` (setback
  per road end from the lane-block edge intersections with the two angular neighbours, the
  floor, the curb arcs, the closed outline), `movements.ts` (curves from the trimmed ends,
  straight when within 5 degrees and 0.5 m), `types.ts` (`CNode.setbacks`, `CNode.outline`),
  `compile.ts`, `diagnostics.ts` (`road_too_short` with two setbacks). `radiusM` stays as the
  largest setback.
- `src/geo/polyline.ts`, additive: segment intersection point, arc sampling.
- `src/editor/commands/ramp.ts`: `addRamp` lays the taper (split of the receiving road 60 m
  past the join, one extra curb-side lane on the first section fed by the ramp alone, lane
  drop at the split); `removeRamp` removes it; undo exact as today.
- `src/render`: `layers/nodes.ts` (draw the outline; nothing at a through node),
  `layers/roads.ts` and `layers/signs.ts` (markings at the trimmed ends), `scene.ts` (node
  picking by outline), the terrain cache if it keys on node geometry.
- `src/fixtures/junctions.ts`: a seeded fixture with an acute Y, a skewed four-way, a
  five-leg node, an offset T and a ramp merge, each with multi-lane legs; added to the
  bundled scenarios only if it is useful to look at.
- Tests: `tests/network/T20-junction-geometry.test.ts` (below), `tests/render` (the outline
  and marking positions), `tests/importers/munich.test.ts` additively (the overlap count),
  `tests/sim/T07*` unchanged in intent, updated for the taper if the ramp fixture changes.

## Out of scope

- `src/sim` (if a car behaves wrongly on the new geometry, report vehicle, lane and node ids
  and the step in the PR), `src/routing` (TASK-062 in parallel), the importer (an imported
  merge gets a taper only where the OSM `lanes` tags carry one; do not infer lanes),
  roundabout ring geometry (ring entries get setbacks like any road end; the ring itself is
  untouched), TASK-051's live edits (in parallel in `src/sim` and `src/host`).

## T20 (unit, `tests/network` and `tests/render`)

1. No overlap: on the junction fixture, Sindelfingen and Munich, at every node no two lane
   polylines of different road ends intersect, and every movement polyline lies inside the
   node's outline (0.1 m tolerance) and starts and ends at trimmed lane ends. Report the
   Munich count before and after in the PR.
2. Setbacks: a through node (two ends of one street) has setback 0 on both ends and no
   outline; an acute Y sets the two converging legs back further than the stem; a ramp
   merge's setback is the floor.
3. Taper: `addRamp` on the ramp fixture splits the receiving road 60 m past the join, the
   first section has one more lane than the rest, only the ramp's movement enters it, and the
   drop compiles as a lane drop; `removeRamp` then `undo` restore the exact entities.
4. Markings: the stop line of a signalized approach and the give-way triangle of a yield
   approach sit at the trimmed lane end, not at a fixed radius.

## Acceptance

- T20 passes; T07 and the roundabout scenarios pass; `npm run route-audit` zero on the four
  cities; the Munich probe keeps every connector pair routable and zero failed trips, with
  the `road_too_short` and `dead_end` lists updated with reasons where the setbacks changed
  them.
- Lane lengths change, so every state hash changes: the PR lists the new benchmark hashes
  and the trip counts of the four workloads (completed within 1 percent of today) and the
  e2e scenarios that pin a hash are updated once, each named in the PR.
- Screenshots in the PR: the Donnersbergerbrücke ramp merge, the fixture's acute Y and
  five-leg node, the grid's signalized crossing, each at a zoom where markings show.
- `npm run check` green; `npm run test:e2e` green; T16 figures within noise.

## Commands

`npm run check`, `npm run test:e2e` (set `CITYFLOWS_TEST_PORT`), `npm run bench`,
`npm run route-audit -- <project or osm file ...>`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148`.

## Deliverable

PR with the compiler, editor and renderer changes, the fixture, T20, the overlap counts
before and after, the screenshots and the new hashes.
