# TASK-208 — Munich's remaining missed turns

Status: in progress (owner started it 2026-11-18). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/208-remaining-misses`, worktree `D:\cityflows-wt\208`, ports 5408 / 5508.

## Goal

TASK-204 (review in `docs/plan.md`, commit `bed2b91`, evidence scripts in
`D:\cityflows-wt\204-evidence`) cut the r:654 misses from 1,667 to 75 (actuated, choice off) and 2,156
to 344 (fixed). Three things are left:

1. The remaining r:654 misses come from cars entering on r:700 lane 0 (from r:1306 and r:53), two
   changes short.
2. With fixed-time signals, r:639 misses rose from 486 to 839: the jughandle queue now forms in
   r:697/r:698 lane 2 and backs into r:639 lane 2; r:639 is fed by r:1299, which has one car lane
   (lane 1 is bus-only), so turning cars must make two changes in 77 m.
3. TASK-204's first rule alone (take the route's planned chain) gridlocked Freiburg (12 trips, r:1348,
   1,773 s); with its second rule it passes. Find out why, because it may be a latent fault.

Measure each on main, find the cause, and fix it in general lane choice or lane changing, not by
curating Munich.

## Scope

`src/sim/lane-change.ts`, `src/sim/intersection.ts` entry chains, lane planning in `src/sim/**` and
`src/routing/**`, tests.

Out of scope: `src/schema`, signals, rail crossings, `src/network/**` geometry, gate floors,
`bench/traffic-baseline.json`, fixtures.

## Gates

- A unit test per cause fixed that fails without the fix.
- Misses at r:639 and r:654 per mode, before and after.
- Munich seeds 1 to 12, choice off and on, both modes, main against branch (completed / gridlocked /
  stalled / mean delay / worst loop visit; TASK-154's drain criterion); full demand both modes
  (references: actuated 3,345 / 177, hash 2229666949; fixed 3,210 / 166, hash 2820161686); Freiburg's
  and Sindelfingen's gates; the Munich gate and mode-share guard.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

If the results trade gains against losses, stop after measuring and report both tables: the owner
decides (the lead holds the branch).

## Report

Write it as the commit body: the three findings, the fixes, the tables.
