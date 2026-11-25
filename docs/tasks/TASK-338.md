# TASK-338 — Gates on taxiway stretches that run on runway pavement

Status: merged 2026-11-25 in the owner's 6-hour run, under the owner's merge-on-gates rule. Built 2026-11-24 by a
Claude subagent from the lead's brief (branch `task/338-runway-pavement-gates`, `3d81b0e7`).

## Finding (TASK-330 planner pilot, 2026-11-24)

At Heathrow's 27L east end, taxiways N1 and N2E run along the runway on its pavement with no runway gate. They pass
node 651, 1 m from runway node 2. A taxiing aircraft could therefore be on the runway without a grant. This caused an
overlap in the planner + R pilot run.

Taxiway stretches on runway pavement:

| Airport | Stretches | With no runway node at either end |
|---|---|---|
| Heathrow | 57 | 17 |
| Zurich | 65 | 22 |
| Boston | 55 | 7 |
| London City | 15 | 0 |

## Change

- `buildLeg` samples each taxi edge every 2 m within half the runway's width, between its ends (a `pavement(edgeIdx)`
  cache).
- A stretch on pavement adds a runway range, and with it a gate, unless it lies within `HOLD_FALLBACK_M` (75 m) of an
  existing range.
- New test `tests/sim/runway-pavement.test.ts`. In `tests/sim/aircraft.test.ts`, the check "y < 100" became "arrival
  off the runway at grant".

## Gates

- Main's traffic is identical with and without the change:
  - Heathrow 06:00–08:00 seed 1: 80/188;
  - Zurich 730 seed 1, 06:00–10:00: 165/199;
  - Boston 06:00–10:00: 159/223;
  - London City full day: 150/150.
- On the pilot stacks it gates the stretches the pilots drove onto.
- Light tiers green on the branch: check, city, traffic, airports, e2e, places. Freiburg hash 1710089250.
