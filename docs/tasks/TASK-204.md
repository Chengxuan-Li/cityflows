# TASK-204 — Munich's missed turns at the jughandle

Status: in progress (owner started it 2026-11-18). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/204-jughandle-lanes`, worktree `D:\cityflows-wt\204`, ports 5404 / 5504.

## Goal

TASK-193's review: cars that cannot reach the right lane at r:639 (right to r:680) or r:654 (straight
to r:715) miss the turn and are rerouted round a 2.5 km lap (r:663, the ring, n:263, the loop, its
exit) back onto the same approach; on seed 7 fixed-time, 307 of the 319 cars turning onto r:663 were
missed turns. TASK-193 made the reroute avoid driving the lap twice; the misses still happen. From
r:654 lane 1 the only way on is the ring, so the lane has to be chosen earlier, on the jughandle and
the roads before it. TASK-194 named this the likely lever for full-demand throughput in both signal
modes.

1. Measure the misses on main: per seed (1 to 12, both modes, choice off), how many cars miss at
   r:639 and r:654, where they were when the lane change became impossible, and why (no gap, a lane
   chosen too late, a short weaving section).
2. Fix the general cause in lane choice and lane changing (`src/sim/lane-change.ts`, the route's lane
   plan), so a car prepares for a turn that needs a lane far enough ahead given the roads before it,
   not by curating Munich's network.
3. Measure the effect.

n:635's empty phase is out: TASK-194 tried dropping it and rejected that. Mention it only if this fix
changes that picture.

## Scope

`src/sim/lane-change.ts`, lane planning in `src/sim/**` and `src/routing/**` where the lane plan is
made, tests.

Out of scope: `src/schema`, signals (`src/sim/signals.ts`, `signal-program.ts`), gate floors,
`bench/traffic-baseline.json` (if completions move more than 10% the lead decides on a reset with the
owner), the fixtures.

## Gates

- A unit test: a car that must turn from a lane it can only reach well before the junction changes
  lanes in time on a small fixture; it misses without the fix.
- Munich seeds 1 to 12, choice off and on, both modes, main against branch: completed / gridlocked /
  stalled / mean delay / worst loop visit, misses at r:639 and r:654; TASK-154's drain criterion (no
  loop visit over 900 s) on all 48 runs; full demand both modes (references: actuated 2,997 / 160,
  hash 2745499315; fixed 2,859 / 181, hash 628103954).
- Freiburg's gate; the Munich gate and mode-share guard; `npm run check`, `test:city`,
  `test:traffic:light`, `test:e2e:light`.

If the results trade gains against losses (as TASK-199's did), stop after measuring and report both
tables; the owner decides.

## Report

Write it as the commit body: the miss counts before and after, the cause, the fix, and both tables.
