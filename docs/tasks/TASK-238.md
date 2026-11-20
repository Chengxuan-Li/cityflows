# TASK-238 — Close halves as one carriageway, without the Marsstraße regression (TASK-231 D5 reworked)

Status: done 2026-11-20 (merged; review in `docs/plan.md`). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/238-close-halves-2`, worktree `D:\cityflows-wt\238`, ports 5438 / 5538.

## Goal

TASK-231's D5 variant (`task/231-halves-shared-lanes`, `a6c4ba1`; review in `docs/plan.md`) pulls
opposite carriageways whose lane blocks leave under 2 m over 20 m to a 0.5 m painted median
(`pushOverlapping`, `corridors.ts`). It met the merge rule and every city audit total, closed
Bismarckallee's gap (67.74 to 37.46 m²), but worsened named case R3-8 (Munich Marsstraße
`r:845`/`r:944`) width max from 0.387 to 0.481 m, beyond the lead's audit tolerance.

1. Find why pulling Marsstraße widens R3-8's width error (which road, which station, against what
   reference) and whether the pull is right on the ground there (no Munich imagery: reason from OSM
   tags, lane counts, the median's mapping).
2. A rule that keeps Bismarckallee's gain and does not worsen R3-8 or any other measure: a better
   pull (for example the median width, the easing, or which edge moves), or a condition grounded in
   the data (for example a mapped median, a tram or a barrier between the halves). Not an id list.
3. Re-measure.

## Scope

`src/importers/osm/corridors.ts`, tests, the Freiburg rebuild and pins, Munich re-pins, close-ups under
`docs/findings/2026-11-19-halves-shared-lanes/` (aerial overlay for Freiburg; imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: `roads.ts`, `split.ts`, `src/network/**`, `src/sim/**`, `src/schema`, the audit, gate
floors, `bench/traffic-baseline.json`.

## Gates

- A test for the rule that fails without it.
- The audit on the three cities against main, named cases included: no worsening beyond the lead's
  audit tolerance (decisions log, 2026-11-20).
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both modes; full demand
  both modes (references on main when you start: see the latest full-demand figures in `docs/plan.md`;
  TASK-235 is merging and moves them); Freiburg's gate and seeds 1 to 3; Sindelfingen; the Munich gate
  and mode-share guard.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the cause at Marsstraße, the rule, the audit, the traffic tables.
