# TASK-266 — Rail geometry load time: the polygon clipping in `railGeometry` (Sindelfingen 6.7 s)

Status: in progress 2026-11-21 (third run). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/266-rail-geometry-speed`, worktree `D:\cityflows-wt\266`, ports 5466 / 5566.

## Goal

TASK-258 (Munich and Sindelfingen as preloaded cities) found that Sindelfingen takes 8 to 13 s to reach
its first frame and 8 to 15 s to build its 3D scene on a loaded machine. Freiburg takes 3.5 to 4.7 s in the
same rounds; its budget is 5 s for 3D (TASK-206). A CPU profile puts 6.8 s of an 11 s load in the polygon
clipping inside `railGeometry` (`src/render/rail-geometry.ts`). Headless it takes 6.7 s for Sindelfingen,
0.3 s for Freiburg and 1.4 s for Munich.

Find why each clip costs so much in Sindelfingen (candidates: long tracks clipped against many polygons
without a bounding-box prefilter, quadratic unions, degenerate or near-collinear inputs, repeated work per
section). Make it fast with identical output. Target: `railGeometry` under 1 s for each city, and
Sindelfingen's first frame and 3D build within Freiburg's budgets.

## Scope

`src/render/rail-geometry.ts` and the clipping helpers it calls, `src/render3d/rail.ts` where it consumes
them, tests, a bench timing script.

Out of scope: what the geometry draws (shapes must be identical), the importer, `src/network/**`,
`src/sim/**`, `src/schema`.

## Gates

- Identical output: the rail paint pins and a new test comparing the geometry before and after for all
  three cities, by hash or by exact equality.
- Headless `railGeometry` times per city, before and after; interleaved, several runs each.
- Production first frame and 3D build for Freiburg, Munich and Sindelfingen, main against branch. Use the
  bundled archives from TASK-258 if it has landed; otherwise import from the extracts.
- Identical state hashes (render only).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the cause, the change, the times, the identity checks.
