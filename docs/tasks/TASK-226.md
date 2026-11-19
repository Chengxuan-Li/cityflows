# TASK-226 — TASK-219's group membership re-measured on the Siegesdenkmal fix

Status: planned (unsupervised run, owner 2026-11-19; starts after TASK-225 merges). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/226-group-surfaces-2`, worktree
`D:\cityflows-wt\226`, ports 5426 / 5526.

## Goal

TASK-219 (`task/219-group-surfaces`; review in `docs/plan.md`) fixed D2: the Hauptbahnhof group no
longer takes in the median crossover at `n:1147`/`n:488` or the slip-road diverge at `n:473`, and the
westbound stop line moves from 38.5 m before the painted line to 4.0 m past it. Its tip (`5bc497a`)
missed Freiburg's gate (24 gridlocked at the Siegesdenkmal, a lock main has on other seeds); its
variant (`c96c115`) passed the gate but added four sharp corners at Lessingstraße. Bring the tip's two
rules (`src/importers/osm/split.ts`, `tests/importers/group-membership.test.ts`) onto main after
TASK-225 and the wave A merges, rebuild Freiburg, re-pin, and re-measure. If it still misses, report
it; do not take the variant.

## Scope

`src/importers/osm/split.ts`, `tests/importers/group-membership.test.ts`, the Freiburg rebuild and its
pins, TASK-219's findings folder (update the close-ups if the shapes moved).

Out of scope: `src/sim`, `src/network`, `src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

TASK-219's gates (`docs/tasks/TASK-219.md`): the tests per rule, close-ups, traffic main against
branch, the merge rule, the geometry audit (no measure worse), and the tiers.

## Report

Write it as the commit body: what moved since TASK-219, the tables.
