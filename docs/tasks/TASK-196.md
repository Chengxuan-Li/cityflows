# TASK-196 — Keep the selection in view above the phone sheet

Status: approved by the owner 2026-11-17; in progress. Proposed owner: Claude Code subagent (Sonnet
5.5, high). Branch `task/196-sheet-recentre`, worktree `D:\cityflows-wt\196`, ports 5397 / 5497.

## Goal

TASK-189 made the inspector a bottom sheet under 600 px. A selection under the sheet stays hidden until
the sheet shrinks or the map is panned (plan.md, TASK-189 review). When the sheet opens or changes
height and the selection's anchor (the point the map would centre on) is under it, pan the map, in 2D
and in 3D, so the anchor sits in the middle of the map area left above the sheet. Don't move the
camera when the anchor is already visible, don't zoom, and respect reduced motion (jump instead of
easing).

## Scope

`src/ui/**` (the sheet and map view), the camera helpers in `src/render/camera.ts` and the 3D camera in
`src/render3d/scene.ts` if a pan needs them, a phone e2e spec.

Out of scope: wider layouts (computed styles and camera behaviour unchanged at 601 px and wider), the
simulation, `src/schema`.

## Gates

- Phone e2e (390 x 844), 2D and 3D: select a road in the lower half; after the sheet opens its anchor is
  above the sheet; selecting one already visible above the sheet leaves the camera unchanged; dragging
  to full and back keeps the anchor visible where there is room.
- At 768 px and wider the camera does not move on selection (as on main).
- `npm run check`, `test:e2e:light`, `qa-mobile`, `qa-phone-sheet`.
- Screenshots at 390 px: a lower-half selection before and after.

## Report

Write it as the commit body.
