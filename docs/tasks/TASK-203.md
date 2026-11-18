# TASK-203 — Framing the city beside the panels

Status: in progress (owner started it 2026-11-18). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/203-framing`, worktree `D:\cityflows-wt\203`, ports 5403 / 5503.

## Goal

On the Freiburg landing view (TASK-198 review): in 3D the camera puts the west of the city behind the
inspector, and in 2D the city fills only part of the view. Make framing account for what covers the
map, for every city:

1. When a project opens, and on "fit" or "reset view", the city (its `geo.boundary` ring when it has
   one, else its extent) is framed in the part of the map the sidebar, inspector, run bar and phone
   sheet leave visible, in 2D and 3D, with a small margin. The 2D view fills that area as far as the
   city's shape allows.
2. A project's saved camera (Freiburg's showcase 3D camera) keeps its pitch and bearing, but its
   centre is shifted so the same view sits in the visible area instead of the full canvas.
3. Opening or closing the inspector or sidebar does not move the camera (only opens and fits do).

TASK-196 already keeps a selection above the phone sheet (`src/ui/map-view.tsx`); reuse its inset
logic rather than adding a second one. If the Freiburg showcase camera values should change after
this, do not edit `bench/freiburg.ts` or the project file (TASK-201 rebuilds them at the same time):
put the suggested values in your report and the lead applies them.

## Scope

`src/ui/**` (map view, layout measurements), the 2D and 3D camera code (`src/render/**` camera,
`src/render3d/scene.ts` camera), tests and e2e specs.

Out of scope: `src/schema`, `bench/freiburg.ts`, `fixtures/projects/**`, simulation, label placement
beyond what a camera change needs.

## Gates

- Unit tests of the framing maths: a boundary fits the visible rectangle within the margin for 2D
  and 3D, with panels on either side.
- An e2e spec at 1440 × 900 and 1024 × 768 with the inspector open: every boundary vertex of
  Freiburg projects inside the visible area after open and after fit, in 2D and 3D; and at phone
  width with the sheet.
- First frame on Freiburg stays within TASK-198's 3 s budget; existing camera and shot specs pass.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
- Screenshots of the Freiburg landing view before and after, 2D and 3D, Light, at 1440 and 1024 px,
  in `docs/findings/2026-11-18-framing/`.

## Report

Write it as the commit body: what framed what before, the rule now, sizes tested, the first-frame
time, and suggested showcase camera values if any.
