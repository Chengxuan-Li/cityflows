# TASK-103 — Visible parking: roadside strips and lot stalls in the simulation

Owner: unassigned
Gate: 7 (road betterment, owner 2026-11-07), feature 7.1; Phase 3 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/103-visible-parking` (created by the lead from main)
Depends on: TASK-102 (garages, the choice logic in `src/sim/parking.ts`), TASK-104 (lots,
aisles, generated stalls), TASK-100 (vehicle classes and their shapes). Design: this file;
`docs/architecture.md` sections 4 (City, the `ParkingFacility` format with `strip`), 5
(compile), 8 and 9 (simulation, the TASK-102 parking notes), 11 (rendering) and 13 (OSM
import). Read those before the code.

## Goal

Cars now park only inside garages, where they vanish. Lots are drawn with stalls but no car
ever uses them, most lots cannot be reached at all (Munich 18 of 22, Sindelfingen 30 of 31:
OSM maps no aisles for them), and streets have no kerbside parking. Make parking visible:
roadside strips along streets, cars that pull into and out of strip slots and lot stalls with
a short manoeuvre, and parked cars drawn in 2D and 3D, with occupancy evolving through the
day. Garages stay invisible.

## Design

1. **Roadside strips (import).** Use `ParkingFacility` with `kind: 'roadside'` and `strip`
   as defined on main (one facility per road side and run); refine the format if needed and
   describe it in section 4.
   - OSM: the current scheme `parking:left|right|both` = `lane`, `street_side`, `on_kerb`,
     `half_on_kerb`, `shoulder` with `parking:<side>:orientation` = `parallel`, `diagonal`,
     `perpendicular`, and the older `parking:lane:<side>` = `parallel|diagonal|perpendicular`;
     `no`, `no_parking`, `no_stopping` and `separate` mean none. Sides are relative to the
     road's travel direction (map both directions of a two-way street, as TASK-110 did for
     sidewalks). `parking:<side>:access`, `:fee` and `:restriction` are kept only as access
     (`private` when tagged so, else `public`).
   - Inferred where untagged (owner decision 2 of 2026-11-07): `residential` and
     `unclassified` streets get parallel strips on both curb sides of a two-way street and on
     the right side of a one-way street; no strips on other classes, ramps, bridges or tunnels;
     marked inferred. Inference runs at import and materializes facilities (saved); a file
     without strips opens with none.
   - A strip's run skips 5 m either side of a junction node (German StVO rule), the crossing
     stripes plus 5 m on the approach side, place, garage and lot connectors (3 m either side),
     and bus-only or restricted curb lanes. Capacity from the run length: parallel 5.5 m per
     slot, diagonal 2.8 m, perpendicular 2.5 m.
2. **Strip geometry (compile, derived).** Slots as positions along the curb lane, each with a
   pose in a parking band outside the carriageway's outer edge (band width 2.0 m parallel,
   4.5 m diagonal, 5.0 m perpendicular). Vehicle lanes, nodes, movements and junction geometry
   do not change. The band is part of the drawn street: 110's sidewalks, 107's curbs and
   generated lamps move outward by the band width where a strip exists (these are derived
   layers; the vehicle network stays byte-identical).
3. **Lots in the simulation.** Compile lots into `CParking` with `kind: 'lot'` and capacity
   from their stall count. Entries: a connector on each aisle lane (mapped aisles); a lot with
   no reachable aisle gets one inferred driveway, a connector on the nearest lane its cars may
   use within 30 m of its polygon, marked inferred (lead default; keep the
   `parking_unreachable` diagnostic only for lots with no road that close). A car that arrives
   at a lot connector parks in the nearest free stall to that connector.
4. **Manoeuvres (simulation).** A car parking at a strip slot brakes to a stop at the slot
   position in the curb lane, holds the lane for `parkManoeuvreS` (default 8 s parallel, 4 s
   diagonal and perpendicular), then leaves the lane and becomes a parked car. Leaving needs
   an accepted gap in the curb lane (the existing spawn and merge rules) and holds the lane for
   `leaveManoeuvreS` (default 4 s). Lot stalls use the same holds on the aisle lane; inferred
   driveways and garages keep today's connector behaviour. Vans park like cars; trucks and
   buses never use strips or stalls. Cars of trips that end in a slot or stall stay there and
   leave from it on their next trip (TASK-102's chains).
5. **Choice (extends TASK-102, lead default).** Trips to a residential destination take the
   person's own garage first, except a seeded share `streetParkingShare` of persons (default
   0.3) who look for a street slot first; work and school trips keep the own garage first.
   Visits (all other destinations) take strips and lots admitting them (public, or customers
   of the destination) by straight-line walking distance within `parkingSearchRadiusM`, then
   the destination's own garage, then public garages, then beyond the radius. Cruising,
   search time and failures work as in TASK-102. Initial stock: the same share of residents'
   cars starts in strips and lots within the radius of home (nearest first, up to capacity),
   the rest in the garage. Inferred garages keep admitting every car (owner, 2026-11-08).
6. **Host and snapshot.** Slot and stall occupancy (one bit per slot, in compiled order)
   travels as a separate set, sent only when it changes, like TASK-102's facility counts; a
   parked car's class comes with it so it is drawn with its own shape.
7. **Drawing.** A "Parked cars" layer (default on) draws parked cars in their slots and stalls,
   2D and 3D, instanced with TASK-100's class shapes and colours, dimmed slightly against
   moving cars. Strip bands draw as pavement beside the carriageway, with slot ticks only for
   mapped strips. Frame time with the layer on within 20% of off at both Munich zooms (owner
   allowance, TASK-097).
8. **Editing.** The road inspector shows each side's strip (layout, capacity, access,
   inferred or mapped) and can add, remove or change it, with undo.
9. **Measure.** Strips per city (mapped, inferred, slots), lots reachable before and after,
   parked cars at 07:00 and 09:30, Munich morning completed, gridlocked, search time and
   parking failures against main, and the frame times.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
host and worker wiring, store, panels, dev pages, fixture builders, shared types, test
helpers), as long as it is not named under "Out of scope"; list each such file and why in
your report. Stop and ask the lead only for a file named under "Out of scope", a contract
change this task does not describe, or a behaviour change to another feature. Trip counts
change by design; that is not a behaviour change to ask about.

Pre-approved, no need to ask: `src/schema/city.ts`, `city.schema.ts` (refinements of the
`strip` format), `src/schema/sim.ts` and `src/sim/params.ts` (manoeuvre times,
`streetParkingShare`); `src/importers/osm/roads.ts` (parking tags), a new
`src/importers/osm/strips.ts`, `src/importers/osm/index.ts`, `lots.ts` (inferred driveways);
`src/network/parking.ts`, `stalls.ts`, a new `src/network/strips.ts`, `compile.ts`,
`types.ts`, `src/network/walk.ts` (sidewalk offset beside a band); `src/sim/parking.ts`,
`connectors.ts`, `engine.ts`, `vehicle.ts`, `metrics.ts`, `types.ts`, `hash.ts`;
`src/host/**` and the snapshot; `src/render/street.ts` (curbs and lamps beside a band),
`src/render/layers/` (parked cars, bands), `src/render3d/` (parked cars, bands),
`src/render/scene.ts`, `src/render3d/scene.ts`, `style.ts`, `types.ts`;
`src/editor/commands/**`, `src/ui/inspector/**`, `src/ui/layers.tsx`, `src/ui/store.ts`,
`src/ui/map-view.tsx`, `src/ui/panels/**` (metrics); `bench/geometry-shots.ts` (new
cameras); `docs/architecture.md` sections 4, 5, 8, 9, 11 and 13; tests (a new
`tests/sim/T52-visible-parking.test.ts`, importer cases, a render case, an e2e case tagged
`@smoke`), and the expectations that move, each named with its reason.

## Out of scope

Pedestrians and walkers (TASK-111, TASK-112), signals and crossings rules, vehicle lanes,
nodes, movements and junction geometry, the routing graph search (`src/routing/lane-search.ts`),
demand generation other than the initial parked stock, garage capacity rules (owner decision
2026-11-08), parking fees, time limits and `:conditional` tags, marking themes.

## Gates

1. **Network untouched.** The compiled vehicle network (roads, lanes, nodes, movements,
   connectors other than the new parking ones) for grid, town, Munich and Sindelfingen equals
   main's, proven by hashing without strip facilities and inferred lot driveways (as T49 does
   for lots). Pins that move because parking data is in the hashed object move with a comment.
2. **Model.** In T52: a car parks in a strip slot after holding the curb lane for the
   manoeuvre time, and a following car waits or changes lanes; a leaving car waits for a gap;
   a lot car parks in the nearest free stall to its connector; slot and stall occupancy never
   exceeds one car; a car's next trip leaves from its slot; trucks and buses never use strips;
   inferred driveways reach every lot within 30 m of a road; deterministic (two runs equal).
3. **Import.** Mapped and inferred strip counts and slots for Munich and Sindelfingen asserted
   within ±10%; no strip within 5 m of a junction, on a crossing or over a connector; save and
   open keep strips; a file without them opens.
4. **Traffic.** `npm run traffic:quick` reported against main (3 356 / 20 / 0 after TASK-116).
   Trip counts change by design; the lead runs the full gate and resets the baseline at merge
   (owner rule 7). Every failure is a gridlock or a counted parking failure, parking failures
   stay under 2% of local arrivals, and the gridlocked roads are listed; explain any increase
   (a manoeuvre blocking a busy curb lane is the expected cause; say where).
5. **Render.** 2D and 3D shots (new cameras `V103-munich-street` on a residential street with
   inferred strips, `V103-munich-lot` on the TASK-104 lot camera at 08:00, `V103-sindelfingen-lot`
   on a lot reached by an inferred driveway, and their 3D versions); read them yourself: cars
   sit in their slots and stalls, the band sits outside the carriageway and inside the
   sidewalk, nothing overlaps a building, roads stay the strongest element. Report the frame
   times.
6. `npm run check`, `npm run test:city`, `npm run traffic:quick` and `npm run test:e2e:smoke`
   green, plus the parking-sensitive cases `demo-a-commute`, `T16-performance` and
   `qa-exports` (they caught TASK-102's regressions). Heavy e2e cases need
   `test.setTimeout(420_000)` for CI's software GPU. Run e2e with `CITYFLOWS_TEST_PORT=5303`;
   never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run traffic:quick`,
  `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick`,
  `npm run test:e2e:smoke` and the three e2e files named in gate 6.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`; the lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5303`), import
Munich, play the morning from 06:30 to 09:00 with "Parked cars" on, watch strips empty and lots
fill, select a parked car and a strip in the road inspector, edit a strip; describe what you
saw in 2D and 3D.

## Deliverable

A report in the body of your last commit message (no new Markdown files): strip sources and
counts per city, lots reachable before and after, the choice and manoeuvre rules as
implemented, traffic before and after with the gridlocked roads, frame times, image paths,
files changed outside the pre-approved list and why, expectations changed with their reasons,
and the final lines of `npm run check`. Report every timing that grew against main (compile,
placement, step), even when no gate covers it. Write any Markdown or docs as UTF-8.

Commit on `task/103-visible-parking`; do not push or merge. The lead reviews only commits.
