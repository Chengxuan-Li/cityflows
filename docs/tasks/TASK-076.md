# TASK-076 — Cars reach their exit: lane choice, cooperative gaps, giving up a missed change

Owner: unassigned
Gate: 5 (owner finding 2026-11-05, round 2, point 3)
Depends on: TASK-032, TASK-048, TASK-071, TASK-072. Design: `docs/architecture.md` section 7
(lane resolution, TASK-076), section 8 (mandatory lane changes, TASK-076, and the new
`SimParams` fields), section 14 (T29). Read those before the code.

## Goal

The owner sees cars on Munich's main roads that stop and wait instead of turning into the
exit road they are bound for, and the city ends in gridlock. The lead traced it (stall probe
on `main` at ce4e3f8, Munich at 0.15, 07:00 to 10:00): the first cars to stand still for
three minutes are all on a lane that is not one of their route's target lanes, at the end of
a short ramp, waiting for a mandatory change. At 07:04, with 80 cars on the network, ramp
`r:639` (99 m, three lanes, each with one movement at signal `n:638`) has a stationary queue
on lane 1 of cars bound for `r:680`, which only lane 2 serves; lane 2 moves, but no gap ever
opens for them. Upstream, `r:1299#1` has movements into both `r:639#1` and `r:639#2`, and
lane resolution picks `r:639#1` because the two have the same penalty, so the route itself
plans the change. The same pattern is at `r:968#2` (signal `n:967`), `r:884#1` (`n:883`) and
`r:1299#0` (`n:637`). By 08:00 the queues reach the junctions upstream; from 09:30 all 2 241
cars on the network stand still and completions stop at 2 008. The run before wave 15
(b2131fe) locks the same way, so this is old.

Fix the three causes: resolve lanes so a route does not plan a change it can avoid, have the
car behind make room for a car held for a mandatory change, and let a held car give up after
`missedTurnAfterS` and take a legal movement with a reroute, as the architecture already
promises for missed turns.

## In scope

- `src/routing/lanes.ts`: the section 7 TASK-076 rule (movement choice per lane by fewest
  changes after it, then penalty, then idx; the forward pass tries reachable lanes by fewest
  changes first). The lane-level fallback in `lane-search.ts` only if it shares the code.
- `src/sim/lane-change.ts`: cooperative yield (requester, one yielder per requester, the
  yielder's virtual leader) and the give-up timer.
- `src/sim/engine.ts`: where the yielder's virtual leader enters the car-following pass, and
  where a give-up takes the fallback movement in `planLane` and reroutes with `missed_turn`.
  Do not reorder the step; TASK-077 builds on this file after you.
- `src/sim/merge.ts` only if the diverge hold is implemented there.
- `bench/import-probe.ts`: `probeMorning` also returns `completedByHalfHour` (completions in
  each 30 minutes) and `stalledHeads` (driving vehicles at the end that are first on their
  lane or on a movement and have not moved for 300 s).
- Tests: `tests/sim/T29-mandatory-changes.test.ts`, routing tests for the lane choice, and
  existing expectations that move (name each in the report).

## Out of scope

- The commit step, vehicle removal, metrics, snapshots, `src/host`, `src/render` (TASK-077, next),
  `src/network`, `src/importers`, `src/ui`.
- `src/schema` and the defaults in `src/sim/params.ts`: the lead added `cooperativeYieldS`
  (3 s) and `missedTurnAfterS` (30 s). If they do not work as specified, stop and report.

## T29 (unit)

1. Lane choice: on a fixture shaped like `r:1299` into `r:639` (a two-lane road whose right
   lane has through movements into lanes 1 and 2 of a three-lane ramp, where only lane 2
   serves the route's next road), the route's movement lands in lane 2, and the route's
   target lanes need no change on the ramp. The `shortTurnLane` and `bypass` routes keep
   their roads.
2. Cooperative yield: a car held at the end of a lane for a mandatory change beside a steady
   platoon (headway 1.5 s) gets into the target lane within `cooperativeYieldS` plus 10 s;
   the yielding follower never brakes harder than `bMps2`, and T07's braking bound holds.
3. Give-up: when the target lane is blocked for good (a stationary queue to its end), the
   held car takes a legal movement from its own lane after `missedTurnAfterS`, its
   `routeReason` becomes `missed_turn`, and it reaches its destination by the new route.
4. Munich at 0.15 (headless, may be marked slow): from 07:00 to 10:00 no vehicle off its
   target lanes stands still longer than `missedTurnAfterS` plus 10 s, and none of
   `r:639`, `r:1299`, `r:968`, `r:884` holds a car for longer.

## Acceptance

- T29 passes; T07, T08, T13, T21, T22, T25, T26 and the ramp, lane-drop and missed-turn tests
  keep their intent.
- Hashes change: report the four new benchmark hashes with completed and failed counts
  (completed may not fall, failed stays zero).
- Munich at `--scale 0.15`: report completed, failed, peak, `completedByHalfHour` and
  `stalledHeads` against main (2 008 completed, 2 241 stalled at 10:00, no completions after
  09:30). Completed must rise. Say plainly whether the city still locks, and if it does,
  where the first stalls now are (the lead's probe classified them by lane, target and next
  turn; do the same).
- `npm run route-audit` stays at zero on all four cities.
- `npm run check` green; `npm run test:e2e` green on a port of your own (T16 may be skipped).

## Commands

`npm run check`, `npm run test:e2e -- --grep-invert T16` (set `CITYFLOWS_TEST_PORT`),
`npm run bench`, `npm run route-audit`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the T29 results, the hashes, the Munich numbers and where any remaining
stalls start, each changed test expectation and why, the final lines of `npm run check`, and
anything found on another surface. Commit your work in a git worktree of this repository;
the lead reviews only commits.
