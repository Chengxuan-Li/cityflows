# TASK-247 — Freiburg's 08:00 station peak: spillback at the Hauptbahnhof signals

Status: in progress (second unsupervised run, owner 2026-11-20). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/247-station-peak`, worktree `D:\cityflows-wt\247`, ports 5447 / 5547.

## Goal

Freiburg's gate run (0.15, seed 1) is bistable: a normal morning (about 78 s) or a jam at 08:00 (85 to
108 s), and almost any change tips it (TASK-239's node crossings 90.3 s; TASK-245's walker fixes 86 to
108 s; TASK-244's route load term did not remove it). TASK-244 located the jam: the waiting sits on both
Wilhelmstraße (`r:698`) and Schnewlinstraße (`r:805`, `r:807`, `r:441`, `r:1245`) at once, feeding the
signals at `n:364` (group 24) and `n:1132`, so it is peak load and spillback at the station's signals.
Reviews and evidence: TASK-239, 244, 245 in `docs/plan.md`; `D:\cityflows-wt\239-evidence\comb`,
`D:\cityflows-wt\244-evidence`, `D:\cityflows-wt\245-evidence`.

1. Reproduce the bad outcome on main (TASK-239's tip `6fd050e` or TASK-245's v1 `8bd8de0`, or main with
   one of their probes) and trace it at `n:364` and `n:1132`: phases, green split, actuated extensions
   and maximums, queue lengths and spillback into upstream junctions, box blocking, whether a short
   inner road between the signals fills and blocks the other direction.
2. The smallest general rule that removes the spillback lock (for example, actuated coordination of
   signals a short link joins, as TASK-222 did for crossings; box-blocking at a short inner road; a green
   that ends when its exit is full). Say which and why.
3. Show the outcome stops flipping: Freiburg seed 1 on main, on TASK-239's tip and on TASK-245's v1 all
   within a few seconds of each other; seeds 1 to 6 on main.

## Scope

`src/sim/signals.ts`, `src/sim/intersections.ts` or wherever box blocking and junction admission live,
`src/network/signal-program.ts` only if the program needs it, tests.

Out of scope: `src/sim/link-costs.ts` and route choice (TASK-244 parked), `src/routing/**` (TASK-243),
`src/sim/walkers.ts` (TASK-245 held), the importer, `src/schema`, gate floors,
`bench/traffic-baseline.json`.

## Gates

- A test that reproduces the lock on a small network and passes with the rule.
- Freiburg seed 1 on main, TASK-239's tip and TASK-245's v1, with and without the rule; seeds 1 to 6.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both modes (drain
  criterion, gridlocks, stalled heads); full demand both modes (stalled heads too); Freiburg's gate;
  Sindelfingen; the Munich gate and mode-share guard (references: the newest figures in `docs/plan.md`).
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the trace, the rule, the Freiburg band, the traffic tables.
