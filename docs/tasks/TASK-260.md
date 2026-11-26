# TASK-260 — Rail bridges in 3D: walls and decks that cut into each other (owner's bugs 1 and 2)

Status: queued 2026-11-20 (third unsupervised run, owner's bug report). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/260-rail-bridge-3d`, worktree `D:\cityflows-wt\260`, ports 5460 / 5560.

## Goal

The owner logged (2026-11-20, Freiburg, shots `bug1.png`, `bug2.png` in `docs/findings/2026-11-20-owner-3d-bugs/`):

1. Under a railway bridge, the elevated retaining walls and abutments cut into each other: dark saw-tooth
   wedges hang below the deck where neighbouring tracks' walls or skirts meet.
2. On a multi-track rail bridge, deck pieces overlap and show through each other (shaded slivers across
   the deck).

Find the bridges affected in each city, the cause (per-track skirts and walls built separately, decks at
slightly different heights, joins at way boundaries), and build one continuous structure per bridge:
one deck surface across its tracks at one height profile, side walls only on the outer edges, abutments
that meet the ground or the wall below without wedges.

## Scope

`src/render3d/rail.ts`, `geometry.ts`, `heights.ts` (rail bridge decks, walls, abutments), tests,
close-ups under `docs/findings/2026-11-20-rail-bridge-3d/`.

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
