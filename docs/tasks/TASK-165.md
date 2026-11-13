# TASK-165 — Crosswalk safety at junction-group exits

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/165-crosswalk-clearance`, worktree `D:\cityflows-wt\165`, ports 5365 (production 5465).
Started on 2026-11-13 at the owner's decision, separate from TASK-113.

## Problem

With mode choice on (TASK-113), T53's crossing-safety check fails once in Munich at seed 1. Walker
8265 overlaps vehicle 2153 on `r:922#1`, the signal crossing at n:251 in junction group 10, at
07:55:55.9. The car had stood 180 s in a queue with its body across the exit-side crosswalk, and the
walker then got its green and stepped onto the occupied crossing. It doesn't happen on main with
the choice off, but the rule that allows it is latent there: any car that queues across an exit
crosswalk at a signal can be walked into.

## Goal

A crosswalk is never entered by a walker while a vehicle body stands on it, and vehicles don't
stop on a signalised exit crosswalk unless they are forced to. Two complementary rules, in order of
preference:

1. **Keep the crosswalk clear.** A car isn't admitted into a movement whose exit lane has no room
   for its whole body beyond the exit-side crosswalk. This is the same storage check TASK-154 and
   TASK-161 use for group exits, extended to the crosswalk's far edge.
2. **Walkers wait.** A walker with a green doesn't step onto a crossing span with a vehicle body on
   it. They wait at the kerb until it clears, the way vehicles yield to walkers already on the
   span.

Rule 2 is the safety net and must hold everywhere. Rule 1 reduces how often it is needed. Measure
the traffic cost of rule 1 before keeping it.

## In scope

- `src/sim/intersection.ts`: exit-storage admission measured past the crosswalk.
- `src/sim/walkers.ts` and the crossing and conflict code: the walker's entry check.
- Tests.
- `docs/architecture.md`, the sections on walkers and intersections.

## Out of scope

- Demand and mode choice (TASK-113).
- Parking (TASK-164).
- Rendering.
- The traffic gate and its floors.
- T53's limits.

## Gates

1. With mode choice on, using TASK-113's branch or main once it lands, T53's crossing-safety check
   passes on seeds 1 to 3. Prove it with the n:251 case at 07:55:55.9.
2. A focused regression test: a car queued across an exit crosswalk; the walker waits until it
   clears; then the walker crosses.
3. Munich seed-1 gate unchanged, with mode choice off as the gate runs. Report seeds 2 and 3, and
   rule 1's traffic cost if you keep it.
4. T53 (walker cost within its 6% limit, zone stops), T21, T66, T68, T75, `npm run check`,
   `test:city`, and `test:e2e:light` on port 5365.

## Report

Write it as the commit body: the mechanism, the rules as built, census counts (walker waits caused
by occupied spans, and cars admitted onto crosswalks before and after), gates, hashes, files, and
anything left open.
