# TASK-235 — Land TASK-221 (lane tapers across short roads) with the grade-aware audit

Status: done 2026-11-20 (merged; review in `docs/plan.md`). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/235-land-221`, worktree `D:\cityflows-wt\235`, ports 5435 / 5535.

## Goal

TASK-221's variant (`task/221-carry-tapers`, `0b62f2c`; review in `docs/plan.md`) met the merge rule
and missed the audit by 0.12 m² (Munich corridor lane overlap, measured with the old measure 9) and
3 mm (B39 width p95). TASK-233 has since made measure 9 grade-aware. Bring the variant onto current
main, re-pin, and re-measure everything with the current audit; the lead's audit tolerance (decisions
log, 2026-11-20) applies. Fix what the rebase breaks without changing TASK-221's rules.

## Scope

As TASK-221: `src/network/lanes.ts`, `lane-drop.ts`, `continuity.ts`, `corridor.ts`, `compile.ts`,
`tests/network/carry-tapers.city.test.ts`, re-pins, close-ups in
`docs/findings/2026-11-19-carry-tapers/` (re-take on the new tree).

Out of scope: new rules, `junctions.ts` and `split.ts` (TASK-234 is landing there), the importer,
`src/sim`, `src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

- The audit on the three cities against current main, named cases included.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both modes; full demand
  both modes (references actuated 3,759 / 143, hash 4028429784, 1,677.6 s; fixed 3,501 / 168, hash
  2888500527, 1,727.1 s); Freiburg's gate (1,460 / 0, 80.3 s, hash 1407248127); Sindelfingen; the Munich
  gate and mode-share guard.
- The owner's merge rule.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: what moved since TASK-221, the audit table, the traffic tables.
