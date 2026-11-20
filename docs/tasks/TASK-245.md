# TASK-245 — Walkers wait about 420 s at signalised crossings (found by TASK-239)

Status: in progress (second unsupervised run, owner 2026-11-20). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/245-walker-signal-waits`, worktree `D:\cityflows-wt\245`, ports 5445 / 5545.

## Goal

TASK-239's diagnosis (review in `docs/plan.md`; evidence in `D:\cityflows-wt\239-evidence\comb`) noted
that walkers wait about 420 s on average at signalised crossings in Freiburg, main included. A real
walk-light cycle is 60 to 120 s; an average wait of about 420 s means walk calls are not served for
several cycles (actuated controllers resting in a vehicle phase, walk calls not registering, the walk
window too short to start, TASK-188's walk window rule, TASK-222's keep, or a measure that counts
something else).

1. Measure walker waits at signalised crossings on main (Freiburg gate 0.15 seed 1, Munich 0.15 seed 1,
   both modes): distribution, by controller and crossing, actuated against fixed; check the measure
   itself first.
2. Find the cause and the smallest rule that serves walk calls within a cycle (for example, a walk call
   counts as demand for the phase whose walk window serves it; a maximum wait for a waiting walker).
   Say which and why.
3. Measure everything; cars will wait more at some lights, and the merge rule judges.

## Scope

`src/sim/signals.ts`, the walkers' signal wait (`src/sim/walk*.ts`), `src/network/signal-program.ts` only
if the program needs it, tests.

Out of scope: `src/sim/link-costs.ts` and the engine's route assignment (TASK-244), `src/routing/**`
(TASK-243), `src/sim/rail-crossings.ts`, the importer, `src/schema`, gate floors,
`bench/traffic-baseline.json`.

## Gates

- A test that reproduces an unserved walk call and passes with the rule.
- Walker wait distributions before and after (Freiburg and Munich, both modes).
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both modes (drain
  criterion); full demand both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; the Munich gate
  and mode-share guard (references: the newest figures in `docs/plan.md`).
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the measure, the cause, the rule, the distributions, the traffic tables.
