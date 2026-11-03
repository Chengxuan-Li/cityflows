# TASK-002 — Lane-feasible routing

Owner: unassigned
Gate: 1
Depends on: TASK-001

## Goal

A `RouteProvider` that returns legal, lane-feasible routes by expected travel time, with
structured failures, exactly as in architecture section 7.

## In scope

- `src/routing/`: `index.ts` (`createRouteProvider(): RouteProvider`), `graph.ts`
  (road-level adjacency derived from compiled movements, cached per `compiled.version` and
  vehicle class), `heap.ts` (binary heap), `search.ts` (Dijkstra with per-vehicle cost
  noise), `lanes.ts` (backward feasibility and origin check), `lane-search.ts` (lane-level
  fallback), `costs.ts` (turn and control penalties, `freeFlowLinkCosts(compiled)`).
- `tests/routing/`.

## Out of scope

- Congestion-aware costs and rerouting policy (TASK-031). `LinkCosts` is an input here.
- Any change to `CompiledCity`. If a derived table is missing, compute it inside routing and
  report it to the lead.

## Interfaces

`RouteRequest`, `Route`, `RouteResult`, `RouteFailure`, `LinkCosts`, `RouteProvider` from
architecture section 7. `laneChangeDistanceM` is passed in through a `RoutingParams`
argument of `createRouteProvider` with the default 30.

## Acceptance tests

- `tests/routing/T04-turn-restriction.test.ts`: on `grid5x5`, ban the only convenient left
  turn toward the work place; no returned route contains a banned movement; when every path
  is cut, the result is `{ ok: false, reason: 'no_path' }`.
- `tests/routing/T05-expressway-preference.test.ts`: on `bypass` with `noise: 0`, the route
  uses the longer expressway because expected time is lower; lowering the expressway speed
  limit below the break-even flips the choice; with `noise: 0.3` and 200 seeds, both routes
  appear.
- `tests/routing/lane-feasibility.test.ts`: on `shortTurnLane`, a vehicle in the wrong lane
  too close to the turn gets a lane-level route or `lane_infeasible`, never a road-level route
  whose first movement it cannot reach; `targetLanes` for each road are non-empty and every
  listed lane really has a movement into the next road.
- `tests/routing/classes.test.ts`: a truck request across a car-only lane returns
  `class_forbidden` when no alternative exists; `neverGreen` movements are never used.
- `tests/routing/determinism.test.ts`: same request and seed give identical routes; the
  graph cache keys on `compiled.version`.
- Log (not assert) the time for 1 000 routes on `grid5x5` in the PR description.

## Commands

`npm run check`

## Deliverable

PR with the provider and tests; PR text lists the turn and control penalty defaults used and
any deviation from section 7.

## Integration notes

The sim (TASK-003) calls `route()` synchronously inside the worker. Keep the provider free of
allocation-heavy per-call setup: build the graph once per version.
