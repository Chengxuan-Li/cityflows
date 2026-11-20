# TASK-236 — The remaining roof shapes on concave outlines

Status: in progress (second unsupervised run, owner 2026-11-20). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/236-concave-roof-shapes`, worktree `D:\cityflows-wt\236`, ports 5436 / 5536.

## Goal

TASK-227 (review in `docs/plan.md`) drew gabled, hipped and pyramidal roofs on concave outlines from a
straight skeleton (`src/geo/straight-skeleton.ts`). Freiburg still has 14 flat fallbacks (half-hipped 4,
round 3, gambrel 3, mansard 2, skillion 1, one zero-height part) and Munich 13 (gambrel 5, mansard 5,
half-hipped 1, round 1, skillion 1), all on concave outlines. Draw them from the same skeleton:
half-hipped (a gable end clipped by a small hip), gambrel and mansard (two pitches: the skeleton's
faces split at a break height), skillion (one plane over the outline, `roof:direction` if tagged,
else the long axis), round (a vault along the skeleton's ridge where the outline allows, else
hipped). Fail safe to the current flat roof. Convex roofs must not change.

## Scope

`src/render3d/roofs.ts`, `src/geo/straight-skeleton.ts` (only if a shape needs a skeleton query),
tests (`tests/render/V109-roofs.test.ts`, skeleton tests), close-ups under
`docs/findings/2026-11-20-concave-roof-shapes/`.

Out of scope: the importer, `src/schema`, `src/network`, `src/sim`, 2D drawing, gate floors.

## Gates

- Flat fallbacks per city before and after, with the reason for each one left.
- A test per shape; no self-intersecting face; the roof covers the outline (area within 1%).
- Close-ups in 3D before and after, Freiburg and Munich.
- 3D build median and render CPU p95 on the Freiburg landing spec, main against branch (budget 6 ms).
- Render only: identical state hashes (Munich 0.15 seed 1 four configurations, Freiburg's gate,
  Sindelfingen).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the shapes and rules, the counts, the budgets, the close-ups.
