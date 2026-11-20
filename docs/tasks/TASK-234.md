# TASK-234 — Land TASK-226 (Hbf group membership, D2) on current main

Status: done 2026-11-20 (merged as the variant `e0c2d43`; review in `docs/plan.md`). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/234-land-226`, worktree `D:\cityflows-wt\234`,
ports 5434 / 5534.

## Goal

TASK-226 (`task/226-group-surfaces-2`, `b8e609b`; review in `docs/plan.md`) met the merge rule on
main 2d4dd1f and missed the audit by one non-sharp corner under 2 m (the 1.16 m nose at `n:473`),
which the lead's audit tolerance (decisions log, 2026-11-20) accepts. Main has moved since (TASK-228
changed Freiburg's trams and gate, TASK-229 the paint, TASK-232 and 233 the Freiburg project, TASK-230
step time). Bring TASK-226's commit onto current main, rebuild the Freiburg project, re-pin, and
re-measure; fix whatever the rebase breaks without changing TASK-226's rules.

## Scope

As TASK-226: `src/importers/osm/split.ts`, the slip-road gore rule in `src/network/junctions.ts`,
`tests/importers/group-membership.test.ts`, T42.7, the Freiburg rebuild and pins, the re-pins the
rebase needs, TASK-219's findings folder (re-take the D2 close-ups on the new tree).

Out of scope: new rules, `src/sim`, `src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

- The audit on the three cities against current main: no measure or named case worse beyond the lead's
  audit tolerance.
- Freiburg 0.15 seeds 1 to 6 against main (main's gate: 1,460 / 0, 80.3 s, hash 1407248127); Munich
  0.15 seeds 1 to 3 every configuration and both full demands (identical hashes expected; Munich's
  city must stay byte-identical); Sindelfingen.
- The owner's merge rule.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: what the rebase changed, the audit, the tables.
