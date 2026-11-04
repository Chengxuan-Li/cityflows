# TASK-064 — Conflict zones instead of whole-movement conflicts

Owner: unassigned
Gate: 5 (owner backlog B26)
Depends on: TASK-049, TASK-051, TASK-057, TASK-061. Design: `docs/architecture.md` section
5.3 (the TASK-064 conflict zones), section 8 (the resolution step as amended by TASK-064),
section 14 (T21). Read those before the code.

## Goal

A car on a movement blocks every conflicting movement until it has left the movement, however
long the movement is and wherever the paths actually cross. That makes junction throughput
depend on how far apart the stop lines are, which is why TASK-061 had to cap setbacks at
10 m: without the cap, acute Munich approaches got 50 to 115 m movements and the morning
lost 40 percent of its completed trips. With the cap, cars at acute approaches stop 10 m out
with the lane blocks still overlapping in front of them, which the owner sees as cars
stopping away from the junction (B26). Resolve conflicts where they happen: a vehicle blocks
a conflicting movement only until its rear has cleared the zone where the two paths are in
contact, and yield gaps are measured to that zone. Then the cap can go.

## In scope

- `src/network/conflicts.ts` (compute `conflictZones` per 5.3), `src/network/types.ts`
  (`CMovement.conflictZones`, additive), `tests/network/conflict-zones.test.ts` (new).
- `src/sim/intersection.ts` (the grant check per section 8: grants on the approach and
  occupants before the zone end block; occupants past it do not; yield and stop gaps to the
  zone start), `src/sim/engine.ts` only where it reads `occupancy` for conflicts, `src/sim/merge.ts`
  only if a merge needs the zone, `src/sim/patch.ts` only to carry the new field through a live
  patch, `tests/sim` (T21 and any test whose numbers move, each named in the report).
- `bench/` for a measurement script if useful.

## Out of scope

- `src/network/junctions.ts`, `lanes.ts`, `movements.ts`, the setback cap (TASK-063 owns the
  geometry files and runs in parallel; the lead lifts the cap at merge), `src/render`, `src/ui`,
  `src/routing`, the importer, signal timing semantics.

## T21 (unit)

1. Safety: on the four-way signal, the grid, the junction fixture and the Munich morning at
   scale 0.15, sampled every step for the whole run, no two vehicles on conflicting movements
   are inside their contacting zones at the same time (a vehicle is inside from its front at
   `startM` until its rear passes `endM`).
2. Release: on a left turn across an opposing through movement, a car that has cleared the
   zone lets the opposing queue go while it is still on the movement; before this task the
   same scenario holds the queue until the car leaves.
3. Yield gap: at a yield node with a long minor movement, the gap is measured to the zone
   start, so a minor car enters in front of a major car that will not reach the zone within
   `gapS`.
4. Zones: zone starts and ends on the junction fixture and the grid match hand-computed
   values within the sample spacing; same-exit conflicts end at `lengthM`.

## Acceptance

- T21 passes; T13 and the signal, yield, stop, turn-on-red and roundabout tests keep their
  intent (state hashes change; name each updated expectation in the report).
- Every state hash changes: report the four new benchmark hashes with completed and failed
  counts; completed may not fall and failed stays zero on all four.
- Munich at scale 0.15, measured twice: with the cap as it is, and with `SETBACK_CAP_M` set to
  a very large value in your working tree only (do not commit that change; it lives in
  TASK-063's file). Report completed by 10:00, queued at origin and peak driving for both
  against wave 11's 2 078, 1 108 and 2 128. The goal for the lead's merge is that the uncapped
  run completes at least 2 078.
- `npm run route-audit` zero on the four cities; `npm run check` green; `npm run test:e2e`
  green on a port of your own; engine rates from `npm run bench` reported next to `main` on an
  idle machine.

## Commands

`npm run check`, `npm run test:e2e` (set `CITYFLOWS_TEST_PORT`), `npm run bench`,
`npm run route-audit -- <project or osm file ...>`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report (commit message body; no new Markdown files) with what works, what is not supported,
the T21 results, the hashes and counts, the two Munich runs, the bench rates and the final
lines of `npm run check`.
