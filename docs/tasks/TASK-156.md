# TASK-156 — Lot aisles no lane vehicle can reach, and visible arrivals on aisle roads

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/156-unreachable-aisles`, worktree `D:\cityflows-wt\156`, ports 5356 (production 5456).
Queued on 2026-11-13. It starts once TASK-153 has merged.

## Problem

TASK-152 gave bays beside drivable aisle roads a departure into the aisle lane, and narrowed the
rule to the census lots. Two gaps remain, both from its report:

1. Some lot cars still hold inside aisle lanes that no lane vehicle can reach past their entry
   point: Munich pk:2050 and pk:2056, 68 pairs; Sindelfingen pk:1475 and pk:1487, 232 pairs. These
   cars wait inside a lane band that through traffic can't enter. The overlap can't be seen by
   traffic, but it's drawn and it's wrong.
2. Cars arriving at a lot still drive aisle roads as off-lane motions, invisible to lane vehicles.

TASK-152's first, wider version switched pk:2056 bays to lane departures. It failed the gate (3,675
completed / 50 gridlocked) by sending those cars through n:661 onto r:666, when the lot's mapped
exit c:10872 onto r:669 was the better way out. Any rule here must keep each car's legal and
cheapest real exit.

## Goal

Every lot car's hold and drive in an aisle that is a road either:
- happens as a lane vehicle where the lane is reachable; or
- stays clear of lane bands, where it can't be.

Arrivals on aisle roads stay consistent with whatever lane vehicles occupy.

## In scope

- `src/network/parking.ts` (`compileBayDepartures` and lot paths).
- `src/network/parking-egress.ts`.
- The arrival side of `src/sim/parking.ts` (`drive_in`), only as needed.
- Tests.

Coordinate with TASK-157, which runs in parallel on the departure hold and grant in
`src/sim/parking.ts` and `manoeuvre.ts`. Keep your sim edits to the arrival path and list them.

## Out of scope

- Intersections and engine flow (TASK-154).
- Gateway demand (TASK-155).
- The importer's lot geometry, unless a census fault needs it.
- The traffic gate and its floors.

## Gates

1. A census in both cities. Holds inside unreachable aisle lane bands go from 68 and 232 to 0.
   Count arrival motions overlapping a lane vehicle, before and after.
2. A focused regression test for each of the two problems.
3. TASK-149's 192 route records byte-identical. T77, T78, T54, T59 and T63 pass.
4. Munich seed-1 gate unchanged. Report seeds 2 and 3.
5. `npm run check`, `test:city`, and `test:e2e:light` on port 5356.
6. Shots of pk:2056 and pk:1475, before and after, saved to `D:\cityflows-wt\156-evidence\`.

## Report

Write it as the commit body: the cause, the rule, the census, the gates, hashes moved and why,
files touched, and anything left open.
