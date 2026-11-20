# TASK-246 — Keep-clear boxes on lane gains (found by TASK-241)

Status: done 2026-11-20 (merged; review in `docs/plan.md`). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/246-keepclear-gains`, worktree `D:\cityflows-wt\246`, ports 5446 / 5546.

## Goal

TASK-241 (review in `docs/plan.md`; close-up `docs/findings/2026-11-20-gores-keepclear/gores-r1189-after.jpg`)
found that `r:1189`'s keep-clear box sits on a lane gain and fans across the taper: the box follows the
lanes' fanned outlines instead of standing as a rectangle across the carriageway. Census keep-clear boxes
that overlap a lane transition (gain or end) per city, and draw each as the box it is on the ground: a
rectangle (or parallelogram along the road) across the lanes it covers, clipped to the carriageway, never
bent by a taper; move it along the road off the taper if it does not fit, or drop it with a reason.

## Scope

`src/render/marking-geometry.ts` (keep-clear boxes), tests, paint pins, close-ups under
`docs/findings/2026-11-20-keepclear-gains/` (aerial overlay where in the imagery box; imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: `src/network/**`, the importer, `src/sim`, `src/schema`, gate floors.

## Gates

- A test that fails without the rule; the census before and after.
- Close-ups before and after.
- The audit on the three cities: no worsening beyond the lead's tolerance.
- Paint only: identical state hashes (Munich 0.15 seed 1 four configurations, Freiburg's gate,
  Sindelfingen, both full demands).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the cause, the rule, the census, the hashes.
