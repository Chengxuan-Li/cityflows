# TASK-210 — Roof shapes in 3D: round, dome and onion

Status: in progress (owner started it 2026-11-18, unsupervised batch). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/210-roof-shapes`, worktree `D:\cityflows-wt\210`, ports 5410 /
5510.

## Goal

`src/render3d/roofs.ts` draws `round`, `dome` and `onion` roofs flat (`fallbackReason =
'unsupported-shape'`), and falls back to flat for other shapes on outlines it cannot handle. Since
TASK-201 the building parts carry these shapes: the Schwabentor tower's onion roof draws flat, and
domes and round roofs elsewhere do too.

1. Count, in Freiburg, Munich and Sindelfingen, every roof that falls back to flat and why (shape not
   supported, outline not convex or too complex, other), before and after.
2. Draw `dome` (a hemisphere or spherical cap over the outline, scaled to `roof:height`), `onion`
   (a bulbous profile rising to a point) and `round` (a barrel vault along the outline's long axis),
   on circular, square and rectangular outlines, with a sensible fallback on others (say which).
3. Check the other fallbacks: where a supported shape (gabled, hipped, pyramidal) falls back to flat on
   an outline that could take it, widen the rule if it is simple and safe, else list it.

Roofs must stay within the 3D frame budget (render CPU p95 under 6 ms on Freiburg) and the 3D build
must not grow by more than 0.1 s (TASK-206's phase timings).

## Scope

`src/render3d/roofs.ts`, its tests, the importer's roof-shape list in `src/importers/osm/context.ts`
only if a shape is not passed through.

Out of scope: `src/schema`, other render3d files except to call the new shapes, `src/render3d/markings.ts`
(TASK-215), the network, the simulation, fixtures.

## Gates

- Unit tests per shape (vertex bounds within the outline and roof height, closed surfaces) that fail
  on main.
- The fallback counts before and after for the three cities.
- 3D close-ups before and after: the Schwabentor, and one dome and one round roof wherever they occur,
  in `docs/findings/2026-11-19-roof-shapes/`.
- `npm run check`, `test:city`, `test:e2e:light`, the 3D frame budget.

## Report

Write it as the commit body: counts, the shapes, the fallbacks, timings.
