# TASK-112 — Trips made by people

Owner: unassigned
Gate: 9 (occupancy-driven trips), item 3 of the Gate 9 roadmap in `docs/plan.md`; owner bug 4
(Phase 3b: "no pedestrians are seen")
Branch: `task/112-person-trips` (created by the lead from main)
Depends on: TASK-103 (visible parking), TASK-110 (walk network and walk routing), TASK-111
(walkers and their rules with vehicles), TASK-118 (parking motion).
Runs alongside: TASK-120 (dead-end turnarounds) and TASK-121 (queue-head detour, B56). They
share only hooks in `src/sim/engine.ts`, which the lead reconciles at merge.
Design: this file; `docs/architecture.md`:
- section 8 (simulation, the TASK-111 walker notes);
- section 9 (demand, the TASK-102, TASK-103 and TASK-118 parking choice and the lead's starting
  stock follow-up);
- sections 5.6 (walk graph), 7 (routing, walk routing), 10 (engine host) and 11 (UI).

Read those, and the Gate 9 roadmap in `docs/plan.md`, before the code.

## Goal

Today a car trip spawns its car at the origin's connector or parked space. When it parks, the
trip ends; the walk to the destination is a number (`walkingDistanceM`) with no walker. The only
walkers come from TASK-111's test sources (`Scenario.walkers`). Persons without a car get `walk`
trips, which fail as `unsupported_mode`.

Gate 9's exit criterion: a person leaves a building, walks to their car parked on the street,
drives, parks in a lot near the destination and walks into the building. This task makes every
local private trip a person's trip in three legs, plus whole trips on foot:

1. **Access walk:** from the origin building to where the person's car is parked.
2. **Drive:** as today.
3. **Egress walk:** from where the car parked to the destination building.

Persons without a car walk the whole trip.

## Design

### Lead defaults (owner may override)

1. **Who has legs.** Local trips with a person and purpose `private` get walk legs, which
   includes event visitors at their place end. A gateway end never has a walk: the trip starts
   or ends in the car, as today. Through trips, delivery and service vans, trucks and buses stay
   vehicles without persons.
2. **Walk-mode trips.** A walk trip between two non-gateway places becomes a walker for the whole
   trip. If no walk route exists, it fails with the new reason `no_walk_route`. Walk trips with a
   gateway end, and `bus` and `rail`, stay `unsupported_mode`. The default scenarios use
   `carShare: 1`, so the traffic gates see access and egress walks only.
3. **One car per person.** Each person who has a car owns one, as today's stock does: the
   starting stock already holds one car per generated person with a car. Households sharing a
   car, and choosing a mode, are TASK-113's or later.
4. **Parking choice is unchanged.** It keeps straight-line walking distance (TASK-102/103/118).
   Walk-graph times are recorded, not used for the choice; TASK-113 will use them.
5. **No schema change.** `TripRequest` keeps its single planned leg, because the parking space is
   chosen in the simulation. The simulation derives the walk legs and records them per trip.

### Behaviour

