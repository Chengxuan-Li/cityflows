# TASK-119 — Mapped street-side parking areas become strips

Owner: unassigned
Gate: 7 (road betterment), feature 7.1 follow-up; owner bug report of 2026-11-08 (item 3),
Phase 3b of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/119-street-side-parking` (created by the lead from main)
Depends on: TASK-103 (roadside strips, `src/importers/osm/strips.ts`, `src/network/strips.ts`),
TASK-104 (lots), TASK-102 (garages). Design: this file; `docs/architecture.md` sections 4 (the
`ParkingFacility` format with `strip`), 5, 11 and 13 (OSM import, the TASK-103 notes). Read
those before the code.

## Goal

The owner found surface car parks on the map that never hold a car. In the Munich extract,
80 places are parking places and only 19 have a lot; 57 of the other 61 are OSM
`amenity=parking` areas with `parking=street_side`: lay-bys and parking bays mapped as
separate areas beside a street. Today the importer draws them as parking places but creates
no facility for them, and TASK-103 reads the road's matching `parking:<side>=separate` as no
parking, so those kerbs park nothing. Two private surface lots (way 84303381 "Gewerbehof
Westend", way 574700583) and one multi-storey garage building (way 59379087) also end up as
parking places without a facility. Import all of them as parking that cars use and that draws.

## Design

1. **Street-side areas (import).** An `amenity=parking` area (way or multipolygon) with
   `parking=street_side`, `lane`, `layby`, `on_kerb` or `half_on_kerb` becomes a roadside
   facility (`kind: 'roadside'` with `strip`) on the road beside it:
   - the road: the nearest car road whose curb lane runs along the area's long side within
     15 m, both directions of a two-way street considered (the side relative to travel
     follows from the geometry, as TASK-103 maps sides);
   - the run (`fromM`, `toM`): the area's projection onto that road's centreline, clipped to the
     road;
   - the layout: `orientation=parallel|diagonal|perpendicular` (also `parking:orientation`),
     else from the area's depth across the road (up to 3 m parallel, up to 5.5 m diagonal,
     else perpendicular);
   - capacity: the `capacity` tag when present, else from the run length and layout (TASK-103's
     pitches); access from `access` (`private`, `customers` kept, else `public`);
   - provenance: mapped, with the OSM way or relation ID.
   The area itself becomes the strip's drawn band (`CStrip.polygon` from the mapped ring
   instead of the generated band), and the slot poses sit inside it. No parking place is
   created for such an area any more (it was a place nobody visits).
2. **No double parking.** Where a mapped area covers a kerb, the inferred strip on that road
   side over the same stretch is not created (inference already skips tagged sides; extend it
   to stretches covered by a mapped area). A road side tagged `separate` gets parking only
   from its mapped areas.
3. **Areas with no road beside them.** A street-side area with no car road within 15 m is
   imported as a surface lot with generated bays (TASK-104's lot machinery and inferred
   driveway), not dropped.
4. **The dropped lots and garage.** Find why ways 84303381 and 574700583 produce a parking
   place but no lot, and way 59379087 (`building=yes`, `parking=multi-storey`) no garage; fix
   the rule, and report any further parking place without a facility in Munich and
   Sindelfingen with its cause.
5. **Overpass and saved files.** The Overpass query already fetches `amenity=parking` ways and
   multipolygons; bump `queryVersion` only if the query changes. Import materializes the
   facilities (saved); a file saved before this task opens unchanged.
6. **Measure.** Per city: street-side areas found, imported as strips, as lots, skipped (with
   reasons); slots added; inferred strip stretches removed; parking places left without a
   facility; Munich morning against main.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, renderer layers,
dev pages, fixture builders, shared types, test helpers), as long as it is not named under
"Out of scope"; list each such file and why in your report. Stop and ask the lead only for a
file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature. Trip counts may change; that is not a behaviour change
to ask about.

Pre-approved, no need to ask: `src/importers/osm/strips.ts`, `lots.ts`, `parking.ts`,
`places.ts`, `index.ts`, `src/importers/overpass.ts` (only if the query changes);
`src/network/strips.ts` (band polygon from a mapped area), `src/network/parking.ts`;
`src/schema/city.ts` and `city.schema.ts` (an optional mapped `ring` on `strip`, if needed;
describe it in section 4); `src/render/layers/` and `src/render3d/` only where the band draws
from the mapped ring; `bench/geometry-shots.ts` (new cameras); `docs/architecture.md`
sections 4, 5 and 13; tests (a new `tests/importers/T55-street-side-parking.test.ts`, the
T52 import counts that move, a render case), and the expectations that move, each named with
its reason.

## Out of scope

`src/sim/**` and `src/host/**` (TASK-118, in parallel, owns parking motion, stall choice and
the manoeuvres; strips you import must work with today's simulation unchanged),
`src/network/stalls.ts` and lot circulation (TASK-118), vehicle lanes, nodes, movements and
junction geometry, routing, pedestrians and person trips (TASK-112), marking themes.

## Gates

1. **Network untouched.** The compiled vehicle network for grid, town, Munich and Sindelfingen
   equals main's (hash without parking facilities and their connectors, as T52 does).
2. **Import.** In T55: a street-side area beside a two-way street becomes one strip on the
   correct road and side with the area's run, tagged capacity and orientation; an area 30 m
   from any road becomes a lot; a mapped area suppresses the inferred strip over its stretch
   and nowhere else; save and open keep the strips; a file without them opens unchanged.
   Munich: at least 55 of the 57 street-side areas imported as strips or lots, each other one
   named with its reason; the two private surface lots and the multi-storey garage imported;
   Sindelfingen counted and reported the same way.
3. **Traffic.** `npm run traffic:quick` against main (3 296 / 32 / 5 after the lead's follow-up).
   Every failure is a gridlock or a counted parking failure, parking failures under 2% of
   local arrivals; the lead runs the full gate and resets the baseline at merge.
4. **Render.** 2D and 3D shots: `V119-munich-street-side` (a stretch of mapped street-side bays
   at 08:00, cars parked in them) and its 3D version, and the same stretch on main for
   comparison; read them yourself: the band follows the mapped area, cars sit inside it, no
   double band, nothing else moves.
5. **Performance.** Import and compile within 10% of main on Munich and Sindelfingen.
6. `npm run check`, `npm run test:city`, `npm run traffic:quick` and `npm run test:e2e:smoke`
   green, plus `T52-parking-cities`. Heavy e2e cases need `test.setTimeout(420_000)` for CI's
   software GPU. Run e2e with `CITYFLOWS_TEST_PORT=5319`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run traffic:quick`,
  `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick`,
  `npm run test:e2e:smoke` and `T52-parking-cities`.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`; the lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5319`), import
Munich, find mapped street-side bays (the parking places that showed empty before), play
from 07:00 with "Parked cars" on and watch them fill and empty; select one in the road
inspector; describe what you saw in 2D and 3D.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the area-to-strip
rule as implemented, the counts per city with every skipped area and its reason, the cause and
fix for the dropped lots and garage, traffic before and after, image paths, files changed
outside the pre-approved list and why, expectations changed with their reasons, and the
final lines of `npm run check`. Report every timing that grew against main (import, compile,
placement), even when no gate covers it. Write any Markdown or docs as UTF-8.

Commit on `task/119-street-side-parking`; do not push or merge. The lead reviews only commits.
