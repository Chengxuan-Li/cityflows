# TASK-033 — Place editor and demand panel

Owner: unassigned
Gate: 3
Depends on: TASK-030, TASK-010

## Goal

Places are authored in the UI: kind, population, jobs, capacity, hourly profile, events,
connectors on the map; the demand panel shows what the population will do; the vehicle
inspector explains waits and reroutes. Demos A and B become reachable from the UI.

## In scope

- `src/ui/tools/place.tsx`: click to add a point place or draw a polygon; drag a connector
  handle onto a lane to set `roadId`, `lane`, `positionM`, with the direction toggled on the
  handle.
- `src/ui/inspector/place.tsx`: full editing including a 24-bar profile editor (drag bars),
  event list (name, start, duration, arrivals, departures), capacity and throughput.
- `src/ui/panels/demand.tsx`: persons, trips by hour chart, productions and attractions by
  place, "Regenerate population" with seed, queued-unspawned and failed-by-reason counts
  from the last run.
- `src/ui/inspector/vehicle.tsx`: waiting time and reason (queued at origin, queued at
  destination capacity, signal, yield), route reason.
- `tests/e2e/gate3-places.spec.ts`.

## Acceptance

- e2e demo A: open `grid5x5`, raise residential population to 2 000, restart, assert a
  morning peak in the trips-by-hour chart data and `driving` above a threshold at 08:00.
- e2e demo B: add a station place with an 08:05 event of 300 arrivals and a pickup connector,
  restart, assert the queue metric spikes after 08:05; add a second connector, restart, assert
  the peak queue is lower.
- Every control in the panel changes something observable; no control without effect.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with tools, inspector, panel, e2e tests and screenshots.
