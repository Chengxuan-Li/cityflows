# TASK-011 — Demand v1: population and commute trips

Owner: unassigned
Gate: 1
Depends on: TASK-001

## Goal

Persistent persons with home and work assignments and a home-work-home agenda, scheduled into
`TripRequest`s deterministically, as in architecture section 9. This is what Gate 1 spawns.

## In scope

- `src/demand/`: `population.ts` (`generatePopulation`), `schedule.ts` (`scheduleTrips`),
  `summary.ts` (`demandSummary(trips, city)`: trips by hour and by place, totals),
  `index.ts`. Randomness comes from `src/geo/random.ts` (TASK-001).
- `tests/demand/`.

## Out of scope

- Activity chains beyond home-work-home, through traffic, place events (TASK-030).
- UI (TASK-033).

## Interfaces

Section 9 types and functions. `scheduleTrips` output is sorted by `departS` then `id`.

## Acceptance tests

- `tests/demand/T09-commute.test.ts`: on `grid5x5` with 400 residents and 300 jobs,
  `personsPerResident: 1`, morning trips (06:00 to 10:00) go residential to work and
  afternoon trips (15:00 to 20:00) go work to residential; totals reconcile (one outbound and
  one return per person with a car); departures are spread (no minute carries more than 10
  percent of trips).
- `tests/demand/gravity.test.ts`: with two work places, the nearer one receives more
  assignments; raising `gravityScaleM` flattens the split.
- `tests/demand/determinism.test.ts`: same seed gives identical persons and trips; the same
  persons scheduled twice give identical trips; a different seed differs.
- `tests/demand/T15-modes.test.ts`: persons without a car get `walk` trips with one `walk`
  leg; the trips validate against the Zod schema and contain no vehicle reference.

## Commands

`npm run check`

## Deliverable

PR with generator, scheduler, summary and tests.
