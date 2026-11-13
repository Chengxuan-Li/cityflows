# TASK-154 — Land TASK-131 Phase 3 and drain the Landsberger loop (B56)

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch `task/154-b56`,
worktree `D:\cityflows-wt\154`, ports 5354 (production 5454). The owner released B56 on
2026-11-13. It is the blocker for PR #1: TASK-151 found PR #1's loss at the two Landsberger tram
crossings inside the loop.

## Starting point

Read TASK-131.md's Phase 3 section and every review entry headed "TASK-131 Phase 3 / B56" (all
2026-11-12), plus the TASK-130 and TASK-151 entries.

The integrated local candidate `4ab4d71` (`task/lead-131-candidate`; its simulation is identical
to `62cd578`) carries five pieces:
- exit reservation capped at the lane's physical length;
- reserved-lane passing to the mandatory lane-change logic;
- downstream lane choice;
- the shared-lane early head release;
- the bounded roadside courtesy (`src/sim/origin-courtesy.ts`).

TASK-143 is already on main. On the candidate's old base it measured:
- completed 4,720 / 4,879 / 4,443 over seeds 1 to 3 (that main: 4,113 / 3,994 / 3,245);
- gridlocked 4 / 2 / 5;
- 0 stalled heads and 0 parking failures;
- no sustained cycle on the six-road dependency probe, and no car on an inner link at 10:00.

It was not merged for two reasons:
- **Step time:** Munich +8.73%, against the 5% B56 limit; Sindelfingen +12.07%, against 10%.
- **The 900 s criterion:** the peak cumulative trip wait among cars on the six loop roads stayed at
  6,073 / 6,882 / 5,762 s. The review found that most of it was carried in from origins (garage
  p:1664's exit at c:1665) and earlier junctions, not gained on the loop. The car carrying 6,073 s
  on r:364 added zero seconds during that visit.

Main has since gained TASK-144, 148, 149 and TASK-150 (exit hold). TASK-152 (aisle-road lot
exits) and TASK-153 (lot admission) are running in parallel and touch parking code.

## Work

1. Merge `task/lead-131-candidate` into your branch, which starts at main. Resolve conflicts with
   TASK-149 and TASK-150 in parking and engine code, keeping both sides' guarantees. Recompute pins
   from test output. Measure seeds 1 to 3.
2. Get step time within budget: Munich at most +5% and Sindelfingen at most +10% against main.
   Measure warm runs side by side, alternating the order (the candidate review's method). Profile
   with `node --cpu-prof` on a `bench/` script and diff self time per function against main. Use
   exact rewrites, proven by unchanged simulation hashes before and after. A policy may be dropped
   only if its traffic value is measured and reported.
3. Use the drain criterion the lead fixes here for B56. The whole-trip figure stays reported but no
   longer gates. On seeds 1 to 3:
   - (a) the six-road dependency probe finds no sustained cycle;
   - (b) no car's wait accumulated within a single visit to one of the six loop roads exceeds
     900 s;
   - (c) no car stands on an inner link longer than `boxWaitS` at 10:00;
   - (d) zero stalled heads.

   If (b) fails, trace the car and fix the cause within scope.
4. Check PR #1 on top. Merge `task/151-pr1-gate` (main plus PR #1 with re-pinned hashes) into a
   scratch copy of your result, never into your branch, and run the seed-1 gate. Report the result,
   on-track time at Landsberger crossing facilities 1 and 2, and tram waits. Passing the gate here
   is the aim, but it doesn't block TASK-154.

## Must stay true

- Signal, walker, access, lane-change and parking safety: T21, T53 (6% live limit, report the
  cost), T54, T59, T63, T66, T68, T77.
- Routing contracts: the routing changes tried on 2026-11-12 were rejected, so don't bring them
  back.
- Determinism. Every moved hash is explained.

## In scope

`src/sim/**` except `src/sim/parking.ts` admission and claims (TASK-153), focused tests,
`docs/architecture.md` sections 7 and 8, and this file's findings.

## Out of scope

- The importer and network (TASK-152).
- `src/demand/**`.
- The renderer.
- `bench/traffic-baseline.json` and gate floors. The lead resets the baseline at the merge if the
  owner agrees.
- Routing policy changes.

## Gates

1. Seed-1 gate unchanged: at least 3,702 completed, at most 39 gridlocked, 0 stalled heads, 0
   parking failures; T63 at least 3,571. Report seeds 2 and 3.
2. The drain criterion (a) to (d) on seeds 1 to 3, with the six loop-road waits per seed. Report
   both the per-visit and the whole-trip figures.
3. Step time within budget, with the profile diff.
4. `npm run check`, `test:city`, `test:e2e:light` on port 5354, and the named tests above.
5. The PR #1 check (work step 4), reported.
6. Shots of the Landsberger loop at 09:30 on main and on the branch, in 2D, in
   `D:\cityflows-wt\154-evidence\`.

## Report

Write it as the commit body:
- what was merged and resolved;
- each policy's measured value;
- the step-time work;
- the drain criterion per seed;
- the gate;
- the PR #1 check;
- hashes moved and why;
- files touched;
- anything left open.

## Findings (2026-11-13)

- Merged `4ab4d71` onto main `cca7dc3`; two add/add conflicts (TASK-149 `chooseParkingFrom`,
  TASK-150 `holdProgress`/`joinStation`), both sides kept. On main the candidate alone gave
  4,071 / 3,972 / 4,122 completed, 1 / 2 / 0 stalled heads (gate failed on seed 1).
- Group entries now time a distant member conflict like `canGrant` (section 8). Seeds 1 to 3:
  4,224 / 4,134 / 3,825 completed, 6 / 11 / 8 gridlocked, 0 stalled heads, no inferred cycle.
- Drain criterion: (a) and (d) hold on all seeds. (b) fails: r:961 per-visit peaks 1,803 /
  1,785 / 1,544 s (group 10 gives r:961's right turn 15 s per 120 s cycle while the always-clear
  inner stream from r:964/r:968 crosses r:961's through movements); r:997 and r:273 exceed 900 s
  on seeds 1 and 2 behind the pk:2049 lot standoff on r:663/r:639 (TASK-153). (c) fails on seeds 2
  and 3 (3 and 1 inner cars over `boxWaitS` at 10:00).
- Seed 1 has one parking failure on `r:669#0` (TASK-153's van 2796 mechanism).
- PR #1 on top passes the seed-1 gate: 3,818 / 8 / 0 / 0.
