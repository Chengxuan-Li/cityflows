# TASK-121 — Queue heads that cannot enter re-route (B56)

Owner: unassigned
Gate: 7 (road betterment), the owner's deferred B56 (owner, 2026-11-07; started 2026-11-09)
Branch: `task/121-queue-head-detour` (created by the lead from main)
Depends on: TASK-048 (fallback movements), TASK-076 (lane-change give-up), TASK-077 (gridlock
respawn), TASK-116 (feasible lane targets).
Runs alongside: TASK-120 (dead-end turnarounds) and TASK-112 (trips made by people). They share
only hooks in `src/sim/engine.ts`, which the lead reconciles at merge.
Design: this file; `docs/architecture.md` section 8 (simulation: intersections, lane changes,
re-routing, gridlock recovery) and section 7 (routing). Read B56 in `docs/plan.md` ("Owner
findings", the B54 to B56 rows) and the TASK-099 and TASK-077 review entries before the code.

## Goal

Munich at 0.15 has a deadlock loop: Arnulfstraße eastbound, `n:138`, the Landsberger ramps,
`n:967`'s ramp `r:703`, the Donnersberger ramps through `n:638`, then back to `r:884`. It locks
at `n:263`. There the head of `r:703#1` waits for room to enter a standing queue in lane 0
instead of re-routing. The cars in the loop each wait for the car ahead, and only TASK-077's
respawn (180 s standing, three times, then `gridlocked`) clears them.

The traffic gate still allows one stalled head for this loop. Worse, the loop makes every gate
fragile: a 1 cm shift of an unrelated road moves completed trips by up to +211 and can stall a
head on this corridor. The mixed fleet happens to avoid the lock, but a cars-only run does not.

The owner's rule: let a vehicle stuck at a queue head re-route or give way, then tighten the gate
back to 0 stalled heads.

Why the head never re-routes today:
- the periodic re-route check (`src/sim/reroute.ts`) skips a car within
  `intersection.decisionDistanceM` (15 m) of its lane's end, which is exactly where a queue head
  stands;
- `maxReplans` (3) may already be spent;
- the TASK-048 fallback is taken only when the car cannot reach its target lanes, not when its
  planned movement's exit is full.

## Design

1. **Trace first.** Before changing the rule, trace the `n:263` lock in a cars-only run and in
   the default mixed fleet:
   - which heads stand still, their planned movements and the refusal reasons
     (`exit-full`, `box`, `gap`, `signal`) over time;
   - whether another permitted movement from the head's lane had room and a route to the
     destination;
   - the cycle of lanes that closes the loop.

   Put the trace in your report. If it shows a cause this design does not cover, stop and report
   to the lead before building something else.
2. **Head detour (the rule).** A head is a car first on its lane, at or within
   `decisionDistanceM` of the stop line. If it stands still for `headDetourS` (new
   `SimParams.headDetourS`, default 45 s) while its planned movement is refused for `exit-full`
   or `box`, it looks for a detour:
   - **Candidates:** the other movements from its lane that are open to its class and road
     access, not `neverGreen`, not tried before in this trip (`attemptedFallbacks`), and whose
     exit has room now;
   - **Route check:** a route to its destination must exist from the candidate's exit lane;
   - **Choice:** among those, the lowest remaining route cost;
   - **Taking it:** marked like a TASK-048 fallback (`missed_turn` route reason, re-route on the
     next lane). It does not count against `maxReplans`.

   Red signal time does not count toward `headDetourS`. A car that is on its target lanes but
   behind a head does not detour.
3. **Give way (only if the trace needs it).** If the trace shows heads holding the box or a
   conflict zone while their own exit is full, so that cross traffic that could clear the loop
   is blocked, let a head whose detour finds nothing yield the grant to a conflicting movement
   that can enter. Keep TASK-077's respawn as the last resort; do not change `gridlock` params.
4. **Determinism and live edits.** Same seed, same result. A live edit (`src/sim/patch.ts`)
   resets a head's detour timer. Snapshot and state hash include the new timer only where they
   already hold per-vehicle timers.
5. **Measure.** Per run:
   - heads that detoured, how many of them still failed, and the roads they detoured from;
   - Munich at 0.15 in the default fleet and cars-only (patch `DEFAULT_CLASS_SHARES` in a scratch
     script; do not commit it) at 09:30 (`traffic:quick`) and at 10:00;
   - gridlocked roads before and after (`gridlockedRoads` in `bench/import-probe.ts`);
   - **Stability probe:** three seeded 1 cm shifts of unrelated roads, against main. Keep it in
     `bench/`, not in the tests, and report the spread of completed trips.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested, as long as it is not named
under "Out of scope"; list each such file and why in your report. Stop and ask the lead only
for a file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature. Trip counts may change; that is not a behaviour change
to ask about.

Pre-approved, no need to ask:
- `src/sim/engine.ts` (`planLane`, the fallback, gridlock recovery), `intersection.ts`,
  `reroute.ts`, `lane-change.ts`, `vehicle.ts` (a per-vehicle timer), `patch.ts`, `params.ts`;
- `src/schema/sim.ts` and its schema with migration default (the contract change:
  `SimParams.headDetourS`);
- `docs/architecture.md` section 8 (the head detour rule);
- `bench/import-probe.ts` (detour counts) and a new `bench/` stability probe;
- `bench/traffic-baseline.json` and `tests/traffic/munich-morning.test.ts`, for the gate change
  described under Gates;
- tests: a new `tests/sim/T58-head-detour.test.ts`, plus the hash pins and counts that move,
  each named with its reason.

## Out of scope

- `src/sim/parking.ts`, `connectors.ts`, `walkers.ts` and `src/demand/**`: TASK-112 rewrites
  them in parallel.
- `src/network/**`: movements, junction geometry and the dead-end turnaround are TASK-120's,
  and B54 and B55 are later geometry tasks.
- Routing cost functions in `src/routing/**`.
- The `gridlock` respawn parameters.
- Signal timing.

## Gates

1. **Rule.** In T58, on synthetic fixtures:
   - a head whose exit is full and that has a permitted alternative with room detours after
     `headDetourS` and completes;
   - a head with no alternative waits, then respawns as before;
   - a head at red does not count red time;
   - a car not first on its lane never detours;
   - a two-lane loop fixture that deadlocks on main clears;
   - the same seed gives the same state hash.
2. **Loop.** Munich at 0.15, cars-only and default fleet: no stalled head at `n:263` or on the
   B56 corridor at 10:00, and 0 stalled heads overall. Set `stalledHeads` to 0 in
   `bench/traffic-baseline.json` and remove the B56 allowance from the munich-morning comment.
   If T29 (`test.fails`) starts passing, make it a `test` and say so.
3. **Traffic.** `npm run traffic:quick` against main:
   - completed at least 100% of main's (the rule must not cost trips);
   - gridlocked at most main's, and report both;
   - every failure a gridlock or a counted parking failure;
   - parking failures under 2% of local arrivals.

   The lead runs the full gate and full demand, and resets the baseline at merge.
4. **Stability.** Report the probe's spread of completed trips before and after. The aim is at
   least to halve main's spread. If it does not shrink, say why.
5. **Safety.** T21 (no contacting-zone overlap) and the conflict-zone samples hold. A detouring
   car never enters an occupied zone or a full exit.
6. **Performance.** Step time within 5% of main on Munich at 0.15. Route requests: report main
   against branch.
7. **Checks.** `npm run check`, `npm run test:city`, `npm run traffic:quick` and
   `npm run test:e2e:smoke` are green. Run e2e with `CITYFLOWS_TEST_PORT=5321`; never use port
   4173 or 5173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run traffic:quick`, the cars-only scratch run.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick` and
  `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`. The lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5321`), import Munich, set the scale to
0.15, play from 07:00 to 09:30 at `n:263` and the Donnersberger ramps, and watch a queue head
take a detour. Describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the trace of the lock;
- the rule as built and its parameter;
- detour counts;
- traffic before and after (default and cars-only, 09:30 and 10:00), gridlocked roads and the
  stability spread;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main. Write any Markdown or docs as UTF-8.

Commit on `task/121-queue-head-detour`; do not push or merge. The lead reviews only commits.
