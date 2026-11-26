# TASK-315 — Aircraft model realism, jet bridges and apron furniture in 3D

Status: planned 2026-11-22 (airports wave F; starts after TASK-311). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/315-airport-3d-models`, worktree `D:\cityflows-wt\315`, ports 5515 / 5615.

## Goal

Owner: "aircraft modeling reality" and "3d models of jetbridges etc.". Procedural geometry only, no downloads.

- Aircraft: closer to the real types: fuselage cross-section and taper, cockpit windows, doors, winglets or raked tips
  per type, engine nacelles with fan faces, pylons, flap-track fairings, T-tail on the CRJ and private jets where
  typical, high wing on the ATR and Dash 8, the A380's upper deck, helicopter skids or wheels; a few liveries by
  rule (colour bands per seeded airline) instead of one accent.
- Jet bridges at contact stands where gates are mapped (or by rule from terminal edge and stand nose), extending to
  the aircraft door when parked and retracting before pushback; apron furniture: stand guidance boards, apron
  floodlight masts, blast fences where mapped, terminal piers' glazing.
- Within TASK-311's render budget (instancing, level of detail).

## Scope

`src/render3d` (aircraft meshes, jet bridges, furniture), `src/render` where 2D shows them, tests.

Out of scope: motion (TASK-314), ground vehicles (TASK-316), sim, schema, gate floors, `bench/traffic-baseline.json`,
any download.

## Gates

- Tests: per-type part lists and dimensions; a jet bridge per mapped contact gate within a stated distance; bridge
  state from the stand's occupancy.
- Screenshots day and night: each class close up, London City's apron with bridges docked, Zurich's Dock E if on
  main.
- Render p95 within TASK-311's budget; existing cities unchanged.
- `npm run check`, `test:city`, `test:e2e:light`.

## Report

Write it as the commit body.
