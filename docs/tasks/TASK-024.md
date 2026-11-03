# TASK-024 — Raster tile backdrop

Owner: unassigned
Gate: 2
Depends on: TASK-006, TASK-020

## Goal

An optional OSM raster tile layer under imported cities so the real place is recognizable,
aligned with the local frame by the affine in architecture section 3.

## In scope

- `src/render/layers/tiles.ts`: tile pyramid selection by zoom, placement with
  `local = (merc - merc0) * scale`, LRU cache, fade-in, no requests when `city.geo` is null,
  graceful absence (offline or blocked tiles produce no errors and no retries storm).
- `src/ui/layers.tsx`: a layer toggle (off by default for synthetic cities, on for imported)
  and the tile attribution line.
- Tile URL template and attribution in one settings constant; default to the OSM standard
  tile layer with its usage policy respected (no bulk prefetch, browser caching only).

## Acceptance

- With the downtown fixture imported, roads overlay the tiles within a few pixels at zoom
  levels 15 to 18 (screenshots in the PR).
- Panning and zooming stays at 60 FPS with tiles on (measured in the dev page).
- Toggling off removes all tile sprites; no network requests for synthetic cities.

## Commands

`npm run check`

## Deliverable

PR with the layer, toggle, and screenshots.
