# TASK-335 — Generic road vehicle models

Status: planned 2026-11-23 (owner: "car: fine with a few generic models", "without loss of performance"). Independent
of TASK-331 to 334; may run in parallel with them. Proposed owner: Codex (gpt-6.2-sol, high). Branch
`task/335-vehicle-models`, worktree `D:\cityflows-wt\335`, ports 5535 / 5635. Base: main a5b86b5.

## Finding (lead, 2026-11-23)

Moving vehicles (`src/render3d/vehicles.ts`) and parked cars (`src/render3d/parked-cars.ts`) are one instanced box
each, scaled per vehicle class (`car`, `van`, `truck`, `bus`; sizes in `style.vehicleClasses`).
- Head and tail lamps are painted by a shader on the box's front and rear faces (TASK-163).
- The headlight beams are placed from the bodies' instance matrices.
- Below `style.detailZoom` vehicles are drawn as flat dots.
- Moving vehicles cast shadows; parked cars do not.

## Goal

1. **A few generic models, each the class's existing length, width and height.**

   | Class | Models |
   |---|---|
   | `car` | Sedan, hatchback and SUV, picked per vehicle from a hash of its id (stable over time and across reloads) |
   | `van` | Panel van |
   | `truck` | Box truck: cab and box |
   | `bus` | Single-deck city bus |

   - Each model is code: a side profile extruded across and shaped (bonnet, windscreen rake, roof, wheel arches),
     with four wheels, about 150 to 400 triangles.
   - Windows, lamps and the class colours are drawn by a shader or vertex colours, not extra geometry.
   - Body colour stays the vehicle's colour (and the by-class colouring when on); glass is dark.
2. **Night lighting:** keep TASK-163's lamps on the new front and rear faces and the beams where they are now.
3. **Shared by parked cars:** parked cars use the same models, chosen by the same hash of their space or vehicle.
4. **Levels of detail:**
   - near: the model;
   - far: today's box;
   - below `detailZoom`: today's dots, unchanged.

## Performance

- Every model is one `InstancedMesh` per level, filled each frame from the existing pose loop with no allocation:
  at most 6 near meshes, 1 far mesh and the beams.
- Shadows: the model does not cast them. A box drawn only into the shadow pass does, so the shadow pass costs what it
  does now.
- 3D render p95 within noise of main, interleaved base against branch:
  - Munich at full demand and Sindelfingen (motorway).
  - Cameras: the default, and a close camera at a busy junction.
  - Report draw calls and triangles before and after.

## Scope

`src/render3d/vehicles.ts`, `src/render3d/parked-cars.ts`, new model files beside them, `src/render3d/scene.ts`
(wiring, picking), tests, `docs/architecture.md`.

Out of scope: the sim, `src/schema` (classes and sizes stay), the 2D vehicle layer, airside ground vehicles, trains,
`bench/traffic-baseline.json`, any download or new dependency.

## Gates

- Tests:
  - Every model's extents equal its class's size within 2%.
  - Triangle counts are within budget.
  - The model choice is stable for a vehicle id.
  - Picking and selection work at both levels and for parked cars.
- Screenshots, day and night: each model close up; a busy Munich junction at the default camera; a parking street in
  Lübeck. The lead forwards them to the owner as they land.
- Performance as above.
- Sim state hashes identical; 2D identity hashes identical; `npm run check`, `test:city`, `test:traffic:light`,
  `test:e2e:light`.

## Report

Write it as the commit body.
