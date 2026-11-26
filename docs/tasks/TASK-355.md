# TASK-355 — The geometry audit skips seams of group surfaces

Status: started 2026-11-26 (owner: "ok to your default decisions"). Owner: Claude subagent (Opus 5.5). Base: main
after TASK-347.

## Finding (TASK-347 review, 2026-11-25)

TASK-347 measures each junction group as one drawn surface. The audit's "noses" and "square noses" then rose:
- Munich noses 10 → 80;
- Freiburg square noses 10 → 39;
- Sindelfingen noses 19 → 37.

The lead's screenshots (`D:\cityflows-wt\330-pilot\R\screens\q1-*`) show that none of the eight largest new records is
a defect TASK-347 introduces:
- **Four are seams** where the group outline crosses open asphalt, often ending in a zero-width spike:
  `n:838`, Freiburg `n:254g`, Sindelfingen `n:631g`, `n:139g`. They are invisible in 2D.
- **Four are real** medians, islands or gore tips that main already drew, now the same or better.

Tiny records like `n:139g` (0.09 m) make up 12 of 17 new square records in Munich and 10 of 14 in Sindelfingen.

## Goal

The audit measures kerbs, not seams:
- a stretch of a group's outline that lies over road surface (another member's or an inner road's) is not a kerb;
- a spike whose two sides meet head-on (about 180°) is not a nose.

Real medians, islands and gore tips are still counted. Then report the audit before TASK-347 (main at `07dc95b4`) and
after, with the new rule, per city.

## Scope

`bench/geometry-audit.ts` and its helpers; tests for the audit.

## Out of scope

Drawing, network, sim; no hash changes.

## Gates

- The eight screenshot records classified as above: seams not counted, real noses counted.
- Audit totals per city before and after.
- `npm run check`.
