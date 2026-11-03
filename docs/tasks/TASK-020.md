# TASK-020 — OSM importer and fixtures

Owner: unassigned
Gate: 2 (may start as soon as TASK-001 merges)
Depends on: TASK-001 (and TASK-000 recommendations on tag inference)

## Goal

Turn an OSM XML extract into a `City` with lanes, turn rules, controls, gateways and
provenance, with diagnostics that stop bad maps, following architecture section 13 step by
step. Pure code, runs in Node tests and in the import worker alike.

## In scope

- `src/importers/types.ts` (`ImportResult = { ok: true; city; diagnostics } | { ok: false;
  diagnostics }`, `ImportOptions = { bbox?, drivingSide?, importerVersion }`).
- `src/importers/osm/`: `parse.ts` (fast-xml-parser), `filter.ts` (drivable ways, service
  rules), `split.ts` (junction detection, way splitting), `project.ts` (GeoReference at
  bbox center), `roads.ts` (one-way and two-way, lanes, speeds, widths, provenance),
  `turns.ts` (`turn:lanes`, restriction relations), `controls.ts` (signals with generated
  programs, stop, give way), `clip.ts` (bbox cut and gateway places), `places.ts` (parking,
  station, aerodrome, school, mall), `index.ts` (`importOsm(xml: string, options):
  ImportResult`).
- `fixtures/osm/`: three small real extracts fetched once from Overpass and checked in with
  `ATTRIBUTION.txt` (source, date, bbox, ODbL): a one-way downtown grid (about 1 km
  squared), a divided highway with a bridge and a ramp, a suburban residential area. Keep each
  under 2 MB.
- `tests/importers/`.
- `package.json`: add `fast-xml-parser` (MIT).

## Out of scope

- Overpass networking, caching, the wizard UI (TASK-021).
- PBF.

## Acceptance tests

- `tests/importers/T11-real-map.test.ts`: each fixture imports with `ok: true`; in the
  downtown grid, one-way ways produce one road and their movements only follow the one-way
  direction; in the highway fixture, each carriageway is its own road with
  `streetGroupId: null`, the bridge shares no node with the roads below (assert no movement
  between them), the ramp road has class `ramp` with merge and diverge movements; a
  restriction relation in any fixture becomes a `TurnRule` with `allowed: false` and the
  corresponding movement is absent after compile; `turn:lanes` becomes lane-level rules.
- `tests/importers/T18-diagnostics.test.ts`: malformed XML gives `ok: false` with a parse
  error; an extract with no drivable ways gives an error; missing `lanes` tags produce
  provenance `inferred: ['lanes']` and the `inferred_attributes` warning count matches;
  clipping produces gateway places at every cut road end with the right connector direction.
- `tests/importers/determinism.test.ts`: importing the same file twice yields deep-equal
  cities including ids.
- Report (not assert) import time for the largest fixture in Node.

## Commands

`npm run check`

## Deliverable

PR with the importer, fixtures with attribution and tests. The description lists every tag
handled and every class default used.
