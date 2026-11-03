# TASK-030 — Activity chains, through traffic and place events

Owner: unassigned
Gate: 3
Depends on: TASK-011, TASK-003

## Goal

Daily life beyond the commute: shop, school and leisure legs, external through traffic
between gateways, scheduled place events (station arrivals, airport waves, school release)
and parking capacity effects, as in architecture sections 7.2 of the brief and 9 of the
architecture doc. T09 in full and T10.

## In scope

- `src/demand/agenda.ts`: chains `home - work - shop? - home`, school for a share of persons,
  leisure in the evening by `attraction`; departure times from the place `profile` when set.
- `src/demand/through.ts`: gateway-to-gateway trips per `throughTripsPerHour`, weighted by
  gateway population and jobs.
- `src/demand/events.ts`: `PlaceEvent` expansion into arrivals and departures for persons
  that are not residents (visitors with a seeded sub-population).
- `src/sim/connectors.ts`: event-driven arrival capacity windows; parking places as a
  capacity constraint with queue and release.
- `src/fixtures/station.ts` (from architecture section 14).
- `tests/demand/T09-daily.test.ts`, `tests/sim/T10-station-surge.test.ts`.

## Out of scope

- Transit legs, walking legs, intermodal itineraries (Gate 5). `TripRequest.legs` must stay
  able to express them.

## Acceptance

- T09: with the full chain, morning and afternoon volumes differ in direction per place,
  trips per person reconcile, and the demand summary totals equal the trip count.
- T10: on `station`, an event at 08:05 produces a time-localized surge of trips to and from
  the station; the pickup loop queue length peaks within 15 minutes after the event and the
  upstream road's mean speed drops measurably compared with no event; two runs with the same
  seed match hashes.
- Through traffic appears only between gateways and never originates inside the map.

## Commands

`npm run check`

## Deliverable

PR with demand extensions, connector changes, fixture and tests.
