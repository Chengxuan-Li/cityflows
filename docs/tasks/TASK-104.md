# TASK-104 — Surface lots: aisles as service roads and generated stalls, no simulation

Owner: unassigned
Gate: 7 (road betterment, owner 2026-11-07), feature 7.1; Phase 2 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/104-surface-lots` (created by the lead from main)
Depends on: TASK-096 (context), TASK-101 (road access), the lead's Phase 2 parking format
(`ParkingFacility` in `src/schema/city.ts`, architecture section 4). Design: this file;
`docs/architecture.md` sections 4 (City), 5 (compile), 11 (rendering) and 13 (OSM import).
Read those before the code.

## Goal

The importer drops `highway=service` with `service=parking_aisle` (`src/importers/osm/filter.ts`
and the Overpass road query), and `amenity=parking` areas are only drawn as tinted surroundings.
Import surface lots as `ParkingFacility` records of kind `lot`: their aisles become low-speed
service roads in the network, stalls are generated along the aisles inside the lot polygon,
and the lot's entries are where aisles meet public roads. No car parks yet; TASK-103 sends
cars into the stalls. TASK-102 (garages and the choice logic) runs in parallel.

## Design

1. **Import.** `amenity=parking` with `parking=surface` (or no `parking` tag and no building)
   becomes a lot facility with its polygon as `shape`, `capacity` from the tag or the generated
   stall count, `access` mapped as in TASK-102 (`yes`/absent `public`, `customers`,
   `private`), and a place it serves when it touches one place's footprint or carries a name
   matching one. `service=parking_aisle` ways inside or touching a lot are imported as roads of
   class `service` with a low speed limit (10 km/h), listed in the lot's `aisles`, keeping
   their `access` tags (TASK-101's rules apply). Aisles outside every lot stay dropped.
   `service=driveway` stays dropped.
2. **Entries.** A lot's entries are the nodes where its aisles meet roads that are not aisles;
   no connector is needed (TASK-103 decides how cars enter). Lots with no aisle that reaches a
   public road get one inferred entry aisle from the nearest point of the polygon to the
   nearest permitted road, marked inferred, or are reported as unreachable; say which you do.
3. **Stalls (compile, never saved).** In `src/network`, generate stalls along both sides of
   each aisle inside the lot polygon: perpendicular 2.5 × 5 m by default, angled where the
   aisle is one-way and narrow, none within 6 m of an aisle junction or an entry, none outside
   the polygon or over another aisle, clear of buildings. The compiled city gets a stall list
   per lot (position, heading, width, length, aisle road and position along it) and the lot's
   stall count. Deterministic.
4. **Drawing.** Stall lines in 2D (thin white or theme colour, faint at overview) and in 3D on
   the lot surface (following terrain like other ground paint), as part of the lot's surface;
   a Layers entry "Parking stalls", default on.
5. **Measure.** Lots, aisles and stalls per city; compile time against main; how many lots
   are unreachable or got an inferred entry.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
compile wiring, renderer layers and setters, dev pages, fixture builders, shared types, test
helpers), as long as it is not named under "Out of scope"; list each such file and why in
your report. Stop and ask the lead only for a file named under "Out of scope", a contract
change this task does not describe, or a behaviour change to another feature. Adding aisles
changes the network by design; that is not a behaviour change to ask about.

Pre-approved, no need to ask: `src/schema/city.ts`, `city.schema.ts` (refinements of the
`lot` fields of the parking format); `src/importers/osm/filter.ts`, a new
`src/importers/osm/lots.ts`, `index.ts`, `roads.ts` (aisle roads), `context.ts` (to avoid
drawing a lot twice), `src/importers/overpass.ts` (aisles inside lots; keep your change one
separate clause); `src/network/stalls.ts` (new), `compile.ts`, `types.ts`; a stall layer under
`src/render/layers/`, `src/render3d/` (stall paint), `src/render/style.ts`, `src/ui/layers.tsx`,
`src/ui/store.ts`, `src/ui/map-view.tsx`; `docs/architecture.md` sections 4, 5, 11 and 13; tests
(a new `tests/network/T49-lots.test.ts`, importer cases, an e2e case tagged `@smoke`), and the
expectations that move, each named with its reason.

## Out of scope

The simulation (`src/sim`), demand, routing internals, garages and the parking choice
(TASK-102), roadside strips and parked cars (TASK-103), walking (TASK-110), road markings
other than stalls (TASK-108, TASK-114).

## Gates

1. **Network change is only the aisles.** Pinned compile hashes (T44, V106, V108, T47) move only
   because of aisle roads: prove it by hashing the compiled city with the aisle roads and their
   nodes removed and showing it equals main's, then update each pinned value with that
   reason. Grid and town are unchanged byte for byte. Name every other moved expectation.
2. **Stalls.** In T49: deterministic; every stall inside its lot polygon and clear of aisles,
   other stalls, buildings and entries; counts on a synthetic lot within ±5% of the expected
   layout; OSM `capacity` wins over the generated count for `capacity`, and the report names
   lots where they differ by more than 30%.
3. **Import.** Lot, aisle and stall counts for Munich and Sindelfingen asserted within ±10%;
   aisles carry their access; save and open keep lots; a file without them opens.
4. **Traffic unaffected.** Aisles must not attract through traffic: `npm run traffic:quick`
   reported against main (3 012 / 38 after TASK-101), within the 90% gate, and no route in it
   uses an aisle unless it starts or ends in its lot. The lead resets the baseline at merge if
   the network change moves counts (owner rule 7).
5. **Render.** 2D and 3D shots of a Munich and a Sindelfingen lot (new cameras
   `V104-munich-lot`, `V104-sindelfingen-lot`, and their 3D versions); read them yourself:
   stalls line the aisles, nothing crosses a building or the road, the overview stays calm.
6. `npm run check`, `npm run test:city`, `npm run traffic:quick` and `npm run test:e2e:smoke`
   green. Run e2e with `CITYFLOWS_TEST_PORT=5304`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick` and
  `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`; the lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5304`), import
Munich and Sindelfingen, look at their lots in 2D and 3D and toggle "Parking stalls"; describe
what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files): lot rules as
implemented, counts per city, the hash proof for the network change, traffic before and after,
image paths, files changed outside the pre-approved list and why, expectations changed with
their reasons, and the final lines of `npm run check`. Write any Markdown or docs as UTF-8.

Commit on `task/104-surface-lots`; do not push or merge. The lead reviews only commits.
