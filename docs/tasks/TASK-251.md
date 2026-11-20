# TASK-251 — Reroute checks skip the lane search when no switch is possible (results identical)

Status: done 2026-11-20 (merged; review in `docs/plan.md`). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/251-reroute-skip`, worktree `D:\cityflows-wt\251`, ports 5451 / 5551.

## Goal

TASK-243 (review in `docs/plan.md`) made route requests 59% faster with identical results and found one
more exact cut it could not take without an interface change: a reroute check asks for a full route
(road search, then lane search) and switches only if the new route beats the current one by the reroute
hysteresis (`rerouteHysteresis`, 0.15). When the road search's cost alone already fails that threshold,
no lane search can make the switch happen, so the lane search is wasted (TASK-243 estimated up to about
30 of the 54 s of reroute requests left at full demand).

Add an optional bound to `RouteProvider.route` (a cost above which the caller does not need the route;
the provider may return early with a marker), use it from the engine's reroute check, and update the
interface's description in `docs/architecture.md` (the lead authorises this contract change: an optional
parameter, default behaviour unchanged). Every result must stay identical: a check that the skipped case
would not have switched, under `debugSkips`.

## Scope

`src/routing/**`, the engine's reroute check in `src/sim/engine.ts` (performance only), the
`RouteProvider` description in `docs/architecture.md`, tests.

Out of scope: any change to results, `src/sim/signals.ts` (TASK-250), `src/sim/walkers.ts` (TASK-249),
`src/sim/rail-crossings.ts`, `src/network`, `src/schema`, gate floors, fixtures.

## Gates

- Identical state hashes, main against branch: Munich 0.15 seeds 1 to 3, choice off and on, both modes;
  both full demands; Freiburg's gate and seeds 2 and 3; Sindelfingen; with and without `debugSkips`.
- Route time and stepping main against branch, interleaved, at least two pairs per mode, with load.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the cut, the interface change, the hashes, the timings.
