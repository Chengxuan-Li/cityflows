# TASK-151 — PR #1 on today's main: find and repair the traffic gate failure

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch
`task/151-pr1-gate`, worktree `D:\cityflows-wt\151`, ports 5351 (production 5451). The owner asked
for this on 2026-11-13.

## Problem

Draft PR #1 (TASK-136 operating level crossings, TASK-138 scheduled trams, and TASK-147's repair)
passed the unchanged Munich gate on its own base: 3,719 completed, 37 gridlocked, 0 stalled heads.
Main since gained TASK-143, 144, 148, 149 (restored lot access, reachable-bay claims, shared-mouth
yield) and TASK-150 (parking exits hold clear of the lane). Main alone measures 3,928 / 36 / 0 / 0.

Merging the two (`6c8361c`, branch `task/lead-pr1-merge`) conflicts only in test hash pins: city
and compiled roads, lanes, movements and parking equal main's. Yet the unchanged gate on the
combination gives **3,300 completed, 49 gridlocked, 1 stalled head, 1 parking failure**. The
gate is at least 3,702, at most 39, 0 and 0. So an interaction between the crossing and tram
service rules and main's parking changes costs about 400 trips and creates a stall.

The branch starts as main, with TASK-150, plus `task/lead-pr1-merge` merged. Its first job is to
measure that base.

## Goal

Find the mechanism by which the combination loses trips: where, when, which vehicles and which
rule. Then repair it at its cause, so the combined tree passes the unchanged seed-1 gate with every
guarantee of both sides intact.

## Method

1. Measure the base. Run the seed-1 probe on main, on PR #1's own head (`eb7c089`) and on the
   branch, and compare:
   - completions over time;
   - gridlock failures by place (road, node, crossing, lot);
   - the stalled head;
   - the parking failure;
   - waits at crossings and lot mouths.
2. Find the first divergence that grows into the loss. Use the existing observers
   (`intersectionObserver`, parking claims, the crossing controller's state) and traces at 0.1 s
   where needed. Name the vehicles, roads, crossings and lots involved. TASK-147's mechanism,
   where an occupied crossing stretched a release guard, is a precedent: check whether it or a
   relative of it is back.
3. Repair the cause. Don't tune limits or delete behaviour. Every change needs a focused
   regression test in `tests/sim/` that fails before the change and passes after.

## Must stay true

- PR #1's contracts: crossing warning times, gates and lights, and the rule that no road vehicle
  stays on the tracks when a train or tram arrives. Also the scheduled tram service: stops,
  departures and timetable hash, plus TASK-147's interlock and egress guarantees, with zero
  contacts at mapped crossings in a 0.1 s physical replay.
- Main's parking contracts: TASK-149's legal entrances and reachable-bay claims, the shared-mouth
  yield, and TASK-150's hold clear of the lane, so T77's witness still shows 0 overlaps.
- Determinism. Route hashes and the timetable unchanged. Any simulation hash that moves is
  explained.

## In scope

`src/sim/**` (intersection, crossing control, rail service, parking, engine), tests under `tests/`,
`docs/architecture.md` only where a rule changes, and this task file's findings section.

## Out of scope

- The gate and its floors: `bench/traffic-baseline.json`, the limits in `tests/traffic/*`.
- The importer (`src/importers/**`), the renderer, and anything in TASK-128 or TASK-129
  (`src/demand/**` households and riders).
- B56 / TASK-131 Phase 3. If the loss turns out to be the Landsberger loop alone, with crossings
  and parking merely shifting it, stop and report the evidence instead of fixing B56.

## Gates

1. Seed-1 Munich gate with `npm run test:traffic:light`: at least 3,702 completed, at most 39
   gridlocked, 0 stalled heads, 0 parking failures; T63 at least 3,571; T21, T29 and T53 pass.
   Report seeds 2 and 3 for main and the branch as diagnostics.
2. `npm run check`, `test:city`, and `test:e2e:light` with `CITYFLOWS_TEST_PORT=5351`. Also every
   PR #1 test (T75, T76) and every parking test (T54, T59, T63, T77).
3. A physical replay at 0.1 s to 10:00, with zero contacts at mapped crossings, and service entries
   and exits counted as TASK-147 did.

## Report

Write it as the commit body:
- the mechanism, with evidence: ids, times and before/after counts;
- the repair and why it is general;
- the gate numbers;
- the regression tests;
- hashes moved and why;
- files touched;
- anything left open.

## Findings

Seed-1 probe (`bench/import-probe.ts` morning, 0.15), completed / gridlocked / stalled heads /
parking failures:

| Tree | Seed 1 | Seed 2 | Seed 3 |
| --- | --- | --- | --- |
| PR #1's base `89fc5d8` | 3964 / 32 / 0 / 0 | 3347 / 56 / 0 / 0 | 3624 / 34 / 0 / 0 |
| PR #1 `eb7c089` | 3719 / 37 / 0 / 0 | 3310 / 53 / 0 / 0 | 3116 / 38 / 1 / 0 |
| main `0b0e726` | 3903 / 36 / 0 / 0 | 3909 / 30 / 0 / 0 | 3169 / 50 / 0 / 0 |
| branch base `4855f09` | 3287 / 44 / 0 / 1 | 3248 / 56 / 0 / 0 | 3297 / 27 / 0 / 0 |

PR #1 costs its own base 245, 37 and 508 trips (mean 263); on today's main the combination costs
616, 661 and -128 (mean 383). The base-against-PR #1 difference is -432, -62 and +181: no
systematic interaction with main's parking rules. Toggling single rules on the base at seed 1
(diagnostic only): without the crossing controller 4215 / 35; without open-crossing storage
admission 3686 / 47 (per facility: Landsberger `r:269`/`r:252` +263, the other three +43 to
+86); without the shared-mouth yield 3306 / 54; without the rail-exit storage refusal 3066 / 77;
without the clearing-rails grant order 3137 / 62. Road vehicles stood still on the tracks of
open served crossings for 10197 s (`r:966`), 6534 s (`r:252`) and 3645 s (`r:728`) vehicle-time
on the base (PR #1: 8509, 5790, 2662): compact links wholly inside the road band, between two
signals on the B56 corridor (`r:966` feeds `r:703`).
