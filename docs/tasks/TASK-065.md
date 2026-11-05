# TASK-065 — Zone reservations by time and a clear junction box

Owner: unassigned
Gate: 5 (owner backlog B27, B28; completes B26 with the lead's cap removal)
Depends on: TASK-064. Design: `docs/architecture.md` section 8 (`SimParams.intersection`
`zoneMarginS` and `boxWaitS`; the resolution step's TASK-065 rules for zone timing, the
zone-stop backstop and the junction box), section 14 (T21, T22). Read those before the code.

## Goal

TASK-064 lets a car stop blocking a crossing movement once its rear has cleared the zone
where the paths touch. A car that holds a grant but is still far from that zone, on its
approach or early on a long movement, still blocks every crossing car outright. That is why
removing the 10 m setback cap still costs Munich 40 percent of its morning trips (1 285
completed by 10:00 against 2 231 with the cap) and why cars at acute junctions still stop
well short of the junction (B26). Reserve zones by time instead: a granted car blocks a
crossing car only if it could reach the shared zone before the crossing car has left it,
with a margin. Back that up with a hard rule that no car enters a zone another car is
inside. Separately, the owner wants cars held back, not banned, from entering a junction
when they would likely wait inside it for the cars ahead (B28).

## Continuation review

The lead permits expected arrival from current speed and IDM acceleration in place of
full-throttle earliest arrival. Compare both ends of the predicted occupancy windows, so a
candidate may also follow a holder that will clear before it arrives. The occupied-zone
backstop remains mandatory, including a departing rear on an exit lane. Preserve the existing ramp
merge braking guarantees. Forecast approach and movement speed limits separately; braking
toward a lower desired speed must not imply a permanent stop in the reservation forecast.
The scenario Zod schema must supply the two new defaults when opening legacy projects.

## In scope

- `src/sim/intersection.ts`: the timed blocking test and the junction-box rule per section 8.
- `src/sim/engine.ts`: the zone-start standing obstacle for a car on a movement and its
  clamp in the commit, the `zoneStops` counter; `src/sim/types.ts` and `src/sim/metrics.ts`
  for `Metrics.zoneStops` (additive).
- `src/schema/sim.ts`, `src/schema/demand.schema.ts` and `src/sim/params.ts`: `intersection.zoneMarginS` (1.0) and
  `intersection.boxWaitS` (10), additive with defaults, as in section 8.
- Tests: `tests/sim/T22-zone-timing.test.ts` (new), `tests/sim/T21-conflict-zones.test.ts`
  (keep its safety sampling, now with the backstop), any `tests/sim` expectation that moves
  (name each in the report).
- `bench/` for a measurement script if useful.

## Out of scope

- `src/network` (zones are computed already; the setback cap lives in
  `src/network/junctions.ts` and the lead lifts it at merge), `src/importers` (TASK-066 runs
  in parallel there and changes the imported geometry), `src/render`, `src/ui`, `src/routing`,
  `tests/importers`, `tests/network`, `.github`, `vite.config.ts`.

## T22 (unit)

1. Far grant: on the four-way signal fixture, a car granted for a left turn but still 40 m
   from its zone does not stop an opposing through car that clears the zone well before the
   left turner can arrive; before this task it does.
2. Margin: the same scenario with the through car slow enough that its exit comes within
   `zoneMarginS` of the turner's expected arrival is refused.
3. Backstop: when a car is inside a zone, a car on the conflicting movement approaching the
   zone stops at the zone start, and `zoneStops` counts it; T21's sampled safety (no two cars
   inside contacting zones at once) still holds on the four-way signal, the junction fixture,
   the grid and the Munich morning at scale 0.15.
4. Box: a candidate whose exit lane's last car is stopped one car length past the lane start
   is not granted and waits at the stop line; after `boxWaitS` it is granted under the older
   rule; a moving exit queue whose projected rear leaves room is granted at once.

## Acceptance

- T22 passes; T21, T13 and the signal, yield, stop, turn-on-red, roundabout and live-edit tests
  keep their intent.
- `npm run bench`: completed may not fall and failed stays zero on all four workloads; report
  the four hashes (they may change) and `zoneStops` per workload.
- Munich at `--scale 0.15`, 07:00 to 10:00, twice: with the cap as committed, and with
  `SETBACK_CAP_M` set to a very large value in your working tree only (do not commit that; the
  file belongs to the lead and TASK-066 is in the importer). The merge goal is that the
  uncapped run completes at least as many trips as the capped one on your branch; report
  completed, queued at origin, peak driving and `zoneStops` for both.
- `npm run route-audit` zero on the four cities; `npm run check` green; `npm run test:e2e` green
  on a port of your own. Owner decision: skip long performance runs unless they block this.

## Commands

`npm run check`, `npm run test:e2e` (set `CITYFLOWS_TEST_PORT`), `npm run bench`,
`npm run route-audit -- <project or osm file ...>`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the T22 results, the bench table with hashes and `zoneStops`, the two
Munich runs, each changed test expectation and why, the final lines of `npm run check`, and
anything found on another surface.
