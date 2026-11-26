# TASK-306 — Aircraft performance figures and motion profiles

Status: in progress 2026-11-22 (airports batch wave A, owner's go). Proposed owner: Codex CLI (gpt-6.2-sol, high).
Branch `task/306-aircraft-motion`, worktree `D:\cityflows-wt\306`, ports 5506 / 5606.

## Goal

The motion physics TASK-298 drives aircraft with, as pure, deterministic functions over a path (a polyline with
station), independent of the airport model (`docs/decisions/2026-11-22-airports.md`, wave A).

- Add performance figures to each type in `src/schema/aircraft.ts` (the catalogue is on main): taxi speed
  (straight, turn), maximum lateral acceleration in turns (giving a speed for a curve radius), minimum turn radius,
  pushback speed, towing speed, take-off rotation speed and roll length, initial climb speed and gradient, final
  approach speed, landing roll length to taxi speed, braking deceleration; helicopters: hover-taxi speed, vertical
  climb rate, transition speed. Type-level published figures; state the source kind in a comment (no download).
- `src/sim/aircraft-motion.ts` (or a module name the architecture suits): speed profiles along a path for taxi
  (curvature-limited, stopping at a given station), pushback and tow, take-off (roll, rotation, climb along the
  extended centreline to about 10 km), approach (from about 10 km on a glide path of a given angle, flare, touchdown
  at the aiming point, rollout to an exit speed), helicopter take-off and landing; each returns position, heading,
  height, speed and a phase label per time step, deterministic.
- Tests: roll lengths and speeds within the figures; curve speed respects lateral limits; a stop at a station with
  no overshoot; a 3 degree and a 5.5 degree glide path reach the aiming point; determinism.

## Scope

`src/schema/aircraft.ts` (fields), a new motion module under `src/sim`, tests, a short `docs/architecture.md`
paragraph.

Out of scope: the airport model (TASK-295), routing and the engine hook (TASK-298), rendering, gate floors,
`bench/traffic-baseline.json`, any download.

## Gates

- Tests above; existing archives and hashes byte-identical (no engine change); added test time reported.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
