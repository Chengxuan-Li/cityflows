# TASK-006 — Renderer

Owner: unassigned
Gate: 1
Depends on: TASK-001 (uses `VehicleSnapshot` type from section 8; no sim code needed)

## Goal

A PixiJS 8 scene that draws a `CompiledCity` and animates a `VehicleSnapshot` in the cartoon
style from `AGENTS.md`, with pan and zoom, level of detail, and picking, as in architecture
section 11.

## In scope

- `src/render/`: `scene.ts` (`createScene(canvas): Scene` with `setCity(compiled)`,
  `setSnapshot(snapshot)`, `setSelection(sel)`, `setRouteOverlay(route | null)`,
  `setHeat(roadSpeedRatio | null)`, `pick(screenX, screenY): Pick | null`, `camera`),
  `camera.ts` (pan, zoom at pointer, fit to bounds, world to screen), `style.ts` (colors,
  widths, zoom thresholds), `layers/roads.ts` (surfaces, lane markings, arrows for legal
  movements only), `layers/nodes.ts`, `layers/places.ts` (polygons, connectors), `layers/
  signals.ts` (heads colored by phase state, fed from the snapshot time and compiled signal
  tables), `layers/vehicles.ts` (ParticleContainer, rounded rectangles above a zoom
  threshold, dots below, `lateralM` applied, color by state), `layers/overlay.ts`
  (selection, route), `picking.ts`.
- `dev/render.html` and `dev/render.ts`: a dev page served by Vite that shows `grid5x5` with
  a synthetic moving snapshot (vehicles advanced along lanes by a timer) for visual checks.
  Not included in the production build.

## Out of scope

- React, the store, any UI chrome (TASK-009).
- Tiles (TASK-024), heat styling beyond a single color ramp (TASK-041).

## Interfaces

```ts
type Pick = { kind: 'vehicle'; id: number } | { kind: 'lane'; lane: number; road: number }
  | { kind: 'node'; node: number } | { kind: 'place'; place: number } | { kind: 'connector'; connector: number };
```
`Scene` never imports React or Zustand (lint-enforced).

## Acceptance

- The dev page shows every fixture from `src/fixtures` selected by query string: lanes are
  distinct, arrows appear only where compiled movements exist, two-way streets show both
  blocks side by side, the divided highway shows a bridge without arrows onto the
  carriageways.
- Picking returns the lane under the pointer at any zoom, the nearest vehicle within 8 px,
  places by polygon.
- Static geometry is rebuilt only when `compiled.version` changes; `setSnapshot` with 3 000
  vehicles costs under 2 ms on a desktop (measured with `performance.now` in the dev page,
  reported in the PR).
- Screenshots of `grid5x5` at three zoom levels and of `dividedHighway` are attached to the
  PR.

## Commands

`npm run check`, `npm run dev` then open `/dev/render.html?fixture=grid5x5`.

## Deliverable

PR with renderer, dev page and screenshots.
