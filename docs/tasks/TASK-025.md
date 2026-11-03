# TASK-025 — GeoJSON feature import and export

Owner: unassigned
Gate: 2
Depends on: TASK-008, TASK-020

## Goal

Documented interchange for user-authored roads and places: import GeoJSON features into an
existing city with id conflict handling, and export roads and places as GeoJSON with the
lossy fields named.

## In scope

- `docs/geojson.md`: the feature schema (LineString roads with `lanes`, `oneway`, `speed`,
  `class`, `name`; Point or Polygon places with kind, population, jobs; optional stable
  `cityflows:id`).
- `src/importers/geojson/index.ts`: `importGeoJson(city, geojson, options): { ok, city,
  diagnostics, idMap }`; new ids are assigned, incoming `cityflows:id` values that collide
  with existing entities are remapped and reported, nothing is overwritten silently; roads
  are connected by snapping endpoints to existing nodes within a tolerance, otherwise new
  nodes are created; lon/lat is projected through `city.geo` (error when the city has no
  geo and the file is geographic).
- `src/project/geojson.ts`: `exportGeoJson(city)` with lane, rule and signal semantics
  dropped and listed in a `cityflows:lossy` property on the FeatureCollection.
- Wizard source option "GeoJSON file" (reuses TASK-021's wizard) and an Export GeoJSON menu
  entry.
- `tests/importers/geojson.test.ts`, `tests/project/geojson-export.test.ts`.

## Acceptance

- Import of a file with two roads and a place onto `grid5x5` compiles without errors; a
  colliding id is remapped and appears in `idMap` and diagnostics.
- Export then import of authored roads round-trips geometry and attributes within tolerance.

## Commands

`npm run check`

## Deliverable

PR with importer, exporter, the format doc and tests.
