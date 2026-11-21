# TASK-256 — Small visual leftovers: the `n:211` zebra, the promenade's parking hatch, `rt:12944`'s ballast

Status: in progress 2026-11-20 (third unsupervised run). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/256-visual-leftovers`, worktree `D:\cityflows-wt\256`, ports 5456 / 5556.

## Goal

Three small drawing faults left by earlier tasks (reviews of TASK-248, 233 and 232 in `docs/plan.md`):

1. `n:211`'s zebra is painted 4.4 m along the street from the OSM crossing node.
2. The Freiburg promenade (`r:225`, `r:226`) draws a parking hatch where the ground is about 10 m of
   unpainted paving (TASK-233's review; its 4.5 m carriageway version slowed Freiburg by 14.5 s).
3. About 10 m of Rotteckring tram track (`rt:12944`) still draws on ballast.

The owner's rule (2026-11-20): improve the reading of OSM, not OSM itself, and no per-id curation. Fix
each by a general rule, say what else each rule changes per city, and prefer drawing-only fixes. If a fix
must move traffic, the merge rule applies to it; if one item cannot be fixed by a rule, report why and
land the others.

## Scope

`src/render/marking-geometry.ts`, `road-paint.ts`, rail drawing (`rail-geometry.ts`), the importer's
crossing, parking or rail form reading where the cause lies, tests, close-ups under
`docs/findings/2026-11-20-visual-leftovers/` (aerial overlay; imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: `src/sim/**`, `src/schema`, the audit, gate floors, `bench/traffic-baseline.json`.

## Gates

- A test per item that fails without its fix; counts per city; close-ups before and after against the
  imagery.
- Drawing-only fixes: identical state hashes (Munich 0.15 seed 1 four configurations, Freiburg's gate,
  Sindelfingen, both full demands) and frame budgets on the Freiburg landing spec. A fix that moves
  traffic: the traffic gates and merge rule of TASK-253's contract.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per item the cause, the rule, the counts, the hashes or tables.
