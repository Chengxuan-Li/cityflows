# TASK-368 — Inner roads without stub lane blocks (TASK-348 rule 1) without the Freiburg gridlock

Status: started 2026-11-26 (owner defaults; city work merges under the traffic merge rule and the audit tolerance).
Owner: Codex (gpt-6.2-sol, high). Base: main `8c8bfdb6`.

## Finding (TASK-348)

The 5 m trim floor binds on inner roads of junction groups: 69 of 105 in Munich, 30 of 32 in Sindelfingen and 121 of
151 in Freiburg. Those inner roads keep stub lane blocks, which add lane overlap (J1-hbf 31.12 m², J1-stefan
25.96 m²). TASK-348's rule 1 lifted the floor for inner roads (`INNER_LANE_M_PENDING`, 0.5 m) and chained movements
across the group. Measured on, it gridlocked Freiburg's gate: 16 trips, 62.8 to 74.5 s. It was switched off in
`86b1f702` (`INNER_LANE_M` is `MIN_LANE_M`; its test is skipped). TASK-347 has since drawn one surface per group, and
TASK-364 added continuations.

## Goal

Turn rule 1 on and reproduce the Freiburg gridlock. Find where and why the 16 trips lock: node, inner road, lanes,
movements, compared with main. Fix the cause with a general rule in `src/network`. Then run TASK-348's gates for rule
1.

## Scope

`src/network/compile.ts`, `lanes.ts`, `junctions.ts`, `continuity.ts`; the rule's tests; bundled-city rebuilds and
re-pins. Out of scope: `src/sim/**`, `src/schema`, signal programs, group membership (`split.ts`),
`bench/geometry-audit.ts`, `bench/traffic-baseline.json`, OSM edits, per-id curation.

## Gates

- The skipped rule-1 test runs and passes; one test for the fix that fails without it.
- Census: inner roads shorter than their cuts, 69 / 30 / 121, down to 0.
- J1 lane overlap to about 0; sharp corners not worse (geometry audit against main, audit tolerance).
- The owner's merge rule:
  - Munich 0.15 seeds 1–12, choice off and on, both signal modes, delay within 3%;
  - full demand within 2% on the mean of seeds 1–5, both modes;
  - Freiburg's gate within 5 s, no gridlock; drain criterion;
  - Sindelfingen, T53 and step time.
- Showcase gates; `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

If the first version misses, at most one variant, with both tables.
