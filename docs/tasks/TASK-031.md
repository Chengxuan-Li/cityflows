# TASK-031 — Congestion-aware routing

Owner: unassigned (sequenced with any other `src/sim` task)
Gate: 3
Depends on: TASK-002, TASK-004

## Goal

Vehicles react to congestion: observed travel times feed route costs, and a bounded,
hysteretic rerouting policy lets some vehicles divert without synchronized oscillation (T06).

## In scope

- `src/sim/link-costs.ts`: per-road EWMA of observed traversal time (alpha 0.3, updated
  every 60 simulated seconds from vehicles that completed the road; roads with no
  observation decay toward free flow), exposed as `LinkCosts` with a version.
- `src/sim/reroute.ts`: every `rerouteIntervalS` (default 120 s, staggered per vehicle by
  id) a driving vehicle re-evaluates its remaining route; it switches only if the new cost is
  below `(1 - hysteresis) *` current remaining cost with hysteresis 0.15, at most
  `maxReplans` (3) per trip, never within `decisionDistanceM` of a node; the change is
  recorded with `routeReason: 'congestion'`.
- `src/routing`: accept a `LinkCosts` whose version changes and rebuild only the cost arrays,
  not the graph.
- `tests/sim/T06-congestion-reroute.test.ts`.

## Acceptance

- T06 on `bypass`: with the expressway exit blocked by a zero-capacity place for 20 minutes,
  some vehicles reroute to the local street with reason `congestion`; after release, the
  share switching back per interval never exceeds 30 percent of eligible vehicles (no
  oscillation); hashes match across two runs.
- Vehicles in a signal queue are not counted as "observing" an unrealistically slow road for
  a road they have not left yet (observations are made on exit).

## Commands

`npm run check`

## Deliverable

PR with costs, policy and test; description lists the parameters and the measured share of
rerouted vehicles in T06.
