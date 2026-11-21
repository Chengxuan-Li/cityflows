# TASK-253 — TASK-223's missed-turn rule re-measured on five-seed full demand

Status: in progress 2026-11-20 (third unsupervised run). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/253-misses-five-seeds`, worktree `D:\cityflows-wt\253`, ports 5453 / 5553.

## Goal

TASK-223 (parked; branch `task/223-remaining-misses-2`, v1 `f5071e7`, v2 `5fb2693`; review in
`docs/plan.md`) cuts `r:654`'s missed turns about 30-fold with TASK-208's `detourHeads` rule. v2 missed
only fixed-time full demand (+3.1%), on one seed, before the owner adopted the five-seed reading and before
TASK-247 and 249 changed main. Port v2 (and v1 only if v2 misses) onto current main and measure it under
today's rules. Take the better version that passes; if neither passes, report both tables and park.

## Scope

`src/sim/lane-change.ts` (`detourHeads`) and its tests, re-pins the rule moves.

Out of scope: the importer, `src/schema`, signal control, gate floors, `bench/traffic-baseline.json`.

## Gates

- TASK-223's test (fails without the rule); misses at `r:654` and `r:639`, 12 seeds, both modes.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full
  demand on seeds 1 to 5, both modes (the five-seed reading); Freiburg's gate and seeds 1 to 3;
  Sindelfingen; the Munich gate and mode-share guard (references: the newest figures in `docs/plan.md`).
- The geometry audit on the three cities, within the lead's tolerance (decisions log, 2026-11-20).
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the version, misses, the traffic tables (five full-demand seeds each).
