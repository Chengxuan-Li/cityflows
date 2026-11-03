# TASK-004 — Lane changing and route following

Owner: unassigned (preferably the TASK-003 agent, continuing in `src/sim`)
Gate: 1
Depends on: TASK-003

## Goal

Vehicles use multi-lane roads: discretionary MOBIL lane changes and mandatory route-aware
changes that bring a vehicle into a `targetLanes` lane before its turn, with the fallback
behavior from architecture section 8 when the change does not happen in time.

## In scope

- `src/sim/lane-change.ts`: proposal generation (mandatory and discretionary), gap checks,
  resolution in proposal order, `lateralM` animation state.
- `src/sim/engine.ts`: wire the proposal and resolution hooks; leader lookup across the
  lane the vehicle is moving into.
- `src/sim/params.ts`: MOBIL parameters as in section 8.
- `tests/sim/T03-multi-lane-queue.test.ts`, `tests/sim/T07-lane-aware-ramp.test.ts`
  (partial), `tests/sim/lane-change.test.ts`.

## Out of scope

- Merge-specific cooperative behavior and ramp construction (TASK-032).
- Any routing change. If `targetLanes` is wrong, report to the lead and TASK-002.

## Interfaces

No contract change. `VehicleSnapshot.lateralM` is filled here.

## Acceptance tests

- T03 full: on `signalApproach` with trips spread over both lanes' routes, both lanes carry
  queues, no two vehicles share a lane position within `vehicleLengthM`, and the queue on each
  lane dissipates after green.
- Mandatory change: on `grid5x5`, a vehicle spawned in the lane that cannot make its next turn
  on a long road changes lane before the decision point and takes the planned movement.
- On `shortTurnLane`, a vehicle that cannot change in time takes a legal movement and is
  rerouted with `missed_turn`; no illegal movement is ever traversed (assert against the
  movement table at every step).
- MOBIL safety: in a 200-vehicle run no follower is forced below `-safeDecelMps2` by a lane
  change (check the resolved proposals).
- T07 partial on `ramp`: vehicles leaving at the exit are in the exit lane before the diverge;
  vehicles entering from the on-ramp enter the motorway only through the merge movement.
- T02 still holds with lane changes enabled (hash equality across two runs).

## Commands

`npm run check`

## Deliverable

PR with tests. Description states the gap acceptance thresholds and how the forced change
degrades (creep speed, give-up distance).
