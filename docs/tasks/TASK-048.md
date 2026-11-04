# TASK-048 — Import quality on real OSM data

Owner: unassigned
Gate: 5 (owner backlog B2, B3, B5)
Depends on: TASK-020, TASK-030

## Goal

A real extract imports into a connected, drivable city with demand: no interlocking
micro-junctions, feeders joined to both carriageways and all lanes of their direction,
gateways where highways leave the area so they carry cars, and residential and work places
from buildings and land use inside the area. The reference extract and its baseline are in
`docs/plan.md` ("Reference extract and import baseline"); `npm run import-probe` is the
measurement.

## In scope

- `src/importers/osm/split.ts`, `roads.ts`, `turns.ts` (B2): merge drivable segments shorter
  than 30 m between degree-two nodes with equal attributes before compiling; join a feeder
  that meets a divided street to both carriageways (a node on one carriageway within the
  median width of the other gets a crossing link, or the feeder is split so both directions
  connect); when a one-lane road joins a multi-lane road, generate movements to every lane
  of the matching direction (compiler lane assignment, `src/network/movements.ts`, as a
  contract amendment to architecture 5.2 if needed, stated in the PR); keep
  `road_too_short` and `dead_end` diagnostics but expect them to drop by an order of
  magnitude on the reference extract.
- `src/importers/osm/places.ts` (B3): a gateway at every clipped end of a motorway, trunk,
  primary and secondary road with population and jobs by class and lane count, one per
  carriageway pair, none at clipped ramps whose parent carriageway also leaves; verify that
  cars enter and leave on the ring and the trunk links.
- `src/importers/osm/places.ts` and a new `buildings.ts` (B5): residential, commercial,
  retail and industrial land use and building footprints inside the area become places with
  population or jobs from footprint area and `building:levels` (defaults stated), merged per
  block so the city gets tens of places, not thousands; connectors on the nearest drivable
  lane; parking and schools stay as they are. The raw extract already contains buildings and
  land use.
- `bench/import-probe.ts`: keep it working; add the share of trips completed.
- `tests/importers/munich.test.ts`: imports the reference extract, asserts the targets below.

## Out of scope

- UI, renderer, sim, roundabouts, pedestrian crossings. The wizard stays as it is.

## Acceptance

- On the reference extract: `connector_unreachable` 0, every connector pair routable, under
  1 percent failed trips in the 07:00 to 10:00 probe run, residential and work places
  present with a population between 10 000 and 40 000, `road_too_short` under 20,
  `dead_end` under 15 (list the rest by id with a reason).
- The three existing fixtures still import with the same or fewer warnings; existing
  importer tests pass; `npm run check` green; demo D passes.

## Commands

`npm run check`, `npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148`

## Deliverable

PR with the importer changes, the test, and the before and after probe table.
