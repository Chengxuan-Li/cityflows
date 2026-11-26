# TASK-261 — Walkways and stairs in 3D: broken edges and twisted stairs (owner's bugs 3 and 4)

Status: queued 2026-11-20 (third unsupervised run, owner's bug report). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/261-walk-steps-3d`, worktree `D:\cityflows-wt\261`, ports 5461 / 5561.

## Goal

The owner logged (2026-11-20, Freiburg, shots `bug3.png`, `bug4.png` in `docs/findings/2026-11-20-owner-3d-bugs/`):

3. Footways show broken shapes: their raised edges break into saw-tooth pieces along curves, and a curved
   walk end fans into radial wedges (the "sunburst" by the Hauptbahnhof platforms).
4. Stairs (`highway=steps`) draw as irregular, twisted ribbons; the owner calls it a very common issue,
   worst around the Hauptbahnhof.

Find the cause of each (per-segment extrusion without mitred joins, offsets folding on tight curves,
steps' height profile flipping or crossing its own outline, steps between levels whose ends sit at
the wrong heights) and draw continuous walk surfaces and edges, and stairs as a straight or bending flight
with treads that climb from the lower end to the upper one, its width from `width` or the default.
Count the broken walks and stairs per city before and after.

## Scope

`src/render3d/walk.ts`, `geometry.ts`, `heights.ts` (walk and steps heights), tests, close-ups under
`docs/findings/2026-11-20-walk-steps-3d/`.

Out of scope: `src/sim/**`, `src/network/**` rules, `src/schema` (unless named), the importer's road and walk topology, gate floors, OSM edits, per-id curation.

## Gates

- A test per fix that fails without it; counts per city of the shapes changed.
- Close-ups before and after at the owner's views (night lighting as in the owner's shots, and day),
  Freiburg first, and a sample in Munich and Sindelfingen.
- Render only: identical state hashes (Munich 0.15 seed 1 four configurations, Freiburg's gate,
  Sindelfingen, both full demands).
- Frame budgets and 3D build time on the Freiburg landing spec, main against branch (3D build within
  5 s; TASK-206).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per defect the cause, the rule, the counts, the close-ups, the hashes and
budgets.
