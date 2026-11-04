# TASK-051 — Live edits with bounded rerouting

Owner: unassigned
Gate: 5 (owner backlog B8)
Depends on: TASK-046, TASK-048, TASK-049, TASK-055, TASK-057. Design: `docs/architecture.md`
section 1 row 13, section 6 (the run and `city.version`), section 8 "Live edits", section 10
(`patch`), section 14 (T17, T19). Read those before the code.

## Goal

Today every committed edit pauses the run, marks it stale and asks for a restart (T17). The
product needs edits to apply while the city runs: draw a road, ban a turn, change a signal,
split a street, and watch traffic adapt, with only the vehicles that are affected
re-planning, spread over the reroute interval. The design in the architecture fixes the
rules: swap the compiled city under the engine between steps, remap by ids, project cars
whose segment disappeared onto the lane that now occupies their position, strand only cars
whose road is gone, release grants at changed nodes, reroute with reason `edit` only routes
that touch a change, deterministically.

## In scope

- `src/sim`: `engine.ts` (`patch`), a new `patch.ts` with the remapping and projection,
  `reroute.ts` (edit checks scheduled over `rerouteIntervalS` by id, outside `maxReplans`),
  `link-costs.ts` (remap by road id, new roads at free flow, version bump), `signals.ts`
  (restart a patched program from the current time), `types.ts` (`PatchResult`, `routeReason`
  `'edit'`), `vehicle.ts` if the store needs a relocation helper. Nothing moves mid-step.
- `src/host`: `protocol.ts` (`patch` request, wire form as `load`), `worker.ts` (apply between
  ticks, store as the input `restart` reloads, reset the heat throttle), `loop.ts` if the loop
  needs a hook, `client.ts`, `export-data.ts` (road statistics keyed by road id survive the
  patch), `headless.ts` untouched.
- `src/ui`: `store.ts` `edit()` sends the patch instead of marking the run stale; the run keeps
  its status (playing stays playing); `run.cityVersion` follows the patch; stale and
  "Restart to apply changes" remain only for commits that change demand (place kind,
  population, jobs, places added or removed: the existing `populationKey` rule) and for a
  refused patch, whose error is shown. A short status in the run bar after a live patch
  ("Edit applied · 12 cars rerouted · 1 removed") that fades; the vehicle inspector shows
  the `edit` reason. `loadedCompiled` becomes the patched city so picking and overlays
  match.
- Tests: `tests/sim/T19-live-edit.test.ts` (below), `tests/host` (patch round trip through
  the worker protocol with the Flatbush wire form), `tests/e2e/gate1-edit.spec.ts` (T17
  rewritten: an edit while playing applies without restart, the run keeps going, vehicles
  stay inspectable, the banned-movement scenario sees the first departing vehicle reroute
  with reason `edit` or `missed_turn`). Every existing scenario that waits for "Restart to
  apply changes" after a non-demand edit is updated to the new behaviour; the PR lists each.
- Shared files, additive only: `src/ui/App.tsx`, `src/ui/app.css`, `src/ui/run-bar.tsx`.

## Out of scope

- `src/routing` (TASK-062 is changing it in parallel; use `RouteProvider` as it is; the
  cost version bump already rebuilds its caches), `src/network`, `src/editor`, `src/render`,
  the importer, demand regeneration semantics, comparisons (a patch invalidates a comparison
  as any edit does today).

## T19 (unit, `tests/sim`)

1. Conservation: on the grid at 08:00 apply, in turn, `setTurnRule` (ban), `setSignal`,
   `setRoadLanes` (drop a lane under a car), `splitRoad` under a car, `addRoad`, `deleteRoad`
   under a car; after each patch and after 600 more steps the six trip counts sum to the
   trips loaded, no vehicle references a missing lane or movement, and `PatchResult` reports
   the relocations and strandings the case expects (split: relocated 1, stranded 0; delete:
   stranded equal to the cars on it; lane drop: relocated equal to the cars on the dropped
   lane).
2. Determinism: the same patches at the same steps twice give the same hash at every step
   afterwards; a run without the patches differs from the first only after the patch step.
3. Bounded reroute: on the bypass fixture at the morning peak, ban the expressway's merge
   movement; the vehicles scheduled for an `edit` check are exactly those whose remaining
   route uses it, every other vehicle keeps its route and `routeReason`, the checks are
   spread over `rerouteIntervalS` (no step reroutes more than a tenth of them), and a
   vehicle within `decisionDistanceM` of the banned movement reroutes at once.
4. Grants and signals: a car holding a grant at a node whose movement set changed asks again;
   a car on a surviving movement keeps it; a shortened green shows in the next phase.
5. Restart after patches reloads the patched city with the original trips and seed.

## Acceptance

- T19 passes; `npm run check` and `npm run test:e2e` green with the updated scenarios.
- In the browser on the town at 10x: draw a road across a block and ban a turn while playing;
  the run never pauses, the status shows the counts, cars use the new road within
  `rerouteIntervalS`, and `Restart` still replays from the edited city. A place population
  edit still shows "Restart to apply changes".
- A single-road patch on the town takes under 50 ms in the worker (measure and report);
  T16 figures unchanged within noise; the four benchmark state hashes unchanged (the engine
  without patches behaves as before).

## Commands

`npm run check`, `npm run test:e2e` (set `CITYFLOWS_TEST_PORT`), `npm run bench`.

## Deliverable

PR with the engine, host and UI changes, T19, the rewritten T17 scenario, the list of
scenarios touched, the patch timing, and the hashes.
