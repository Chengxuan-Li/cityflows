# TASK-057 — Pass-through at conflict-free nodes

Owner: unassigned
Gate: 5 (owner backlog B18, behaviour)
Depends on: TASK-046, TASK-049

## Goal

A node where nothing can conflict should drive like the road itself. Today every movement
goes through the request, resolve and grant cycle in `src/sim/intersection.ts`
(`engine.ts` requests at the approach, `resolve()` grants once per step), including the
single movement of a degree-two node and every movement of an uncontrolled junction whose
`conflicts` list is empty. That adds a step of latency per node, makes a platoon's followers
wait for the leader's grant, and is part of why a junction node feels different from a road
section. Imported cities have many such nodes even after the short-section merge.

## In scope

- `src/sim/intersection.ts` and the grant path in `src/sim/engine.ts`: a movement at an
  uncontrolled node with no conflicts, no signal and no stop or yield obligation is a
  continuation: a vehicle enters it without a request or grant, the exit clearance check is
  the ordinary car-following gap to the vehicle ahead across the node, and occupancy
  accounting for it is skipped or granted on the same step (whichever keeps the hash code
  simple). Movements with conflicts, signals, stop, yield, merges (`merge.ts`) and turn on
  red keep the current cycle.
- `src/sim/vehicle.ts` if the leader lookup across a node lives there.
- `tests/sim`: a lone vehicle and a platoon of ten through a road split into three sections
  by two degree-two nodes arrive within one step of the same vehicles on one road of the
  same length; a conflict-free T-junction (one-way roads that cannot cross) behaves the
  same; T01, T02, T03, T08 and the platoon test unchanged in meaning (expected hashes may
  change; state which and why).

## Out of scope

- `src/network` (the conflict lists are the compiler's and TASK-055 edits that module in
  parallel; if a conflict list looks wrong, report the node), the renderer's junction look
  (B16), routing, the importer.

## Acceptance

- Measured before and after on the town day (`npm run bench`, 12 640 trips requested,
  12 571 completed, 0 failed at 18:00 in the plan) and on the Munich morning probe:
  completed count and mean delay do not get worse; steps per second not lower than before.
- The town's and grid's 24 h benchmark hashes are listed before and after; any change is
  explained by the new rule alone.
- `npm run check` green; `npm run test:e2e` green.

## Commands

`npm run check`, `npm run test:e2e`, `npm run bench`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148`

## Deliverable

PR with the rule, the tests and the before and after measurements.
