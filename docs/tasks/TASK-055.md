# TASK-055 — Undrivable routes

Owner: unassigned
Gate: 5 (owner backlog B17)
Depends on: TASK-031, TASK-046, TASK-048

## Goal

Some routes the router returns look valid but cannot be driven as planned, most often
through irregular junctions and near the map edge. The engine covers this at run time with
fallback movements and `missed_turn` reroutes (`src/sim/engine.ts`, `fallback`,
`routeReasons`), so trips still complete, but cars take turns they were not routed through,
queue where no route should send them, or circle on clipped boundary roads. The router's
lane feasibility rule (architecture section 7) and the compiler's movement set should agree
with what a vehicle can physically do.

## In scope

- `bench/route-audit.ts` (new): import or load a city, route every connector pair as the
  probe does, and check each route statically: `targetLanes[i]` reachable from the lane the
  previous movement delivers to, given the lane count, the road length and the lane-change
  distance the engine needs; every movement in the chain legal at its node; no road that is
  a clipped boundary stub with no legal continuation. Print the count by cause with examples
  (route, road ids, node ids). Run it on the grid, the town, Sindelfingen and Munich.
- `src/routing/**`: a route the audit rejects is not returned; the search expands only to
  lanes reachable from the arrival lane within the road, with the cost of the lane changes,
  under the feasibility budget the section already defines.
- `src/network/**`: where the audit shows a movement that should exist (a lane left without
  a legal continuation at a consolidated junction) or should not (a movement across a
  boundary cut), fix the compiler and add a diagnostic code with a message naming the lane.
- `tests/routing`, `tests/network`, `tests/importers/munich.test.ts` (additively): the
  audit's causes as unit cases; Munich asserts zero infeasible routes.

## Out of scope

- `src/sim` (if a cause lies in the engine, report the vehicle, road and node ids and the
  step in the PR instead of changing it), the importer, the renderer, junction geometry
  (B16).

## Acceptance

- The audit reports the counts before and after on the four cities; after, zero on all
  four, with the remaining Munich dead ends still listed by id and reason in the Munich
  test.
- The Munich probe keeps zero failed trips and every connector pair routable; the morning
  completed count does not fall.
- The state hashes of the grid and town benchmarks (`bench/latest.log`) are unchanged, or
  the PR names the defect that changed them.
- `npm run check` green; `npm run test:e2e` green.

## Commands

`npm run check`, `npm run test:e2e`, `npm run bench`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148`,
the new `npm run route-audit -- <project or osm file ...>` (add the script to `package.json`
the same way as `import-probe`).

## Deliverable

PR with the audit, the router and compiler fixes, the tests and the before and after table.
