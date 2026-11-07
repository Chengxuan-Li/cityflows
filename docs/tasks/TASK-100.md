# TASK-100 — Vehicle classes: car, van, truck and bus, each with its own size and driving

Owner: unassigned
Gate: 7 (road betterment, owner 2026-11-07); Phase 1 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/100-vehicle-classes` (created by the lead from main)
Depends on: TASK-090 (tiers). Design: this file; `docs/architecture.md` sections 4 (City), 8
(simulation), 9 (demand), 10 (host) and 11 (rendering). Read those before the code.

## Goal

The owner: "car categories as label or metadata". Today `VehicleClass` (`car`, `truck`, `bus`)
exists only on `Lane.allowed` and in the routing graphs; every simulated vehicle is the same
4.5 m car (`SimParams.vehicleLengthM`), and the simulation treats a lane as usable when it
allows `car` (`carLanes` in `engine.ts` and `lane-change.ts`). Through traffic, deliveries and
commuters all look and drive alike.

Give every vehicle a class and a purpose label, drive each class with its own size and
parameters, and show the class on the map, in the inspector, in the metrics and in the export.
Later tasks build on it: TASK-101 reads the class and purpose for access rules, TASK-102 to
TASK-104 park by class, TASK-112 gives persons cars.

## Design

1. **Schema (contract change, owner-approved).**
   - `VehicleClass = 'car' | 'van' | 'truck' | 'bus'` in `src/schema/city.ts` and the Zod
     schema.
   - `schemaVersion` 3. `migrateCity` reads version 2 and adds `van` to every lane whose
     `allowed` contains `car`, so old projects let vans drive wherever cars did. Version 1
     still migrates (through 2). Fixtures under `fixtures/projects` are migrated by the loader,
     not rewritten, unless a test reads them raw.
   - `TripRequest` (`src/schema/demand.ts`) gains `vehicleClass: VehicleClass` and
     `purpose: VehiclePurpose`, with
     `type VehiclePurpose = 'private' | 'delivery' | 'service' | 'taxi' | 'through'`.
     Saved demand without them reads as `car` / `private` (through trips: `through`).
   - `DemandConfig` gains `classShares`: per purpose group, the share of each class. Defaults:
     local trips `car` 0.92, `van` 0.08; through trips `car` 0.80, `van` 0.08, `truck` 0.12;
     `bus` 0 everywhere until transit exists. A van on a local trip has purpose `delivery` or
     `service` (half each, seeded); every other local trip is `private`.
2. **Simulation parameters.** Replace `SimParams.vehicleLengthM` with
   `vehicleClasses: Record<VehicleClass, { lengthM; widthM; maxSpeedMps; accelFactor;
   decelFactor }>` in `src/schema/sim.ts`, defaults in `src/sim/params.ts`:

   | Class | Length | Width | Max speed | Acceleration × | Comfortable deceleration × |
   | --- | --- | --- | --- | --- | --- |
   | car | 4.5 m | 1.8 m | none | 1.0 | 1.0 |
   | van | 5.5 m | 2.0 m | 120 km/h | 0.85 | 0.95 |
   | truck | 12 m | 2.5 m | 80 km/h | 0.5 | 0.8 |
   | bus | 12 m | 2.55 m | 80 km/h | 0.6 | 0.8 |

   The factors multiply `idm.aMps2` and `idm.bMps2`. A desired speed is the road's limit times
   the vehicle's speed factor, capped by the class's maximum. Delete `vehicleLengthM` and every
   read of it (owner rule: old code is deleted when replaced); a saved scenario whose
   `simParams` still has it loads and ignores it.
3. **Engine.**
   - Vehicles carry a class index (`Uint8Array`) and a purpose index. Every gap, spawn spacing,
     clearance, conflict-zone and box test that used `vehicleLengthM` uses the right vehicle's
     length: the leader's for a follower's gap, the vehicle's own for its clearance of a zone
     or an exit. Search `src/sim` for every use; there are about twenty (`engine.ts`,
     `intersection.ts`, `lane-change.ts`, `merge.ts`).
   - A lane is usable by a vehicle when `lane.allowed` contains the vehicle's class. Replace
     `carLanes` with a per-class lookup in `engine.ts`, `lane-change.ts` and `patch.ts`; a
     discretionary lane change never enters a lane its class may not use.
   - `reroute.ts` passes the vehicle's class (today hard-coded `car`) into `RouteRequest`. Add
     `purpose?: VehiclePurpose` to `RouteRequest` and pass it too; TASK-101 reads it.
   - Gridlock respawn (TASK-077) keeps the trip's class and purpose.
4. **Demand.** `src/demand` assigns class and purpose to each trip from `classShares` with the
   demand seed, after mode choice and before the trip is emitted. Draw them from a separate
   seeded stream so the existing draws stay unchanged and a scenario with only cars generates
   the same trips as today. The demand summary reports trips per class.
5. **Host and snapshot.** `VehicleSnapshot` gains `vclass: Uint8Array`; the worker transfers
   it with the other arrays (`src/host/protocol.ts`, `worker.ts`, `client.ts`, `headless.ts`).
   `Metrics` gains `completedByClass: Record<VehicleClass, number>`. The trip export
   (`export-data.ts`) adds `class` and `purpose` columns.
6. **Render.**
   - 2D (`src/render/layers/vehicles.ts`): each class draws at its own length and width with
     its own simple top-down shape (van: a box with a short bonnet; truck: a cab and a longer
     box; bus: a long rounded box), from textures generated once. The existing colouring stays
     the default; add a Layers option "Colour vehicles by class" (off by default) with one
     muted colour per class in `style.ts`.
   - 3D (`src/render3d/vehicles.ts`): box sizes and heights per class (car 1.5 m, van 2.2 m,
     truck 3.5 m, bus 3.2 m), same colouring rule. Picking keeps working for every class.
   - Inspector (`src/ui/inspector/vehicle.tsx`): class and purpose under the vehicle's heading.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
view wiring, dev pages, fixture builders, shared types), as long as it is not named under
"Out of scope"; list each such file and why in your report. Stop and ask the lead only for
a file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature.

Also named after the agent asked: `src/fixtures/build-city.ts` and
`src/importers/osm/index.ts` (the `schemaVersion` the City constructors write),
`src/project/export-csv.ts` (trip export columns), `src/render/scene.ts`,
`src/render3d/scene.ts` and `src/ui/map-view.tsx` (class colouring wiring), `dev/render.ts`
(the snapshot's class array).

`src/schema/city.ts`, `city.schema.ts`, `demand.ts`, `demand.schema.ts`, `sim.ts`, `migrate.ts`;
`src/sim/**`; `src/demand/**`; `src/routing/index.ts` (only the `purpose` field on
`RouteRequest`); `src/host/**`; `src/importers/osm/roads.ts` and `src/importers/geojson/index.ts`
(only the default `allowed` list, which gains `van`); `src/render/layers/vehicles.ts`,
`src/render/style.ts`, `src/render/types.ts`, `src/render3d/vehicles.ts`; `src/ui/layers.tsx`,
`src/ui/inspector/vehicle.tsx`, the demand summary in `src/ui`; `docs/architecture.md` sections
4, 8, 9, 10 and 11 (describe what you built); tests (a new `tests/sim/T46-vehicle-classes.test.ts`,
a migration case, a demand case, an e2e case tagged `@smoke`), and the expectations that move,
each named.

## Out of scope

Access rules on roads and the routing graph (TASK-101), parking (TASK-102), importer behaviour
beyond the default `allowed` list and the schema version, network geometry, road markings (TASK-108), terrain (TASK-105),
vegetation (TASK-106). Buses get no routes or stops; they exist as a class only.

## Gates

1. **Cars only = today.** With `classShares` set to all `car` and `vehicleClasses.car` at 4.5 m,
   the grid and town runs reproduce main's completed trips and travel times exactly. Prove it in
   T46 with a fixed seed. (The benchmark hashes change with the default shares; that is
   expected.)
2. **Sizes and speeds.** In T46: a truck's follower stops behind the truck's real rear; a
   truck on a 130 km/h road cruises at 80 km/h; a queue of trucks holds fewer vehicles than a
   queue of cars on the same lane; a van and a truck never change into a lane that forbids
   their class.
3. **Migration.** A version 2 project opens with `van` added next to every `car`; a version 1
   project still opens; save and open round-trips version 3.
4. **Traffic.** Run `npm run traffic:quick` before and after on your branch and report
   completed and gridlocked trips. Trucks take road space, so fewer completed trips is
   expected; report the change, do not tune it away. The lead resets the traffic baseline at
   merge (owner decision, 2026-11-07).
5. **Render.** Take 2D and 3D shots of a Munich queue with all four classes visible (switch
   the shares in a test scenario if needed) and read them yourself: the shapes are told apart
   at street zoom, nothing overlaps at the overview zoom.
6. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Run e2e with
   `CITYFLOWS_TEST_PORT=5301`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier) and `npm run traffic:quick`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick`,
  `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run bench` or the full `npm run test:e2e`; the lead
  runs them at merge.

## Acceptance

All gates. Open the app (`npm run dev -- --port 5301`), run the Munich fixture to the morning,
turn on "Colour vehicles by class" in 2D and 3D, inspect one vehicle of each class; describe
what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the classes,
parameters and shares as implemented; every place that used the single vehicle length and what
it uses now; `traffic:quick` before and after; image paths; expectations changed, each with its
reason; the final lines of `npm run check`.

Commit on `task/100-vehicle-classes`; do not push or merge. The lead reviews only commits.
