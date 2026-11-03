# TASK-041 — Metrics, layers and charts

Owner: unassigned
Gate: 4
Depends on: TASK-005, TASK-006

## Goal

Readable congestion feedback: road heat by speed ratio, queue markers, a bottom chart of
trips and delay over simulated time, and layer toggles.

## In scope

- `src/render/layers/heat.ts`: road coloring by `roadSpeedRatio` with a single sequential
  ramp; queue markers at lane ends where stopped vehicles accumulate (derived from the
  snapshot).
- `src/ui/layers.tsx`: toggles for heat, queues, places, connectors, signals, routes of
  selected vehicles, disconnected segments (from diagnostics).
- `src/ui/panels/metrics.tsx`: time series (sampled every simulated minute from `metrics()`)
  of driving, queued and completed counts and mean delay; plain-language labels; the
  synthetic notice.
- `src/host`: a `metricsSeries` request that returns the sampled series from the worker so
  the main thread does not poll.

## Acceptance

- Heat updates at most twice per second and costs under 1 ms per update at 3 000 vehicles.
- The chart shows a morning peak on `grid5x5` with 2 000 residents.
- Toggling layers never affects the simulation hash.

## Commands

`npm run check`

## Deliverable

PR with layers, panel and screenshots.
