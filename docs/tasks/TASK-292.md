# TASK-292 — York's load time, second pass: junction polygons, seams, walkway unions, 2D batching

Status: in progress 2026-11-21 (wave C, owner's go). Proposed owner: Codex CLI (gpt-6.2-sol, high). Branch `task/292-york-load-2`, worktree
`D:\cityflows-wt\292`, ports 5492 / 5592.

## Goal

After TASK-287 York's first frame is 2.80 s, 1.29x Freiburg's. Its review names what is left: `junctionPolygon`,
the seams, `walkGeometry` unions and the 2D (Pixi) batching. Profile York, Freiburg and Philadelphia, find the
cause of each hot path in general code and make it fast with identical output, aiming at York within about 1.15x
Freiburg's first frame. Measure on a quiet machine (no other benchmark running; interleave main and branch).

## Scope

The hot paths the profile names (`src/render/` junction and walkway geometry, the 2D renderer's batching),
tests, a bench timing script.

Out of scope: what is drawn or simulated (identical output), `src/schema`, `src/sim`.

## Gates

- Identical output: junction polygons, seams, walk geometry and the 2D scene hashed before and after in all six
  bundled cities; simulation state hashes identical.
- First frame, ready and frame p95 for York, Freiburg, Philadelphia, Munich, interleaved main against branch, medians.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
