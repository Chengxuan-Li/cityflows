# TASK-228 — The tram backlog: one delayed tram holds every unstarted one

Status: in progress (unsupervised run, owner 2026-11-19; started after TASK-225 merged).
Proposed owner: Claude Code subagent (Opus 5.5, high). Branch `task/228-tram-backlog`, worktree
`D:\cityflows-wt\228`, ports 5428 / 5528.

## Goal

TASK-225's diagnosis (its commit body on `task/225-siegesdenkmal-lock`, evidence in
`D:\cityflows-wt\225-evidence`) found that an unstarted tram waits while any running tram on any
section of its route is behind timetable (`delayedTracks`, `src/sim/rail-crossings.ts`). Departures
then queue back to back: Freiburg seed 1 at 31,300 s has 27 trams waiting at their start with lags up
to 2,971 s, seed 2 at 32,000 s 36 with lags to 4,391 s. Trams drawn on the landing page thin out and
bunch, and every waiting tram near a crossing is a lock risk.

1. Measure the backlog on main (Freiburg seeds 1 to 6, Munich 0.15 seed 1): trams waiting, lag
   distribution, service delivered against the timetable, by hour.
2. The smallest rule that keeps the track safety (no two trams on one block) without holding a
   service for a delay that does not reach its own path in time: for example, hold only for a
   delayed tram on the section the service enters next, or within its headway. Say which and why.
3. Re-measure, and show nothing else moves more than the merge rule allows.

## Scope

`src/sim/rail-crossings.ts` (service holds), `src/network/trains.ts` only if the timetable needs it,
tests.

Out of scope: `src/network` geometry, the importer, `src/schema`, gate floors,
`bench/traffic-baseline.json`.

## Gates

- A test for the rule that fails on main.
- The backlog figures before and after.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes
  (means: completed, gridlocked, mean delay, worst visit; drain criterion of TASK-154); full demand
  both modes (references: the latest "full-demand references" in `docs/plan.md`); Freiburg's gate;
  Sindelfingen; the Munich gate and mode-share guard.
- The owner's merge rule (plan, owner decisions log, 2026-11-19). If the first version misses, try
  one variant and report both tables; the lead decides.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

If your change moves the Freiburg project, rebuild it and re-pin, saying so; the lead rebuilds again
at the merge. No other fixture changes.

## Report

Write it as the commit body: the backlog, the rule, the figures; the traffic tables.
