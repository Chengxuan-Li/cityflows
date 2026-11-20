# TASK-240 — Arrows on the Hauptbahnhof approach r:1148 (TASK-234's side effect, N2)

Status: done 2026-11-20 (merged; review in `docs/plan.md`). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/240-r1148-arrows`, worktree `D:\cityflows-wt\240`, ports 5440 / 5540.

## Goal

Since TASK-234 (review in `docs/plan.md`) the westbound approach `r:1148` to the Hauptbahnhof shows no
turn arrows. On the ground (TASK-224's `D2-aerial-n1146-arrows-*` close-ups in
`docs/findings/2026-11-19-group-surfaces/` and the aerial-recheck findings) every lane carries
arrows; they describe the junction two roads on, past the median crossover `n:1147`. Before TASK-234
main drew four through arrows 19 m late; TASK-229 had restored arrows on lanes 0 and 1 by reading the
group path.

1. Find why `r:1148` now gets none (its lanes' movements at `n:1147`, the group entry they feed, which
   rule in `marking-geometry.ts` hides them).
2. A rule that paints, on an approach whose next node is a plain node or a median crossover, the arrows
   of the junction the lanes reach next (their path's turns there), at the painted position near the
   approach's end; no arrows where the path is ambiguous. Not an id list.

## Scope

`src/render/marking-geometry.ts`, tests (`tests/render/V217-markings.city.test.ts`, paint pins),
close-ups under `docs/findings/2026-11-20-r1148-arrows/` (aerial overlay; imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: `src/network/**`, the importer, `src/sim`, `src/schema`, gate floors. TASK-239 may touch
paint hooks for crossings; keep to arrows.

## Gates

- A test for the rule that fails without it; arrow counts in the box and per city before and after.
- Close-ups over the imagery before and after.
- The audit on the three cities: no worsening beyond the lead's tolerance.
- Paint only: identical state hashes (Munich 0.15 seed 1 four configurations, Freiburg's gate,
  Sindelfingen, both full demands).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the cause, the rule, the counts, the hashes.
