# TASK-072 — Stop lines and crossings on the road, before the junction

Owner: unassigned
Gate: 5 (owner finding 2026-11-05, point 2)
Depends on: TASK-063, TASK-064, TASK-065. Design: `docs/architecture.md` section 8 (stop
positions, `CLane.stopM`, the rules that use it), section 11 (TASK-072 crossing placement),
section 14 (T26). Read those before the code.

## Goal

Pedestrian crossings are drawn inside the junction: TASK-063 put them just past the lane
end, because a waiting car stops 2 m before the lane end and would otherwise stand on the
crossing. Real streets have stop line, then crossing, then the junction. Give each lane a
stop position `stopM`, 3 m before its end where its approach has a crossing, make every
ungranted-car rule use it, and draw the crossing on the road between the stop line and the
lane end.

## In scope

- `src/network/stops.ts` (new): `stopM` per lane by the section 8 rule (the crossing rule is
  the one `approachMarkings` uses today: a signalized approach with a served movement; no
  crossing on lanes shorter than 10 m); called from `compile.ts` (one line).
- `src/network/types.ts`, additive: `CLane.stopM`. TASK-071 adds other fields to the same
  file in parallel; keep yours together and do not touch theirs.
- `src/sim`: every place that uses the lane end as an ungranted stop line uses `stopM`
  (standing obstacle, commit clamp, stop-sign standing time, entry request distance,
  junction waiting, yield and stop gap distances; `intersection.ts`, `engine.ts`, `merge.ts`
  where they read the lane end for those rules). Granted travel, movements and zones
  unchanged.
- `src/render/layers/roads.ts`: `drawApproachMarkings` (stop line at `stopM`) and
  `crossingStripes` (on the road per section 11, the exit-side crossing on the exit road);
  `src/render/scene.ts` if crossings move between graphics layers. Do not edit `drawRoad`'s
  divider loop (TASK-071).
- `src/ui/drawn-snapshot.ts` and the vehicle inspector's waiting reason only if they read the
  lane end as the stop line.
- Tests: `tests/sim/T26-stop-positions.test.ts` and `tests/render` for placement; existing
  `tests/sim` and `tests/render` expectations that move (name each in the report).

## Out of scope

- `src/network/lanes.ts`, `junctions.ts`, `movements.ts`, `continuity.ts` (TASK-071 runs in
  parallel there), `src/routing`, `src/importers`, `src/ui` beyond the lines above.

## T26 (unit)

1. On the four-way signal fixture, a car waiting at red stops with its front `minGapM` behind
   `stopM`, so it is clear of the crossing; on green it drives through to the movement as
   before.
2. A stop-sign approach without a crossing keeps `stopM = lengthM` and its one-second rule;
   a yield gap is measured to `stopM` of the approaching major lane.
3. Placement: the stop line is at `stopM`, every crossing stripe lies between `stopM` and
   `lengthM` on the road (inside the road surface, outside the junction outline), and the
   exit-side crossing lies on the exit road's first 3 m.
4. T21's sampled safety still holds on the four-way signal, the grid and the Munich morning.

## Acceptance

- T26 passes; T13, T21, T22 and the signal, yield, stop and turn-on-red tests keep their intent.
- Hashes change: report the four new hashes with completed and failed counts (completed may
  not fall, failed stays zero) and Munich at `--scale 0.15` against main's 2 175.
- Screenshots: a grid signal and a Munich signal junction with queues at red, crossings on
  the road, cars behind the stop lines.
- `npm run check` green; `npm run test:e2e` green on a port of your own (T16 may be skipped).

## Commands

`npm run check`, `npm run test:e2e -- --grep-invert T16` (set `CITYFLOWS_TEST_PORT`),
`npm run bench`, `npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the T26 results, the hashes and Munich numbers, each changed test
expectation and why, the screenshot paths, the final lines of `npm run check`, and anything
found on another surface. Commit your work in a git worktree of this repository; the lead
reviews only commits.
