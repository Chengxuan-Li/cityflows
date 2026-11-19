# TASK-233 — Shared one-lane streets alone (TASK-231's D6), with the grade-aware overlap audit

Status: in progress (unsupervised run, owner 2026-11-19; TASK-231's proposed follow-up). Proposed
owner: Claude Code subagent (Opus 5.5, high). Branch `task/233-shared-lanes`, worktree
`D:\cityflows-wt\233`, ports 5433 / 5533.

## Goal

TASK-231 (parked; branch `task/231-halves-shared-lanes`; review in `docs/plan.md`) measured D6 alone
at Freiburg's gate 76.3 s (main 75.7 s) but did not land it: with D5 it missed the merge rule, and alone
it tripped an audit artefact. Measure 9 (lane overlap) leaves out every node outline, so a street
junction above a tunnel hid part of the tunnel's overlap; narrowing a street shrank that outline and
"raised" Munich's overlap. TASK-231's commit `e68dcf1` makes measure 9 leave out only the outlines of
nodes at the road pair's grade.

1. Land the audit fix (`e68dcf1`, cherry-pick) as its own commit, with main's audit figures before and
   after it (it re-bases the lane-overlap totals; nothing else should move).
2. Land D6 from TASK-231's first version (`2922724`): a two-way `lanes=1` way is one 4.5 m
   carriageway, half per direction, marked `sharedLane` (`roads.ts`), drawn without a centre line
   (`marking-geometry.ts`). Not D5.
3. Measure D6 against main with the fixed audit.

## Scope

`bench/geometry-audit.ts` (the fix only), `src/importers/osm/roads.ts` (the shared-lane rule),
`src/render/marking-geometry.ts` (the centre line), the Freiburg rebuild and pins, tests, close-ups under
`docs/findings/2026-11-19-shared-lanes/` (aerial overlay; imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: `corridors.ts` (D5), `split.ts`, `src/network/**`, `src/sim/**`, `src/schema`, gate floors,
`bench/traffic-baseline.json`.

## Gates

- A test for the rule and one for the audit fix, each failing without it; roads touched per city.
- The geometry audit on the three cities with the fixed measure: no measure worse, named cases
  included.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both modes; full demand
  both modes (references actuated 3,759 / 143, hash 4028429784, 1,677.6 s; fixed 3,501 / 168, hash
  2888500527, 1,727.1 s); Freiburg's gate (1,460 / 0, 80.3 s, hash 1407248127 since TASK-228) and
  seeds 1 to 3; Sindelfingen; the Munich gate and mode-share guard.
- The owner's merge rule (plan, owner decisions log, 2026-11-19). If the first version misses, one
  variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the audit fix and its re-based figures; the rule, the counts, the audit;
the traffic tables.
