# TASK-077 — Gridlock recovery: a car stuck at the head of a jam fades and starts again

Owner: unassigned
Gate: 5 (owner finding 2026-11-05, round 2, point 4)
Depends on: TASK-064, TASK-065, TASK-072, TASK-076 (starts once TASK-076 is merged: both
change `src/sim`, which the plan never runs in parallel). Design: `docs/architecture.md` section 1 row 10
(the owner-approved exception), section 8 (gridlock recovery, TASK-077, and the new
`SimParams.gridlock`, `Metrics.respawns`, `VehicleSnapshot.fade`, `VehicleDetail.respawns`,
fail reason `gridlocked`, route reason `respawn`), section 11 (fading cars), section 14 (T30).
Read those before the code.

## Goal

Munich gridlocks at the default demand: from 09:30 every car stands still. TASK-076 removes
the cause the lead found, but any jam that closes into a loop (a junction box, a ring of
queues) can still lock a city for good. Real drivers find a way out; the model needs a
general escape. As in SUMO's time-to-teleport, but the way the owner asked for it: a car
that has stood at the head of a jam for `gridlock.respawnS` (180 s) fades out over
`gridlock.fadeS` (5 s), leaves the road, and its trip starts again from its origin. The
lost time stays in the trip's travel time and delay, and the run counts every respawn.

## In scope

- `src/sim/engine.ts`: the jam-head timer, the fade value, and the removal in the commit
  (release grants and zone occupancy, take the car off its lane or movement, hand the trip
  back). Keep TASK-076's proposal pass, `planLane` and lane-change rules as merged.
- `src/sim/connectors.ts`: a respawned trip rejoins its origin connector's queue by its
  original departure time, and gets a fresh route at release.
- `src/sim/intersection.ts`: releasing a removed car's grant and zone occupancy, if
  `release` does not already cover it.
- `src/sim/vehicle.ts`, `src/sim/metrics.ts`, `src/sim/types.ts`: the timer, `respawns` per
  trip and in `Metrics`, `fade` in the snapshot, `gridlocked` and `respawn`.
- `src/host` (the worker's snapshot transfer and its type) and `src/render/types.ts`,
  `src/render/layers/vehicles.ts`: cars drawn with alpha `fade`.
- `src/ui`: the vehicle inspector shows the route reason `respawn` and the respawn count; the
  run summary or Metrics panel shows `respawns` where it lists failed trips. Exports include
  the per-trip respawn count as a column where they list trips.
- `bench/import-probe.ts`: one field, `respawns`, in `probeMorning`'s result, beside
  TASK-076's `completedByHalfHour` and `stalledHeads`.
- Tests: `tests/sim/T30-gridlock.test.ts`, the snapshot and render tests that read its
  fields, and existing expectations that move (name each in the report).

## Out of scope

- The proposal pass, `planLane`, `lane-change.ts`, `merge.ts`, `src/routing` (TASK-076's),
  `src/network`, `src/importers`, the render layers other than vehicles.
- `src/schema` and the defaults in `src/sim/params.ts`: the lead added `gridlock`
  (`respawnS` 180, `fadeS` 5, `maxRespawns` 3). If they do not work as specified, stop and
  report.

## T30 (unit)

1. A built deadlock (for example four one-lane roads in a square, each junction's exit full,
   filled so that every head car waits for the next) unlocks: the first jam head fades from
   1 to 0 over the 5 s before 180 s, is removed at 180 s, its trip is `queued_origin` at its
   origin connector with `respawns` 1, and the remaining cars move again.
2. A car at a red light, or behind another car, never accumulates jam-head time; a car that
   moves resets its timer and its fade returns to 1.
3. After `maxRespawns`, the next respawn fails the trip with `gridlocked` instead.
4. Accounting: T01's trip sums hold at every step through respawns, `Metrics.respawns`
   equals the sum of per-trip counts, and T02's determinism holds (same respawns at the same
   steps, same hashes).
5. A respawned trip completes with `departedS` equal to its first departure, so its travel
   time includes the stall.

## Acceptance

- T30 passes; T01, T02, T07, T08, T13, T21, T22, T26 keep their intent.
- Benchmark: report the four hashes with completed, failed and respawns (respawns on the
  normal grid expected 0; say why if not).
- Munich at `--scale 0.15`: report completed, failed, peak, respawns, `completedByHalfHour`
  and `stalledHeads` against main after TASK-076. Completions must continue in every half
  hour to 10:00, and `stalledHeads` must be 0.
- In the browser: Munich at 0.15 run to 09:30 at high speed, a fading car seen and a
  screenshot of it; no car stays frozen at a junction head past 3 minutes of simulated time.
- `npm run check` green; `npm run test:e2e` green on a port of your own (T16 may be skipped).

## Commands

`npm run check`, `npm run test:e2e -- --grep-invert T16` (set `CITYFLOWS_TEST_PORT`),
`npm run bench`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the T30 results, the hashes and Munich numbers with respawn counts, each
changed test expectation and why, the screenshot path, the final lines of `npm run check`,
and anything found on another surface. Commit your work in a git worktree of this
repository; the lead reviews only commits.
