# TASK-195 — 3D names for partly hidden streets

Status: done 2026-11-17 (merged; see plan.md). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/195-partly-hidden-streets`, worktree `D:\cityflows-wt\195`, ports 5396 / 5496.

## Goal

TASK-192 made buildings and decks hide 3D labels: a street name runs only on a visible stretch at least
as long as its text. At TASK-183's street camera (Lilli-Palmer-Straße) that leaves 1 street and 1 place
(main had 8 streets, 1 stop and 6 places, mostly drawn on roofs), and a street that is only partly
hidden loses its name entirely (plan.md, TASK-192 review). Bring names back where the street can be
seen, without putting any back on roofs:

- try every visible stretch of a named street (all its roads, both directions of the text), not only
  the first candidate, and place the name on the best visible one;
- where no visible stretch is long enough at the placement size, allow a smaller size down to TASK-167's
  minimum before giving up;
- a place, stop or station whose point is hidden may move to a visible point of its own area if it has
  one; otherwise it stays hidden.

## Scope

`src/render3d/labels.ts`, its wiring in `src/render3d/scene.ts`, tests.

Out of scope: 2D labels (placement must stay identical), the label rules and styles beyond the size
range TASK-167 already allows, occluders other than buildings and decks, the simulation, `src/schema`.

## Gates

- Unit tests: a street hidden for most of its length but visible on a stretch long enough keeps its
  name there; a fully hidden street stays unnamed; no placed glyph's sight line is blocked.
- Counts at TASK-183's street camera and two other views (streets / stops / places against TASK-192).
- T64 3D labels on within 5% of labels off in three quiet rounds; T62; V183.
- `npm run check`, `test:city`, `test:e2e:light`.
- Screenshots: TASK-183's street view and one more street-level view, before and after.

## Report

Write it as the commit body.
