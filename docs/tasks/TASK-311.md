# TASK-311 — 3D render cost at airport scale

Status: in progress 2026-11-22 (airports wave E, owner's go). Proposed owner: Codex CLI (gpt-6.2-sol, high). Branch
`task/311-airport-render`, worktree `D:\cityflows-wt\311`, ports 5511 / 5611.

## Goal

Heathrow's 3D render CPU p95 was 19.4 ms against the 6 ms local budget, and London City sits near the budget under
load since TASK-301's lights (`docs/plan.md`, TASK-300, 303 and 304 reviews). Cut per-frame 3D cost at airport scale
by general means: instance or merge airfield lights (thousands of points), aircraft meshes and their light mounts,
markings; cull and level-of-detail by distance; avoid per-frame allocation and matrix updates for static objects.
Same look: no visible change except where level of detail is invisible at that distance.

Measurement targets as TASK-310: Heathrow and Boston held out of the panel (bundling only, from `c0b4b2f` and
`dacf5ae`), London City, Freiburg, York, Zurich if on main.

## Scope

`src/render3d`, `src/render/airfield-lights.ts` and other shared render geometry, `src/render`, tests.

Out of scope: load path (TASK-310), aircraft behaviour (TASK-312), new models (TASK-315), schema, gate floors,
`bench/traffic-baseline.json`, any download.

## Gates

- 3D render CPU p95 and mean, 2D likewise, quiet machine, interleaved base and branch: Heathrow under 6 ms, Boston and
  London City under 4 ms, existing cities no slower. Day and night (lights on).
- Screenshots base against branch at the same camera, day and night, at London City and Heathrow: no visible change.
- Existing cities' render audits and archives unchanged; state hashes untouched (no sim change).
- `npm run check`, `test:city`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.

## Report

Write it as the commit body.
