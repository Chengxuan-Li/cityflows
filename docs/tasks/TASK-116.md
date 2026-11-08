# TASK-116 — Lane targets as feasible sets for every route

Owner: unassigned
Gate: traffic quality (lead, 2026-11-08, from the TASK-101 review); Phase 2 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/116-lane-targets` (created by the lead from main)
Depends on: TASK-076 (lane search and mandatory changes), TASK-101 (the restricted-route fix
this task generalises). Design: this file; `docs/architecture.md` section 7 (routing, the
"TASK-101" note under target lanes) and sections 9 and 10 (simulation, mandatory changes).
Read those before the code.

## Goal

The lane search (`src/routing/lane-search.ts`) returns one target lane per road, with an
arbitrary timing among equal-cost lane changes, and the simulation treats that lane as
compulsory. A driver therefore cannot pass a stopped queue in another legal lane on the same
road chain. TASK-101 found this when vans tipped Munich into gridlock and fixed it only for
routes that cross a lane their class may not use: in `createRun` (`src/sim/engine.ts`) such
routes get `resolveLanes`' feasible sets instead. Every other route keeps singleton targets.
Munich's morning still ends with 75 gridlocked trips (baseline 57) and one stalled jam head.

Give every route the feasible target sets, in the routing layer rather than as a wrapper in the
engine, and measure what it does to Munich's gridlock.

## Design

1. **Routing returns sets.** The route provider (`createRouteProvider` in
   `src/routing/index.ts`, `lane-search.ts`, `lanes.ts`) returns, for each road of the chosen
   chain, every lane from which the route's next movement can still be reached with the lane
   changes the remaining length allows (what `resolveLanes` computes), keeping the selected
   roads, movements, cost, failures and the destination lane. Architecture section 7 item 5
   already describes `targetLanes[i]` as `feasible[i]`; make the code match it and update the
   TASK-101 note.
2. **Remove the engine wrapper.** Delete the restricted-route special case in `createRun`
   (`src/sim/engine.ts`) once routing provides the sets; injected test providers keep working.
3. **Keep TASK-076's intent.** A route still never plans a change it can avoid: the preferred
   lane (fewest changes, then left before right) stays first or is otherwise marked, so the
   simulation's mandatory-change logic (`src/sim/lane-change.ts`) moves a driver only when its
   current lane is not in the set, and discretionary changes (MOBIL) may use any lane of the set.
   T29 (mandatory changes, cooperative gaps, give-up) must keep passing; if a T29 case
   relied on a singleton, explain and adapt it without weakening what it proves.
4. **Rerouting and patches.** Reroutes (`src/sim/reroute.ts`) and live-edit patches
   (`src/sim/patch.ts`) carry sets the same way; the dropped-lane fallback stays exact.
5. **Measure.** Munich morning (`npm run traffic:quick` and the quick tier's per-road
   gridlock list): completed, gridlocked, stalled heads, mean delay, against main, plus the
   time per route request (routing must not become noticeably slower; report the mean on
   Munich).

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, injected
providers in tests, fixtures, shared types, test helpers), as long as it is not named under
"Out of scope"; list each such file and why in your report. Stop and ask the lead only for a
file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature. Changed trip counts and moved pinned simulation results
are expected; that is not a behaviour change to ask about.

Pre-approved, no need to ask: `src/routing/index.ts`, `lane-search.ts`, `lanes.ts`;
`src/sim/engine.ts`, `lane-change.ts`, `reroute.ts`, `patch.ts`; `tests/sim/T46-vehicle-classes.test.ts`
(its cars-only pinned values may move: re-pin them with the reason, and keep the test proving
that the classes change nothing for an all-car fleet against the same tree),
`tests/sim/T29-mandatory-changes.test.ts`, `route-lane-options.test.ts`, `route-following.test.ts`,
`lane-drop-fallback-route.test.ts`, routing tests under `tests/routing/`, and other pinned
simulation expectations that move, each named; `docs/architecture.md` sections 7, 9 and 10; a
new `tests/sim/T51-lane-targets.test.ts`.

## Out of scope

The network and its compile output, the importer, demand and class shares, parking
(TASK-102 to TASK-104; TASK-102 also edits `src/sim/engine.ts`, and the lead reconciles the two
at merge), the IDM and conflict-zone rules, rendering. Do not tune gate thresholds, the
baseline, simulation parameters or shares to make the numbers look better.

## Gates

1. **Sets everywhere.** In T51: on a multi-lane approach with a stopped queue in one lane and a
   turn reachable from two lanes, a car with no access restriction changes lanes early and
   passes the queue (the TASK-101 regression without any reserved lane); routes keep their
   roads, movements and cost; the destination lane stays a singleton; deterministic.
2. **TASK-076 kept.** T29 passes; no route plans an avoidable change (assert on the ramp fixture
   that a car already in a feasible lane makes no mandatory change).
3. **Traffic.** `npm run traffic:quick` against main (3 012 / 38 / 0 after TASK-101): completed
   at least main's, gridlock reported per road. The goal is less gridlock; report honestly if it
   does not improve and why. The lead runs the full gate and resets the baseline at merge if
   counts move (owner rule 7 extended by the lead to this task).
4. **Speed.** Mean time per route request on Munich within 20% of main's.
5. `npm run check`, `npm run test:city`, `npm run traffic:quick` and `npm run test:e2e:smoke`
   green. Run e2e with `CITYFLOWS_TEST_PORT=5316`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier) and `npm run traffic:quick`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick` and
  `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`; the lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates. Open the app (`npm run dev -- --port 5316`), import Munich, play the morning to
about 08:30 and look at the Donnersberger approaches and the roads the quick tier lists as
gridlocked; describe what you saw against main.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what routing returns
now, how TASK-076's preference is kept, traffic before and after with the gridlocked roads,
routing time, files changed outside the pre-approved list and why, expectations changed with
their reasons, and the final lines of `npm run check`. Write any Markdown or docs as UTF-8.

Commit on `task/116-lane-targets`; do not push or merge. The lead reviews only commits.
