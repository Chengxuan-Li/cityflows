# TASK-183 — Street and place labels in 3D

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/183-labels-3d`, worktree
`D:\cityflows-wt\183`, ports 5383 / 5483.

## Goal

TASK-167 gave the 2D map street, station, tram-stop and place labels; 3D has none (plan.md,
TASK-167 review: "Open: 3D labels"). Give the 3D view the same labels, so the map reads the same in
both views:

- Street names follow their road, upright and readable from the current camera (flip when the road
  runs "backwards" on screen), shown only where the street is long enough on screen for the text.
- Station, tram-stop and place names sit at their point, facing the camera.
- No two labels overlap on screen; the selection follows TASK-167's priority (stations, then major
  streets, minor streets, stops, places). Labels re-place when the camera settles, not every frame,
  and never flicker while the camera is still.
- Arimo, the 2D sizes and halo (`labelFonts`), legible in Light and Dark appearance and in Day,
  Evening and Night lighting (labels are not darkened by the lighting).
- The sidebar's Labels layer toggle hides and shows them in 3D too.
- Buildings may hide labels behind them, or labels may draw on top; pick one, say which, and keep it
  consistent.

Reuse `src/render/labels.ts` (candidates, rules, fonts) rather than a second copy of the rules. The
3D drawing may use sprites, an instanced glyph atlas, or a screen-space overlay; no new dependency.

## Scope

`src/render3d/**` (a new label module and its wiring in `scene.ts`), `src/render/labels.ts` where a
shared piece must be exported or generalised, the Labels toggle wiring, tests.

Out of scope: the simulation, `src/schema`, 2D label placement results (2D must place exactly the
same labels as before; its tests and pins stay unchanged).

## Gates

- Unit tests for the 3D placement (no overlaps for a fixed camera, flip rule, toggle).
- T64 3D frame time within 5% of main with labels on (and level with them off), on the T64 workload.
- `npm run check`, `test:city`, `test:e2e:light`, T62/T64.
- Screenshots: Munich 3D at a street-level and an overview camera, Light Day, Dark Night, Evening;
  the same view with labels off. Send these to the lead as each step lands, so they can reach the
  owner.

## Report

Write it as the commit body.
