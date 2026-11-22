# TASK-301 — 3D aircraft, flight paths, and airfield and aircraft lighting

Status: planned 2026-11-22 (airports batch, owner's go; starts after TASK-298; TASK-307 provides the aircraft meshes and light mounts). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/301-aircraft-3d-lights`, worktree `D:\cityflows-wt\301`,
ports 5501 / 5601.

## Goal

Visuals and lighting coordinated with landing, departure and aircraft movement
(`docs/decisions/2026-11-22-airports.md`). Procedural geometry only, no downloaded models.

- **Aircraft in 3D:** TASK-307's meshes driven by the sim state: propellers and rotors spinning when engines run,
  gear down near the ground and up after climb-out, a per-flight accent colour.
- **Flight paths.** Approaches descend from about 10 km out (owner, 2026-11-22: longer finals, drawn over the map's empty surround in 3D) on their glide path, flare and touch down at the aiming
  point; departures rotate and climb; the camera can follow an aircraft.
- **Airfield lights** (night and dusk, through the existing lighting mode): runway edge (white, amber on the last
  600 m), centreline, threshold (green) and end (red) lights, approach lights before each threshold in use, PAPI
  units showing red and white by the approaching aircraft's height against the glide path, taxiway centreline
  (green) and edge (blue) lights, stop bars (red) at holding positions that switch off when the aircraft is
  cleared onto the runway, apron floodlights.
- **Aircraft lights:** navigation lights (red left, green right, white tail) always on, beacon flashing red while
  engines run or the aircraft moves, strobes on the runway and airborne, landing lights on final and on the
  take-off roll, taxi lights while taxiing, all from the aircraft's sim state.
- Lights follow the active runway configuration (TASK-300 if landed; else the runway ends in use).

## Scope

`src/render3d` (aircraft, airfield lights), `src/render/lighting.ts`, `src/render` (2D lights where the 2D view
shows them), tests.

Out of scope: aircraft behaviour (TASK-298 to 300), road lighting of existing cities, gate floors,
`bench/traffic-baseline.json`, any download.

## Gates

- Tests: light sets placed by rule on the synthetic airport (counts and colours per runway end, stop bars at every
  holding position); PAPI colours against a scripted approach height; aircraft light states from sim states.
- Screenshots and short recordings, day and night: a landing, a take-off, taxiing past stop bars, the apron at
  night, each aircraft class at close range.
- Existing cities' archives and render outputs identical where audits apply; frame time on London City reported
  against Freiburg's.
- `npm run check`, `test:city`, `test:e2e:light`.

## Report

Write it as the commit body.
