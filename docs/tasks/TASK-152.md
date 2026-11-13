# TASK-152 — Lots whose aisles are roads: leave the bay into the aisle, not along it

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/152-aisle-road-exits`, worktree `D:\cityflows-wt\152`, ports 5352 (production 5452).
Started 2026-11-13 under the owner's batch plan.

## Problem

TASK-150 holds an exiting lot car at the farthest drive-out pose whose body is clear of the exit
lane. At some lots no such pose exists, because the stalls line an aisle that is itself a road in
the vehicle graph (`parking_aisle` service roads, TASK-104/144/149, architecture "aisles"). The
drive-out then runs inside the exit lane up to the connector, and the car waits in the lane band.
In seed 1, TASK-150 counted stall-to-exit pairs with no clear pose:

| Lot | Pairs |
|---|---|
| Munich pk:2052 | 62 |
| Munich pk:2053 | 40 |
| Munich pk:2054 | 33 |
| Munich pk:2057 | 1 |
| Sindelfingen pk:1487 | 6 |

TASK-150 also reported that where the drive-out runs inside the lane against its direction, the
merge draws as a tight U-turn on the spot. And at pk:2050, 2052, 2053 and 2054 (Munich) and
pk:1484, 1487 and 1494 (Sindelfingen), cars join up to 56 m before the connector.

A car in a bay beside a drivable aisle should do what a car leaving a kerbside space does. It takes
a gap in the aisle lane next to its own bay, manoeuvres out into that lane, and then drives the
aisle as an ordinary vehicle to the mouth. It should not glide along the lane as a motion that
other traffic can't see.

## Goal

For every bay whose drive-out would run inside a vehicle-graph lane:
- the car leaves into that lane at its own bay, by the kerbside (strip-like) departure rule, which
  takes its gap before it leaves the bay;
- it then drives the aisle as a lane vehicle, on a legal route.

No lot exit waits inside a lane band, and none draws an in-place U-turn. Lots whose aisles aren't
roads keep TASK-150's hold.

## Approach

Prefer to fix this in network and parking compilation:
- `src/network/parking.ts`;
- the lot portal and connector code in `src/importers/osm/parking.ts`;
- the bay's departure connector, which should be the aisle-lane station beside the bay, with
  direction and legality checked.

The simulation already supports kerbside departures. Change `src/sim/parking.ts` or `engine.ts`
only as much as the switch needs, and list every such line in the report. TASK-151 is editing
those files in parallel, and the lead reconciles the two at merge.

## Must stay true

- TASK-149's legal mouths, directions and vehicle permissions, including private aisles and the
  2.1 m height limit.
- Reachable-bay claims and the shared-mouth yield.
- The 192 historical route records: compare them as TASK-149 did.
- Determinism. Any hash that moves is explained by the new departure connectors only.

## Out of scope

- Crossings and rail (PR #1 and TASK-151).
- `src/demand/**` (TASK-129, TASK-113).
- The traffic gate and its floors.
- The admission wait at pk:2049 (TASK-153).

## Gates

1. A census in both cities: zero bay-to-exit pairs that hold inside a lane band, and zero in-place
   U-turn merges. List every bay that changed rule, per lot.
2. A focused regression test: a bay beside a two-way and a one-way aisle road.
   - The car takes its gap before leaving.
   - A through car in the aisle never overlaps it.
   - It leaves in the legal direction only.
   - It completes its trip.
3. T77, T54, T59, T63 and `tests/importers/lot-access.city.test.ts` pass, and the route records
   match.
4. Munich seed-1 gate unchanged: at least 3,702 completed, at most 39 gridlocked, 0 stalled heads,
   0 parking failures. Report seeds 2 and 3 as diagnostics.
5. `npm run check`, `test:city`, and `test:e2e:light` with `CITYFLOWS_TEST_PORT=5352`.
6. Shots of pk:2052 and pk:2053, 2D and 3D, before and after, showing a car leaving its bay into
   the aisle. Keep evidence in `D:\cityflows-wt\152-evidence\` (Playwright wipes `test-results`).

## Report

Write it as the commit body:
- the cause as found;
- the rule as built;
- the census before and after;
- each gate with its numbers;
- hashes moved and why;
- files touched beyond the approach list;
- anything left open.
