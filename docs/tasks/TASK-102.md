# TASK-102 — Parking model and garages: where cars park, choose a facility and leave from

Owner: unassigned
Gate: 7 (road betterment, owner 2026-11-07), feature 7.1; Phase 2 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/102-parking-garages` (created by the lead from main)
Depends on: TASK-100 (vehicle classes), TASK-101 (road access), the lead's Phase 2 parking
format (`ParkingFacility` in `src/schema/city.ts`, architecture section 4). Design: this file;
`docs/architecture.md` sections 4 (City), 6 (demand), 9 and 10 (simulation) and 13 (OSM
import). Read those before the code.

## Goal

Today a car appears at its origin place's connector and vanishes at its destination's
connector, so every place behaves like an invisible garage with unlimited room
(`src/sim/connectors.ts`). Make parking a model of its own: facilities with a capacity and an
access rule, a choice on arrival, cruising when the chosen facility is full, departures from
where the car parked, and occupancy that evolves through the day. This task does garages
(cars vanish inside a building) and the shared choice logic; roadside strips and lot stalls
plug into the same logic later (TASK-103 simulates them, TASK-104 imports lots).

## Design

1. **Facilities.** Use `City.parking` (`ParkingFacility`) as defined on main. You may refine
   the shape (add a field, tighten a type) if the design needs it; describe it in section 4.
   - From OSM, new `src/importers/osm/parking.ts`: `amenity=parking` with
     `parking=underground` or `multi-storey`, `building=parking`, `building=garage` and
     `garages` become garages; `capacity` from the tag, else from the footprint (about 25 m²
     per slot per level, `building:levels` or `parking:levels`, capped), marked inferred.
     `access` maps to `public` (yes, permissive, absent on amenity parking), `customers` and
     `private`; a garage inside or touching a place's footprint serves that place.
     Entries: `entrance=garage` nodes or the nearest road position on a lane the facility's
     cars may use, as connectors (reuse the place connector logic).
   - Implicit garages (owner decision, 2026-11-07): every place with residents or jobs that has
     no explicit facility gets a private garage on its existing connectors, sized from its
     residents and the car share (residential) or its jobs (work, retail, school), marked
     inferred. With no parking data at all, the simulation therefore behaves like today plus
     capacity. Gateways keep unlimited, invisible arrivals and departures.
   - Saved in the project; editing facilities is limited to the inspector (capacity, access).
2. **Choice on arrival (simulation).** New `src/sim/parking.ts`: a car arriving for a
   destination place takes the place's own facilities first (private or customers that admit
   it), then the nearest public facility with a free slot within a search radius (default
   400 m walking distance, straight line until TASK-110's walk graph exists), choosing at
   departure and re-checking on approach. If the chosen facility fills before it arrives, it
   drives on to the next candidate (cruising), counted as search time. If none has room within
   the radius, it takes the nearest with room beyond it, and only then fails with a reason the
   metrics count. Through traffic (gateway to gateway) never parks.
3. **Departures.** A trip starts from where the car is parked, not from the origin place's
   connector. Facilities start the day with an occupancy: residential garages from residents'
   cars (car share), others from `occupancyAtStart` or a default by kind and time. Cars of
   trips that end in a facility stay there and leave from it on their next trip.
4. **Walk egress.** The straight-line distance between facility and destination is recorded per
   trip as walking distance only (no walkers until Gate 9).
5. **Host and snapshot.** Facility occupancy travels in the snapshot as a separate, rarely
   changing set (counts per facility, not per car; parked cars are drawn by TASK-103).
6. **UI.** A facility inspector (kind, capacity, access, occupancy now) and a Layers entry
   "Parking occupancy" that colours facilities by occupancy in 2D and 3D. Metrics: occupancy per
   facility over time, mean search time, cars parked, trips failed for lack of parking.
7. **Measure.** Facilities per city by kind and source; Munich morning completed trips, search
   time and failures, against main.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
host and worker wiring, store, panels, dev pages, fixture builders, shared types, test
helpers), as long as it is not named under "Out of scope"; list each such file and why in
your report. Stop and ask the lead only for a file named under "Out of scope", a contract
change this task does not describe, or a behaviour change to another feature. Trip counts
change by design; that is not a behaviour change to ask about.

Pre-approved, no need to ask: `src/schema/city.ts`, `city.schema.ts` (refinements of the
parking format), `src/schema/sim.ts` (parking parameters such as the search radius);
`src/importers/osm/parking.ts` (new), `src/importers/osm/index.ts`, `places.ts`,
`src/importers/overpass.ts` (garage tags; keep your change one separate clause);
`src/network` compile of facilities into the compiled city (a `CParking` list and its
connectors); `src/sim/parking.ts` (new), `connectors.ts`, `engine.ts`, `metrics.ts`,
`types.ts`, `params.ts`; `src/demand/**` (car share and departures from facilities);
`src/host/**` and the snapshot; `src/ui/inspector/**`, `src/ui/layers.tsx`, `src/ui/store.ts`,
`src/ui/panels/**` (metrics), `src/ui/map-view.tsx`; a facility layer under `src/render/layers/`
and `src/render3d/`; `docs/architecture.md` sections 4, 6, 9, 10 and 13; tests (a new
`tests/sim/T48-parking.test.ts`, importer cases, an e2e case tagged `@smoke`), and the
expectations that move, each named with its reason.

## Out of scope

Roadside strips and lot stalls in the simulation and parked cars drawn (TASK-103), lot import
and aisles (TASK-104), walking (TASK-110 to TASK-112), parking fees, time limits,
`:conditional` tags, the routing graph search itself (`src/routing/lane-search.ts`), road
markings and street furniture.

## Gates

1. **Model.** In T48: a place's own garage is taken first; a full garage sends the car to the
   nearest public facility within the radius, with search time counted; private and customers
   facilities admit only their place's trips; departures leave from the facility the car
   parked in; occupancy never exceeds capacity; the run is deterministic (two runs equal).
2. **Today's behaviour as the first case.** With every facility implicit and capacity large
   enough, a grid scenario completes the same trips as main within 1 percent.
3. **Import.** Facility counts per kind for Munich and Sindelfingen asserted within ±10%;
   inferred capacities marked; save and open keep facilities; a file without them opens.
4. **Traffic.** `npm run traffic:quick` reported against main (3 012 / 38 after TASK-101).
   Trip counts change by design; the lead resets the baseline at merge (owner rule 7). Every
   failure is a gridlock or a counted parking failure, and parking failures stay under 2
   percent of local arrivals in the Munich morning; explain any larger change.
5. **UI.** The occupancy layer colours facilities in 2D and 3D; the inspector shows and edits
   capacity and access with undo.
6. `npm run check`, `npm run test:city`, `npm run traffic:quick` and `npm run test:e2e:smoke`
   green. Run e2e with `CITYFLOWS_TEST_PORT=5302`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier) and `npm run traffic:quick`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick` and
  `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`; the lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates. Open the app (`npm run dev -- --port 5302`), import Munich, play the morning, watch
the occupancy layer fill and select a garage and a car; describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): facility sources and
counts per city, the choice rule as implemented, traffic before and after, files changed
outside the pre-approved list and why, expectations changed with their reasons, and the final
lines of `npm run check`. Write any Markdown or docs as UTF-8.

Commit on `task/102-parking-garages`; do not push or merge. The lead reviews only commits.
