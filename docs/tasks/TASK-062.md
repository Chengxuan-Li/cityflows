# TASK-062 — Routing throughput

Owner: unassigned
Gate: 5 (owner backlog B20)
Depends on: TASK-055, TASK-057

## Goal

TASK-055 made every returned route drivable, and in doing so made the router slow: the
road-level result is now accepted only when the resolved lane chain needs no lane change and
costs exactly the road path (`src/routing/index.ts`, the block after `resolveLanes`), so
nearly every request falls through to `searchLanes`. On the lead's machine (i7-14700F, idle)
`npm run bench` fell from 54 963 to 26 427 routes per second on the grid and from 5 064 to
1 548 on the town, and the town's 24 h engine rate from 27 065 to 18 764 steps per second
(morning 9 604 to 6 035). Get the throughput back without giving up what TASK-055 fixed.

## In scope

- `src/routing/**`. Two routes to the goal; the PR says which was taken and why:
  1. Keep the lane-level search as the decider but make it cheap: for example, run the
     road-level search backwards from the destination once and use its exact remaining
     costs as an admissible A\* heuristic in lane space, so the lane search expands a thin
     corridor; or make the lane expansion incremental over the road-level corridor.
  2. Accept the resolved road-level chain in more cases, when the lane changes it needs are
     feasible under the section 7 budgets and no cheaper lane chain can exist through those
     roads. This changes which route is returned only if the argument is wrong, so it comes
     with a proof in the PR, not a tolerance.
- `tests/routing`: a regression that routes a fixed request set (grid, town, Sindelfingen,
  Munich from `bench/route-audit.ts`'s sampling) and asserts the results deep-equal the
  current router's, so the change is a pure speedup.
- `bench/sim.ts` only if the routing benchmark needs an extra flag; `docs/architecture.md`
  section 7 if the acceptance rule changes, in the same PR.

## Out of scope

- `src/sim`, `src/network`, the audit's rules (`bench/route-audit.ts`), the engine's reroute
  scheduling. TASK-051 (live edits) runs in parallel in `src/sim` and `src/host` and uses the
  `RouteProvider` interface as it is; do not change that interface.

## Acceptance

- `npm run bench` routes per second on the grid and the town within 20 percent of the
  TASK-057 figures above, measured on an idle machine and reported next to a run of the
  current `main` on the same machine; the town's 24 h and morning step rates recover
  accordingly.
- `bench/latest.log` route hash and the four state hashes unchanged (grid 1639643273,
  scaled 3254820089, stress 1071430910, town 3932636798); `npm run route-audit` zero on the
  grid, the town, Sindelfingen and Munich; the Munich probe keeps every connector pair
  routable and zero failed trips.
- `npm run check` green; `npm run test:e2e` green.

## Commands

`npm run check`, `npm run test:e2e`, `npm run bench` (and `npm run bench -- --routes-only`),
`npm run route-audit -- <project or osm file ...>`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148`.

## Deliverable

PR with the router change, the regression test, the before and after benchmark table on one
machine, and the hashes.
