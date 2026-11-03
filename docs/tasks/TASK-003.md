# TASK-003 — Simulation core

Owner: unassigned
Gate: 1
Depends on: TASK-001, TASK-002 (and TASK-000 recommendations for IDM and signals)

## Goal

The headless, deterministic, fixed-step traffic engine from architecture section 8: vehicle
lifecycle through connectors, IDM car following, explicit intersection occupancy with
deterministic arbitration, conservative signals, conservation accounting, metrics and the
state hash. Lane changes are the next task; vehicles here stay in their lane.

## In scope

- `src/sim/`: `params.ts` (`SimParams` defaults), `types.ts` (engine types from section 8), `engine.ts` (`createEngine():
  TrafficEngine`, step sequence with explicit proposal, resolution and commit phases and hook
  points for lane changing), `vehicle.ts` (dense vehicle arrays), `idm.ts`, `signals.ts`
  (phase state), `intersection.ts` (occupancy, grants, arbitration, downstream blocking,
  yield and stop gaps), `connectors.ts` (spawn queues, arrival capacity and throughput),
  `metrics.ts`, `hash.ts`.
- `tests/sim/`.

## Out of scope

- `src/sim/lane-change.ts` and MOBIL (TASK-004). Leave the hook points.
- Congestion costs and rerouting policy (TASK-031), place events (TASK-030), merge-specific
  behavior (TASK-032).
- Any Worker code (TASK-005).

## Interfaces

`TrafficEngine`, `SimParams`, `VehicleSnapshot`, `Metrics`, `VehicleDetail`, `VehicleState`,
`FailReason` from section 8. The engine takes a `RouteProvider` and `LinkCosts` at `load`;
Gate 1 uses `freeFlowLinkCosts`.

## Acceptance tests

- `tests/sim/T01-conservation.test.ts`: load 300 trips on `grid5x5`, step 2 hours; at every
  100th step the six trip counts sum to 300; at the end every trip is completed or failed
  with a reason, or still queued with a recorded waiting time; no vehicle id is lost.
- `tests/sim/T02-determinism.test.ts`: two engines with the same inputs produce equal
  `stateHash()` at every step for 3 000 steps; a different scenario seed changes the hash;
  `restart` reproduces the first run.
- `tests/sim/T03-queue-single-lane.test.ts`: on `signalApproach` with vehicles spawned in one
  lane, vehicles stop at red, gaps never fall below `minGapM`, the queue grows during red and
  dissipates during green; no vehicle enters on red.
- `tests/sim/T08-connectors.test.ts`: a destination place with `capacity: 0` makes arriving
  vehicles `queued_destination` at the connector, and the vehicle behind them stops behind
  them (spillback); raising capacity releases them; `throughputPerMin` limits departures.
- `tests/sim/intersection.test.ts`: at every step no two vehicles occupy conflicting
  movements; a vehicle never enters a movement whose exit lane start is occupied; at a stop
  node a minor-road vehicle stands for at least one step before entering; at a yield node it
  waits for a `gapS` gap; priority order is respected across 500 steps with heavy flow.
- `tests/sim/route-following.test.ts`: a vehicle whose target lane is unreachable (spawned in
  the other lane, lane changes disabled in this task) takes a legal movement, gets a
  `missed_turn` reroute and still completes or fails `stranded`; it never jumps lanes.
- `tests/sim/T15-unsupported-mode.test.ts`: `walk` trips fail at load with
  `unsupported_mode`; no vehicle is created for them; counts still reconcile.

## Commands

`npm run check`

## Deliverable

PR with engine and tests. The description lists the IDM parameters, the arbitration order
exactly as implemented, and anything adapted from upstream (with `NOTICE` entries).

## Integration notes

Keep per-step allocations near zero: preallocate typed arrays sized to the trip count, store
vehicles per lane in index arrays kept sorted by position, and reuse snapshot buffers only
when the host has returned them (the host transfers them away).
