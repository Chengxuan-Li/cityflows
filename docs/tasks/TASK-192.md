# TASK-192 — 3D labels: hidden streets and labels while the camera moves

Status: planned, not started; awaiting owner approval (lead, 2026-11-14). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/192-labels-3d-polish`, worktree `D:\cityflows-wt\192`, ports
5392 / 5492.

## Goal

TASK-183's open items (plan.md, TASK-183 review):

1. **Hidden streets.** Labels draw on top of everything, so at street level a street hidden behind a
   building shows its name on that building's roof. Drop (or fade) a label whose anchor point, or most
   of its glyphs, is hidden from the camera by a building or a deck, checked once per placement (when
   the camera settles), not per frame. Stations, stops and places may keep drawing on top if their
   point is visible.
2. **Labels while the camera moves.** Between placements labels keep the angle and size of their last
   placement, so after an orbit text briefly runs at the old angle. While the camera moves, keep each
   placed street label aligned with its road on screen and sized for its current distance (or fade
   labels out during large camera moves and back in on settle); pick one and say why.
3. **Frame cost.** TASK-183 measured T64 3D +3.7% (rail on) and +4.9% (rail off) with labels on, on a
   busy machine with a software GPU. Confirm under 5% in at least three quiet rounds after 1 and 2.

## Scope

`src/render3d/labels.ts`, its wiring in `src/render3d/scene.ts`, the 3D picking or depth data it needs,
tests.

Out of scope: 2D labels (placement must stay identical), the label rules and styles, the simulation,
`src/schema`.

## Gates

- Unit tests: a label behind a building block is dropped for a fixed camera and shown when the camera
  sees it; street labels stay aligned after a scripted orbit.
- T64 3D labels on within 5% of main in three rounds; T62.
- `npm run check`, `test:city`, `test:e2e:light`, V183.
- Screenshots: the TASK-183 street-level view (Lilli-Palmer-Straße) before and after, and a mid-orbit
  frame before and after.

## Report

Write it as the commit body.
