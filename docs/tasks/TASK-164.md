# TASK-164 — Remaining lot aisle holds and lot-entrance overlaps (departure side)

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/164-aisle-departures`, worktree `D:\cityflows-wt\164`, ports 5364 (production 5464).
Follow-up to TASK-156, queued on 2026-11-13.

## Problem

TASK-156 fixed pk:2050 and the arrival path. Its report left these on the departure and hold
side:

1. **pk:2056 (Munich, 48 holds in an aisle band):** a lane departure would reach the west exits
   but not mapped exit c:10872 onto r:669. Today a bay with a `departure` is offered only that
   departure, so switching it would repeat TASK-152's gate failure. `exits()` should offer the
   departure *and* any mapped exit the departure can't reach, and each exit should keep its share
   of the exit draw.
2. **pk:1487 (Sindelfingen, 180):** every hold is for exit c:2640, which has no car egress. The
   hold lands in an interior junction because `bodyClearLane` extends a lane's band past the lane's
   ends. TASK-157 added a lane-end-aware test; use it here, so that a hold inside an aisle band
   counts as unclear and TASK-152's "offered only when no other exit is" filter works.
3. **pk:1475 (Sindelfingen, 52):** the private aisles meet only private roads, so a lane departure
   isn't legal, and there is no hold pose clear of both lane bands at the passage. Find the right
   rule, for example a hold further back in the lot, or report why none fits.
4. **Private aisles:** a lot-bay departure can start onto, or just behind, an arriving car. Add the
   matching check in `departureRoom`.
5. **Street entrances (Munich, 63 pairs):** an arriving car releases the street lane while its body
   is still in it. Holding the lane as roadside strips do would change every lot entry. Measure it
   first: if holding until the body clears the lane band costs the gate, report it and don't apply
   it.

## In scope

- `src/sim/parking.ts`: `exits()`, `departureRoom`, the hold and lane-end band test, and the
  arrival lane release.
- `src/sim/manoeuvre.ts`.
- The exit callback in `src/sim/engine.ts`, if needed.
- `src/network/parking.ts`, for the departure connectors.
- Tests.
- `docs/architecture.md` section 8.

## Out of scope

- Intersection and signal rules.
- Demand (TASK-113).
- Rendering (TASK-160, TASK-162, TASK-163).
- The traffic gate and its floors.

## Gates

1. Census in both cities: aisle-band holds drop from Munich 48 and Sindelfingen 232 towards zero,
   with every remaining case listed and its cause given. Street-entrance overlaps are counted
   before and after.
2. A focused regression test for each item you fix.
3. TASK-149's route records byte-identical. T54, T59, T63, T77, T78, `far-lane-exit` and
   `lot-aisle-lanes` pass.
4. Munich seed-1 gate unchanged against the current baseline. Report seeds 2 and 3, and the
   difference from main.
5. `npm run check`, `test:city`, and `test:e2e:light` on port 5364.
6. Shots of pk:2056 and pk:1487, before and after, saved to `D:\cityflows-wt\164-evidence\`.

## Report

Write it as the commit body: per-item cause and rule, census, gates, hashes moved and why, files
touched, and anything left open.
