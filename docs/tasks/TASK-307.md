# TASK-307 — Aircraft shapes: 2D outlines and procedural 3D models

Status: in progress 2026-11-22 (airports batch wave A, owner's go). Proposed owner: Codex CLI (gpt-6.2-sol, high).
Branch `task/307-aircraft-shapes`, worktree `D:\cityflows-wt\307`, ports 5507 / 5607.

## Goal

How each aircraft looks, from the catalogue on main (`src/schema/aircraft.ts`), independent of the airport model
(`docs/decisions/2026-11-22-airports.md`, wave A). Procedural geometry only, no downloaded models.

- **2D:** a top-view outline per type at real length and span: fuselage, swept wings, tailplane, engines by count and
  mount; propeller discs on the propeller class; a rotor disc on helicopters.
- **3D:** a mesh per type at real dimensions: fuselage with a nose and tail cone, wings with sweep and dihedral,
  engines (under the wing or at the rear), fin and tailplane, the double-decker's two window rows, propellers and
  rotors as separate parts that can spin, landing gear as a part that can be shown or hidden, a neutral livery with
  an accent colour parameter; light-mount points (nav lights at the wing tips and tail, beacon, strobes, landing
  and taxi lights) exported for TASK-301.
- A preview of every type side by side at scale, 2D and 3D, in the dev render page.
- Builders take the type and return geometry; they do not depend on the sim.

## Scope

`src/render` (outline builder), `src/render3d` (mesh builder), the dev render page, tests.

Out of scope: aircraft motion and the engine (TASK-298, 306), lights (TASK-301), airport surfaces and markings,
gate floors, `bench/traffic-baseline.json`, any download.

## Gates

- Tests: outline extents equal length and span per type; mesh bounding boxes equal length and span; part lists per
  class (propellers only on the propeller class, rotors only on helicopters, two window rows only on double-deckers).
  No pixel-exact screenshot assertions.
- Screenshots of the preview in 2D and 3D, day and night, in the evidence folder.
- Existing archives and render outputs unchanged; added test time reported.
- `npm run check`, `test:city`, `test:e2e:light`.

## Report

Write it as the commit body.
