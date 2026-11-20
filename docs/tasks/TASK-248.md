# TASK-248 — Land TASK-239 (crossings mapped only as OSM nodes) on TASK-247

Status: done 2026-11-20 (merged; review in `docs/plan.md`). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/248-land-239`, worktree `D:\cityflows-wt\248`, ports 5248 / 5548.

## Goal

TASK-239 (branch `task/239-node-crossings`, tip 6fd050e (rebased variant f52ca2e); reviews in `docs/plan.md`) was held because Freiburg's gate run
(0.15, seed 1) flipped into an 08:00 jam with it. TASK-247 removed the flip (a shared-lane actuation rule
in `signals.ts`; its review gives Freiburg seed 1 with TASK-239 at about 70 s). Bring TASK-239's
commit(s) onto main with TASK-247, rebuild Freiburg if the importer changed, re-pin, and re-measure
everything. Do not change TASK-239's rules; fix only what the rebase breaks.

## Scope

TASK-239's own files, the Freiburg rebuild and pins, the re-pins the rebase needs.

Out of scope: new rules, `src/sim/signals.ts`, `src/routing/**` (TASK-243), `marking-geometry.ts`
(TASK-246), `src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

- Freiburg 0.15 seeds 1 to 6 against main.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both modes (drain
  criterion, gridlocks, stalled heads); both full demands (stalled heads too); Sindelfingen; the Munich
  gate and mode-share guard (references: TASK-247's review in `docs/plan.md`).
- The audit on the three cities (no worsening beyond the lead's tolerance).
- The owner's merge rule.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: what the rebase changed, the tables, the verdict.
