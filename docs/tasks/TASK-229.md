# TASK-229 — Marking follow-ups from the aerial re-check (N1, N2)

Status: done 2026-11-19 (merged; review in `docs/plan.md`). Proposed
owner: Claude Code subagent (Opus 5.5, high). Branch `task/229-marking-followups`, worktree
`D:\cityflows-wt\229`, ports 5429 / 5529.

## Goal

TASK-224 (`docs/findings/2026-11-19-aerial-recheck/`, review in `docs/plan.md`) found two regressions
from TASK-217's paint rules in the Hauptbahnhof box:

1. **N1 (rule M2).** Lane lines are drawn only on a junction group's inner lanes of 15 m or more, so
   real carriageway that a group takes in loses its lines: about 35 m of westbound Friedrichstraße
   (the D2 group) and Stefan-Meier-Straße around `r:1179`. M2 removes 43 inner lane lines in the box;
   most are inside junctions, which is right. Measure the inner run the line would follow (node to
   node along the lane, through plain joins), not the member road alone, or another rule that keeps
   the lines on carriageway and drops them inside junctions. Say which and why.
2. **N2 (rule M1).** The two left lanes of `r:1148` show no arrows, though every lane is painted on the
   ground: lane #0 has no path through the Hbf group, and lane #1's only path turns left twice, which
   M1 reads as a U-turn and hides. An entry lane whose only path through the group is a double left
   (or that has none) should still show the arrow its own movement gives at the entry node.

## Scope

`src/render/marking-geometry.ts`, tests (`tests/render/V217-markings.city.test.ts` and paint pins),
close-ups under `docs/findings/2026-11-19-marking-followups/` (use `bench/aerial-overlay.ts`; imagery
read-only in `D:\cityflows-wt\216-data`, download nothing).

Out of scope: `src/network` (crossing places, junction groups: TASK-226 is changing group membership
in `split.ts`/`junctions.ts`), the importer, `src/sim`, `src/schema`, gate floors.

## Gates

- A test per rule that fails without it.
- Counts in the box and per city (Freiburg, Munich, Sindelfingen): inner lane lines drawn, entry lanes
  with arrows, before and after; close-ups of N1 and N2 over the imagery, before and after.
- The geometry audit (`bench/geometry-audit.ts`) on the three cities: no measure worse.
- Paint only, so the state hashes must be identical (Munich 0.15 seed 1 four configurations,
  Freiburg's gate, Sindelfingen, both full demands); show them.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per case the cause, the rule, the counts; the hashes.
