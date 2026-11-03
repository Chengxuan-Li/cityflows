# TASK-021 — Import wizard, Overpass provider and file upload

Owner: unassigned
Gate: 2
Depends on: TASK-020, TASK-009

## Goal

The "choose a city" step of the user workflow: pick an area on a map or upload a file, see
import diagnostics and attribution, accept, and land in the editor with the imported city,
without freezing the UI.

## In scope

- `src/importers/overpass.ts` (query builder for drivable highways and restriction relations
  in a bbox; area cap from architecture section 13; one request in flight; endpoint from
  settings; abortable), `src/importers/cache.ts` (IndexedDB cache keyed by bbox and query
  version), `src/importers/worker.ts` (import worker running `importOsm`, with progress
  messages).
- `src/ui/import/`: `wizard.tsx` (steps: source, area, options, diagnostics, accept),
  `area-picker.tsx` (MapLibre GL map with OSM raster tiles and a drag rectangle; manual bbox
  fields always available), `diagnostics-step.tsx` (errors block accept, warnings listed,
  inferred counts, attribution text), file input for `.osm`.
- `package.json`: add `maplibre-gl` (BSD-3), used only in the wizard and loaded lazily.
- `tests/e2e/gate2-import.spec.ts` using a fixture file upload (no network in CI).

## Out of scope

- Nominatim search (optional later; if added, one request per second on explicit submit
  only).
- GeoJSON import (TASK-025).

## Acceptance

- Upload the downtown fixture: progress shown, diagnostics step lists warnings with counts,
  accept loads the city, the run bar shows the OSM attribution, the renderer shows the roads
  with correct one-way arrows.
- Overpass path (manual check with a tiny bbox, recorded in the PR): second import of the same
  bbox is served from the cache (no network request), the area cap refuses an oversized bbox
  with a clear message, cancel aborts the request.
- The UI thread stays responsive during import of the largest fixture (the run bar clock
  keeps updating if a run is playing).
- e2e: upload, accept, assert road count in the diagnostics summary and that vehicles can be
  generated once places are added (adds one residential and one work place through the
  inspector, restarts, asserts `driving > 0`).

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with wizard, provider, cache, worker, e2e test and screenshots of each wizard step.
