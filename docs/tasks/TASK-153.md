# TASK-153 — Lot admission waits behind exiting cars (pk:2049)

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/153-lot-admission`, worktree `D:\cityflows-wt\153`, ports 5353 (production 5453). It starts in
batch 2, after TASK-151 has landed and the TASK-129 merge decision is made, because both touch
`src/sim/parking.ts`.

## Problem

TASK-149's review found that at Munich pk:2049 (way 106547917, mouths at OSM nodes 1461102990 and
4698232309, on `r:639`), an exiting car waiting for public traffic can delay admission at the other
ramp mouth. TASK-149 removed a 5,595 s circular wait. TASK-150 moved the exiting car off the lane.
On main seed 1 the longest admission wait is still 2,173 s and the longest exit wait 2,111 s, and
the mean lot leave time went from 229.5 s to 433.9 s.

## Goal

Find why arrivals wait so long at pk:2049, and whether other lots do the same: which rule holds the
arriving car, and for which departing car. Then repair the cause, so that admission and departure
at a lot both make progress. An arriving car must not wait on a departure that is itself waiting
for street traffic, unless the two physically need the same space.

## In scope

- `src/sim/parking.ts`: admission, claims, the shared-mouth yield and TASK-150's hold and grant.
- `src/sim/engine.ts`, only for the exit and admission callbacks.
- Tests under `tests/sim/`.
- `docs/architecture.md` section 8, where a rule changes.

## Out of scope

- The importer and lot geometry (TASK-149, TASK-152).
- Crossings and rail.
- `src/demand/**`.
- The traffic gate and its floors.

## Gates

1. A per-lot census for both cities, before and after:
   - longest and mean admission wait;
   - longest and mean exit wait;
   - mean lot leave time.

   pk:2049's longest admission wait must fall below 300 s. No lot may get worse by more than 10%.
2. A focused regression test that reproduces the pk:2049 pattern: two mouths, a departure waiting
   for a street gap, and an arrival at the other mouth.
3. T54, T59, T63, T77 and the lot-access city test pass.
4. Munich seed-1 gate unchanged: at least 3,702 completed, at most 39 gridlocked, 0 stalled heads,
   0 parking failures. Report seeds 2 and 3 as diagnostics.
5. `npm run check`, `test:city`, and `test:e2e:light` on port 5353.
6. Shots at pk:2049, before and after, showing an arrival entering while a departure waits.

## Report

Write it as the commit body: the mechanism with ids and times, the rule as built, the census, the
gates, hashes moved, files touched, and anything left open.