1. **Person legs (new `src/sim/persons.ts`).**
   - At `departS` a person trip starts its access walk: from the origin place's walk anchor (its
     entrance, else its anchor nodes, `WalkGraph.places`) to where its car is.
   - **Where the car is:**
     - a strip slot or lot stall: the point on the walk graph nearest the car's space, on a walk
       link within 30 m, else the facility's anchor nodes (`WalkGraph.parking`);
     - a garage, including a place's own inferred garage: the garage connector's anchor
       (`WalkGraph.connectors`).
   - The car becomes ready to spawn (today's queued-origin path, unchanged) when the walker
     arrives.
   - On parking, an egress walker starts at the same kind of point for the space the car took
     and walks to the destination place.
   - The person trip completes when the walker arrives. A person's next trip starts no earlier
     than their arrival at the place it leaves from; today the next car trip waits only for the
     previous drive.
2. **Walkers on demand.** Today `src/sim/walkers.ts` builds every walker up front from the test
   sources. Give it a spawn API, roughly `spawn(from, to, timeS, owner)` with an arrival
   callback, keeping TASK-111's rules unchanged:
   - zebra and signal waiting;
   - lane holding by `crossingClearM`;
   - no collisions between walkers.

   Test sources keep working and keep their walker ids and T53 figures (state the ids scheme).
3. **No walk route.** If an access or egress walk has no route (a gap in the walk graph), the
   person moves at walk speed in a straight line without a walker and the trip goes on: the
   drive still happens. Count these as `walkFallbacks`, with the place or facility, and report
   them. A trip that fails while driving ends its person trip there; there is no egress walker.
4. **Routing cost.** Expect up to two walk routes per car trip. Cache routes per (place, anchor)
   pair or similar, so full-demand Munich does not route thousands of identical walks. Report the
   walk routing time.
5. **Metrics and accounting.** Vehicle trip accounting stays as it is: `completed` still means
   the drive leg ended, so the traffic gate keeps its meaning. Add person metrics:
   - person trips started and completed door to door;
   - mean access and egress walk time and distance;
   - walk fallbacks;
   - walk trips completed and failed.

   Include the walker metrics already in place (vehicle stops and delay at crossings). The
   demand panel shows the new counts.
6. **Snapshot and render.** Person walkers travel in the existing walker snapshot with a flag for
   access, egress or a whole walk, and the 2D and 3D walker layers draw them. Colour by leg is
   optional. Vehicles carry their occupant: the vehicle detail names the person, or none for
   vehicles without persons.
7. **Inspector (person view).** Clicking a person walker, or the occupant line in the vehicle
   inspector, opens a person view: id, home and work, the agenda with times, the current leg and
   its state, where the car is parked now, and the person's trips so far with each leg's times.
   This goes through a new host request next to `inspectWalker` (`src/host/protocol.ts`).
8. **Live edits.** A live edit that changes the walk graph re-routes active walkers as TASK-111
   does on patch.
9. **Measure.** Report:
   - Munich and Sindelfingen at 0.15, 07:00 to 10:00: person trips, peak walkers at once, mean
     access and egress walk, walk fallbacks by reason, walker crossings and vehicle delay at
     crossings;
   - traffic against main;
   - a second run with walkers present but not holding lanes (a scratch patch, not committed),
     which splits the drop in completed trips into later car starts and yielding to walkers.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested, as long as it is not named
under "Out of scope"; list each such file and why in your report. Stop and ask the lead only
for a file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature. Trip counts may change; that is not a behaviour change
to ask about.

Pre-approved, no need to ask:
- `src/demand/**` (walk-mode trips, legs bookkeeping);
- `src/sim/persons.ts` (new), `walkers.ts`, `parking.ts`, `connectors.ts`, `metrics.ts`,
  `types.ts`, `vehicle.ts`, `hash.ts`, `patch.ts`;
- `src/sim/engine.ts` (hooks only: spawn readiness, parking and arrival callbacks, the walker
  step);
- `src/routing/walk.ts` (caching and positions only; same routes);
- `src/host/**` (snapshot, person inspect request, export of person metrics);
- `src/ui/**` (person view, occupant line, demand panel counts) and the walker layers in
  `src/render/**` and `src/render3d/**`;
- `docs/architecture.md`, the contract change, in these sections:
  - section 8: person legs and walkers on demand;
  - section 9: walk legs derived in the sim, walk-mode trips simulated;
  - section 10: snapshot and inspect request;
  - section 11: person view;
  - section 16: remove "walking legs" from the deferred list.
- `bench/import-probe.ts` (person and walker counts);
- tests:
  - `tests/sim/T15-unsupported-mode.test.ts` (walk trips are now simulated: keep `bus` and `rail`
    and gateway walk trips unsupported);
  - a new `tests/sim/T57-person-trips.test.ts`;
  - a new `tests/e2e/T57-person-trips.spec.ts`;
  - the hash pins and counts that move, each named with its reason.

## Out of scope

- Mode choice and per-person preferences (TASK-113).
- Households sharing a car.
- Transit, bicycles, walker collisions, parking fees.
- Changing the parking choice rules or the starting stock (TASK-102/103/118 and the lead's
  follow-up).
- `src/network/**`: the walk graph is TASK-110's, and the dead-end turnarounds are TASK-120's.
- `src/sim/intersection.ts`, `reroute.ts`, `lane-change.ts`: TASK-121 changes them in parallel.
- Importers.

## Gates

1. **Legs.** In T57, on a synthetic fixture with a walk graph:
   - a person with a car parked on a strip walks from home to the slot, the car leaves only
     after the walker arrives, drives, parks in a lot stall, and a walker walks from the stall
     to the destination;
   - the person trip completes on arrival;
   - the next trip starts no earlier than that arrival;
   - a garage car: the walk goes to the garage connector;
   - gateway ends have no walk;
   - a van trip and a through trip have no persons;
   - a walk-mode trip completes on foot, and a walk trip with no route fails `no_walk_route`;
   - a walk gap gives a `walkFallback` and the trip still completes;
   - same seed, same state hash.
2. **Rules unchanged.** TASK-111's walker rules hold for person walkers: T53 (sim) passes as it
   is, with the test-source figures unchanged. The conflict-zone and crossing safety checks
   (`tests/sim/crossing-safety.ts`) hold with person walkers on Munich.
3. **Traffic.** `npm run traffic:quick` against main:
   - every failure is a gridlock or a counted parking failure, with parking failures under 2% of
     local arrivals;
   - gridlocked at most 1.5× main;
   - stalled heads at most main's;
   - completed at least 85% of main's, with the drop explained by the two-run split above.

   Owner rule 7 applies (this task changes demand), so the lead runs the full gate, the full
   demand test and T53, and resets the baseline at merge.
4. **Walk quality.** Munich and Sindelfingen at 0.15: walk fallbacks under 2% of walk legs, each
   listed with its place or facility. Dropped walkers under 1% of spawned.
5. **Render.**
   - 2D and 3D shots `V112-munich-street` (a residential street with strips at 07:30, persons
     walking to their cars) and `V112-munich-lot` (`pk:2037` or another busy lot at 08:30,
     persons leaving the lot), and the same on main;
   - the person view in the e2e spec;
   - read them yourself.
6. **Performance.**
   - Munich at 0.15: step time within 15% of main, run to 10:00 within 15%;
   - report walk routing time, peak walkers, and full-demand Munich if you can run it (the lead
     runs it at merge);
   - compile time unchanged.
7. **Checks.** `npm run check`, `npm run test:city`, `npm run traffic:quick` and
   `npm run test:e2e:smoke` are green. Heavy e2e cases need `test.setTimeout(420_000)`. Run e2e
   with `CITYFLOWS_TEST_PORT=5312`; never use port 4173 or 5173. Before committing, also run
   `demo-a-commute`, `T16-performance`, `T53-pedestrians` and `qa-exports` (they caught sim
   regressions before).

## Checks to run

- While iterating: `npm test` (unit tier), `npm run traffic:quick`,
  `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick`,
  `npm run test:e2e:smoke` and the four e2e specs named in gate 7.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`. The lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Then open the app (`npm run dev -- --port 5312`), import
Munich, set the scale to 0.15, turn "Parked cars" and the walk layers on, and play from 07:00.

Follow one person: they leave a building, walk to a car on a strip, drive, park in a lot, and
walk into their destination. Open their person view. Describe what you saw in 2D and 3D.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the leg rules as built and the walker spawn API;
- the per-city counts listed under Measure;
- traffic before and after (0.15 quick, the two-run split, and full demand if measured);
- image paths;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main. Write any Markdown or docs as UTF-8.

Commit on `task/112-person-trips`; do not push or merge. The lead reviews only commits.
