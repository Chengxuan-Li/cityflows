# TASK-323 — Dynamic taxi-flow preferences per runway configuration

Status: in progress 2026-11-23 (split from TASK-322 on the owner's time cut). Proposed owner: Codex CLI
(gpt-6.2-sol, high). Branch `task/323-taxi-flow-preferences`, worktree `D:\cityflows-wt\323`, ports 5523 / 5623.

## Goal

A pure module `src/sim/taxi-flow-preferences.ts` that TASK-322's block clearance reads:

```ts
taxiFlowPreferences(graph: AirsideGraph, configuration: { arrivalEnds: string[]; departureEnds: string[] }):
  { preferred: Int8Array /* per airside edge: 1 along from->to, -1 against, 0 none */; wrongWayCost: number }
```

The owner's framing: one-way taxi flow is a dynamic ATC practice that follows the runway direction in use, a soft
preference to optimise taxi efficiency; it is not in the map data and not a hard constraint. Derive it by rule from
the configuration's routes (stands to the departure ends' line-ups, arrival exits to stands), as TASK-321's bench
does (`bench/block-signalling.ts`, report in `6809c54`): on parallel taxiway pairs and loops assign opposite
directions so the configuration's flows do not meet head-on and total taxi distance stays near the unconstrained
minimum; leave edges with no clear flow at 0. Cache per configuration (the bench took about 1.2 s per Heathrow
configuration: make it fast enough to compute at a configuration change, or precompute at fleet creation).

## Scope

The new module, tests, a short `docs/architecture.md` paragraph. No change to `src/sim/aircraft.ts` (TASK-322 wires
it) or to the schema.

## Gates

- Tests on the synthetic airports and London City: preferences flip with the runway direction; no edge on a route
  of the configuration is preferred against that route where an alternative exists; computation time per
  configuration at Heathrow, Zurich, Boston.
- Per airport and configuration: segments oriented, segments flipping between configurations, route length cost of
  following preferences against the unconstrained shortest routes.
- `npm run check`, `test:city`.

## Report

Write it as the commit body.
