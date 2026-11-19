# TASK-227 — Pitched roofs on concave outlines (straight skeleton)

Status: in progress (unsupervised run, owner 2026-11-19; "concave roofs if time allows"). Proposed
owner: Claude Code subagent (Opus 5.5, high). Branch `task/227-concave-roofs`, worktree
`D:\cityflows-wt\227`, ports 5427 / 5527.

## Goal

TASK-210 (review in `docs/plan.md`) draws gabled, hipped, pyramidal, dome, onion and round roofs on
convex outlines; 196 concave Freiburg outlines and 69 Munich ones with a pitched `roof:shape` still
fall back to flat (L, T, U and courtyard shapes, the old town's typical blocks). Draw them.

1. A straight skeleton for simple polygons (no new dependency; holes may stay flat if a courtyard
   ring is not supported, say so), robust to near-parallel edges, collinear vertices and the short
   edges of real OSM outlines; it fails safe to the current flat roof.
2. `hipped` and `pyramidal` on any outline from the skeleton (every edge slopes); `gabled` from the
   skeleton with the gable ends at the outline's short terminal edges (say the rule); keep TASK-210's
   shapes where they apply today, so convex roofs do not change.
3. Roof height from `roof:height` / `roof:levels` as today; the slope is capped so a wide wing does not
   tower (say the cap).

## Scope

`src/render3d/roofs.ts`, a skeleton module under `src/geo/` or `src/render3d/`, tests
(`tests/render/V109-roofs.test.ts` and a new skeleton test), close-ups under
`docs/findings/2026-11-19-concave-roofs/`.

Out of scope: the importer, `src/schema`, `src/network`, `src/sim`, 2D drawing, gate floors.

## Gates

- Flat fallbacks per city before and after (Freiburg 204, Munich 70, Sindelfingen 0 on main) and the
  shapes drawn; every remaining flat one with its reason.
- Skeleton tests: L, T, U, a courtyard, a near-collinear edge, a 0.2 m edge; no self-intersecting roof
  face and the roof covers the outline (area within 1%).
- Close-ups in 3D, before and after: Freiburg old town (Münsterplatz, Schwabentor), Munich, at the
  landing camera and close.
- 3D build median and render CPU p95 on the Freiburg landing spec, main against branch (budget 6 ms).
- Traffic: render only, so the state hashes must be identical (Munich 0.15 seed 1 four configurations,
  Freiburg's gate, Sindelfingen); show them.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the skeleton method, the rules, the counts, the budgets, the close-ups.
