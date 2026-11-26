# TASK-314 — Aircraft motion realism: rotation, flare, gear steering, smooth turns

Status: planned 2026-11-22 (airports wave F; starts after TASK-311). Proposed owner: Codex CLI (gpt-6.2-sol, high).
Branch `task/314-aircraft-motion-realism`, worktree `D:\cityflows-wt\314`, ports 5514 / 5614.

## Goal

Owner: "smooth movement (take off/landing animation, turning rotation animation, turning with the nose gear)".

- Take-off: rotation pitch-up at rotation speed, lift-off, climb attitude, gear retraction timing; landing: approach
  attitude, flare, main-gear touchdown, de-rotation to nose-gear contact, rollout.
- Ground turns: the aircraft turns about its main gear with nose-wheel steering, so the nose gear follows the
  centreline and the body yaws smoothly (no snapping between segments); pushback with the tug at the nose.
- Airborne turns bank where paths curve; heading and attitude interpolate smoothly between snapshots.
- Derived from the sim state and path in the render where possible; any sim change keeps state hashes of existing
  cities and London City's gates.

## Scope

`src/render3d` (aircraft pose), `src/render` (2D pose), `src/sim/aircraft-motion.ts` (pose outputs), tests.

Out of scope: throughput (TASK-312), models (TASK-315), schema, gate floors, `bench/traffic-baseline.json`, any
download.

## Gates

- Tests: pitch and gear timelines against the motion profiles; nose gear on the centreline within a stated tolerance
  through a 90-degree turn; no heading jump between frames above a stated rate.
- Frame sequences of a London City take-off, landing and a stand turn-in, day.
- Existing cities unchanged; London City's gates kept; render p95 within TASK-311's budget.
- `npm run check`, `test:city`, `test:e2e:light`.

## Report

Write it as the commit body.
