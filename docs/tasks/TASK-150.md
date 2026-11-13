# TASK-150 — Parking exit waits clear of the public lane

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/150-parking-exit-hold`, worktree `D:\cityflows-wt\150`, ports 5350 (production 5450).

## Problem

A car leaving a lot drives its `drive_out` path to the exit connector, which lies on the public
lane, and then waits there in the `exit` phase until `exit()` in `src/sim/engine.ts` finds a
spawn gap (`hasSpawnGap`) and a lot release. While it waits, its drawn body stands in the lane,
overlapping any through car at that station (`src/sim/parking.ts`, the `drive_out` → `exit`
transition near the end of `advance`). When the gap opens the car is inserted at the connector's
lane position at once, without a visible merge.

TASK-149's witness reproduces it on the authored parking fixture (`tests/parking-world.ts`, lot
`pk:13`). An ordinary through vehicle stands at the connector station while the gap is refused:
the exiting car's body overlaps it in 1,476 samples at 0.1 s, from 152.4 s, both before TASK-149
(`aa4006c`) and after. The witness script and its outputs are on this workstation, outside the
repo: `D:\cityflows-task149-evidence\legacy-merge-overlap.mjs`, `pre149-legacy-merge-overlap.json`
and `current-legacy-merge-overlap.json`.

## Goal

An exiting car waits at a hold pose whose body is clear of the public lane
(`bodyClearLane` in `src/sim/manoeuvre.ts`) until it is granted the lane. It then makes one
continuous merge into the lane. Through traffic keeps priority: a waiting car never takes a lane
station, never makes a through car brake, and never moves into the lane before its gap is granted.

## In scope

- `src/sim/parking.ts`: the drive-out path's end, the hold, and the transition from hold to lane.
- `src/sim/manoeuvre.ts`: the hold pose and the merge path.
- `src/sim/engine.ts`: the `exit` callback and insertion, and any merge animation state the
  engine and renderer need. Take care with snapshot sentinels such as `OFF_LANE` and the pose the
  renderer reads.
- The renderer's parking-motion pose read, only if the merge needs it.
- New test `tests/sim/T77-parking-exit-hold.test.ts`. T76 is taken on held PR #1.
- Additive updates to `tests/sim/T54-parking-motion.test.ts`, `T59-parking-egress.test.ts` and
  `T63-parking-claims.test.ts` if their expectations depend on the old exit pose.
- `docs/architecture.md` (section 8, parking motion), if the exit sequence it describes changes.

## Out of scope

- Parking access, mouth classification and `mappedPortals` (TASK-149, `src/importers/osm/**`).
- The held PR #1 branches (TASK-136, 138 and 147), TASK-128, 129 and 130, and TASK-131 Phase 3 / B56.
- The traffic gate and its floors (`bench/traffic-baseline.json`, T54 and T63 limits).
- Strip (kerbside) manoeuvres, unless the same defect is shown there. If it is, report it and
  don't change it.

## Rules

- Hold pose: the farthest point along the drive-out path where the whole body passes
  `bodyClearLane` against the exit lane. If no such point exists, use the path's last clear point
  and report the facility.
- The car keeps its claim and motion while it holds. Lot followers queue behind it as they do
  today, through the cohort logic in `advance`.
- Grant: use the same tests `exit()` uses today (spawn gap and lot release), checked from the
  hold. Reserve the lane gap before the body crosses the lane edge.
- Merge: animate the pose from the hold to the lane position continuously. No step may move it
  farther than the lot speed allows, `lotSpeedMps × dtS` plus 0.05 m. Its body counts as a lane
  occupant for the following cars from the moment of the grant.
- Determinism: same seed, same result. Simulation hash pins that move must be explained and
  re-pinned with the cause named. Route and timetable hashes must not move.

## Gates

1. T77, a focused two-car regression built from the witness:
   - while the gap is refused, zero samples where the body overlaps the through car and zero
     where it enters the lane;
   - the through car's speed profile is unchanged against a run with no exiting car;
   - once the gap opens, the car merges, every pose step meets the continuity limit, and it
     completes its trip;
   - a second car leaving the same lot queues behind the first without overlap.
2. Rerun the witness against the branch and keep its JSON beside TASK-149's evidence. It must
   report 0 overlap samples.
3. T54, T59 and T63 pass, along with the rest of the parking tests in `tests/sim/`.
4. Munich traffic gate, unchanged, seed 1 at 0.15 by 10:00: at least 3,702 completed, at most 39
   gridlocked, 0 stalled heads, 0 parking failures. Report seeds 2 and 3 as diagnostics.
5. Light tiers: `npm run check`, `test:city`, `test:traffic:light` and `test:e2e:light`, with
   `CITYFLOWS_TEST_PORT=5350`.
6. Shots, 2D and 3D, of one Munich lot mouth (pk:2049 or pk:2053), before and after, with a car
   holding and then merging. Keep them under the worktree's `test-results/task150/`, not tracked.

## Also report

TASK-149's review noted that an egress at the other pk:2049 ramp mouth can still delay admission
while it waits for public traffic. Measure whether the hold changes that: the longest admission
wait at pk:2049 before and after. Don't fix it here unless the hold fixes it.

## Report

Write the report in the commit body:
- what changed and why;
- the hold and merge rules as built;
- each gate with its numbers, and the witness before and after;
- any hash moved and why;
- the files touched beyond In scope;
- anything left open.
