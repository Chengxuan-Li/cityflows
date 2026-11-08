# TASK-111 — Pedestrian rules in the simulation: zebra priority and pedestrian signal phases

Owner: unassigned
Gate: 9 (occupancy-driven trips, owner 2026-11-07), feature 9.2; Phase 3 of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/111-pedestrian-rules` (created by the lead from main)
Depends on: TASK-110 (walk graph, crossing links tagged with road, end and control; walk
routing), TASK-064 and TASK-065 (conflict zones and grants), TASK-094 (stop lines behind
set-back crossings). Design: this file; `docs/architecture.md` sections 4 (City,
`SignalProgram`), 5.4 (signals), 7 (walk routing), 8 (simulation step and resolution) and 11
(rendering). Read those before the code.

## Goal

Crossings are paint and walk links; no pedestrian ever stands on one, and the owner asked for
crossings "controlled properly by traffic". Add walkers to the simulation and the rules
between them and vehicles: drivers give way at zebras, walkers cross at signals on their own
green, and turning drivers yield to walkers crossing the road they turn into. Real walkers
arrive with person trips in TASK-112; this task proves the rules with a test pedestrian source
and changes nothing when no walker exists.

## Design

1. **Walkers** (new `src/sim/walkers.ts`). Struct-of-arrays like `vehicles.ts`: walk route
   (TASK-110's `src/routing/walk.ts`), link and position, speed (`walkSpeedMps`, default
   1.4 m/s; steps 0.6 times), state (walking, waiting at a crossing, crossing, done). Walkers
   do not collide with each other (owner decision 6 of 2026-11-07). They advance in the same
   fixed step as vehicles, deterministically.
2. **Crossing spans** (compile, derived). For each crossing walk link, the lanes it crosses and
   where: for every lane of its road, and of the paired road of a two-way street, the position
   along the lane where the crossing line meets it and the half-width of the stripes, plus the
   node and arm for junction crossings. Stored next to the walk graph; the vehicle network
   does not change.
3. **Zebra rule.** A walker waiting at the kerb of a zebra steps out once every approaching
   vehicle on the crossed lanes either can stop comfortably before the stripes (its braking
   distance at `bMps2` plus `minGapM` fits) or has passed them. Vehicles that can stop must
   stop for a walker waiting at or on the crossing: the stripes' near edge is a standing
   obstacle for their IDM, the same mechanism as the ungranted stop line and the zone
   backstop. A held vehicle may go once every walker is past its lane's span by
   `crossingClearM` (default 1 m) and none is waiting to step onto it.
4. **Signals.** `SignalProgram.phases[].walk?: { roadId: RoadId; end: 'start' | 'end' }[]`
   (contract change, pre-approved, no `schemaVersion` bump) lists the crossings with walk
   green in each phase. Absent means derived (lead default, concurrent operation as in
   Germany): a crossing over an arm has walk green in every phase where no movement *from*
   that arm is green; movements turning *into* the arm may be green at the same time and their
   drivers yield to walkers on or entering the crossing as at a zebra. A phase with walk
   groups and no vehicle groups is an exclusive pedestrian phase (allowed, never derived). A
   walker starts crossing only on walk green and only when the remaining walk green covers the
   crossing at walking speed plus `walkClearanceS` (default 2 s); a walker already on the
   crossing finishes. Amber and all-red stay vehicle rules. Compile the walk groups into
   `CSignal` like the movement groups; patches keep phase epochs (`src/sim/signals.ts`).
5. **Test pedestrian source.** `Scenario.walkers?: { fromPlaceId: PlaceId; toPlaceId: PlaceId;
   perHour: number }[]` (contract change, pre-approved; default none) spawns walkers at seeded
   times from `Scenario.seed`, each routed on the walk graph between the places. The demand
   sheet gets a small "Test pedestrians" list (add, remove, rate) with undo; `window.cityflows`
   can set it for tests. A walker with no walk route is counted and dropped.
6. **Host, snapshot and drawing.** Walker positions and headings travel in the snapshot like
   vehicles. A "Pedestrians" layer (default on) draws walkers as dots in 2D and small upright
   figures or capsules in 3D, instanced; pedestrian signal states draw as small red and green
   marks at both kerbs of signalised crossings in 2D and 3D. Selecting a walker shows its
   route, state and waiting time.
7. **Metrics.** Walkers spawned, completed, dropped; mean walk time and mean wait per
   crossing kind; vehicle stops caused by walkers (zebra and turning yields), and the
   vehicle delay they cost.
8. **Signal editor.** The signal inspector lists each phase's walk groups (derived or explicit),
   lets the user toggle a crossing in a phase and add an exclusive pedestrian phase, with undo.
9. **Measure.** Crossings per city by control; with no walkers, Munich morning counts and
   state hash against main; with the test source at 2 000 walkers per hour over ten Munich
   crossing pairs: walker waits, vehicle stops and delay, and step time against no walkers.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
host and worker wiring, store, panels, dev pages, fixture builders, shared types, test
helpers), as long as it is not named under "Out of scope"; list each such file and why in
your report. Stop and ask the lead only for a file named under "Out of scope", a contract
change this task does not describe, or a behaviour change to another feature.

Pre-approved, no need to ask: `src/schema/city.ts`, `city.schema.ts` (the `walk` phase
groups), `src/schema/demand.ts`, `demand.schema.ts` (`Scenario.walkers`), `src/schema/sim.ts`
and `src/sim/params.ts` (walk speed, clearances); `src/network/walk.ts` (crossing spans),
`src/network/signals.ts`, `compile.ts`, `types.ts`; `src/routing/walk.ts` (only to reuse it);
`src/sim/walkers.ts` (new), `intersection.ts`, `signals.ts`, `engine.ts`, `idm.ts`, `metrics.ts`,
`types.ts`, `hash.ts`, `patch.ts`; `src/host/**` and the snapshot; walker and pedestrian-signal
layers under `src/render/layers/` and `src/render3d/`, `src/render/scene.ts`,
`src/render3d/scene.ts`, `style.ts`, `types.ts`; `src/editor/commands/**`,
`src/ui/inspector/signal.tsx` and a walker inspector, `src/ui/panels/**` (demand sheet and
metrics), `src/ui/layers.tsx`, `src/ui/store.ts`, `src/ui/map-view.tsx`;
`bench/geometry-shots.ts` (new cameras); `docs/architecture.md` sections 4, 5.4, 7, 8 and 11;
tests (a new `tests/sim/T53-pedestrians.test.ts`, a signal compile case, an e2e case tagged
`@smoke`), and the expectations that move, each named with its reason.

## Out of scope

Parking, strips, lots and their manoeuvres (TASK-103, in parallel: it also edits
`src/sim/engine.ts`, the snapshot and the renderers, and the lead reconciles the two at merge),
person trips and walking legs (TASK-112), mode choice (TASK-113), demand generation, vehicle
routing (`src/routing/index.ts`, `lane-search.ts`), the vehicle network and junction geometry,
crossing markings and their placement (TASK-091, TASK-094, TASK-108), walker collisions,
cyclists.

## Gates

1. **Nothing changes without walkers.** With no `Scenario.walkers`, the grid, town and Munich
   runs equal main's state hashes and metrics exactly (walker state stays out of the hash while
   none exists), and `npm run traffic:quick` equals main (3 356 / 20 / 0 after TASK-116). The
   compiled vehicle network equals main's.
2. **Zebra.** In T53: a car that can stop stops for a waiting walker and goes after the walker
   clears its lane; a car too close to stop passes and the walker waits; a walker on the
   crossing holds every crossed lane, both directions of a two-way street; deterministic.
3. **Signals.** A walker crosses only on walk green and never starts with too little walk green
   left; the derived groups give an arm walk green exactly when no movement from it is green;
   a turning car on green yields to a walker on the crossing it turns across; an exclusive
   pedestrian phase stops every vehicle movement; patches keep phase epochs.
4. **Safety invariant.** Over the test-source runs on the four-way signal fixture and on
   Munich, no vehicle's body ever overlaps a crossing span while a walker is inside that span
   on the same lane (sampled every step, like T21), and `zoneStops` does not rise beyond noise.
5. **Load.** Munich with the test source at 2 000 walkers per hour: report the step time
   against no walkers and keep it within 25%; report vehicle stops and delay caused by walkers.
6. **Render.** 2D and 3D shots (new cameras `V111-munich-zebra` and `V111-munich-signal` with
   the test source running, and their 3D versions); read them yourself: walkers on sidewalks
   and crossings, cars stopped before the stripes, signal marks readable at street zoom.
7. `npm run check`, `npm run test:city`, `npm run traffic:quick` and `npm run test:e2e:smoke`
   green. Heavy e2e cases need `test.setTimeout(420_000)` for CI's software GPU. Run e2e with
   `CITYFLOWS_TEST_PORT=5311`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run traffic:quick`,
  `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick` and
  `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`; the lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5311`), import
Munich, add test pedestrians across a zebra and across the Donnersberger signal, play to 08:00,
watch cars stop for walkers and walkers wait for their green, edit a phase's walk groups in
the signal inspector; describe what you saw in 2D and 3D.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the walker model and
both rules as implemented, crossings per city, the no-walker equality evidence, the test-source
measurements (waits, vehicle stops and delay, step time), image paths, files changed outside
the pre-approved list and why, expectations changed with their reasons, and the final lines of
`npm run check`. Report every timing that grew against main (compile, step, frame), even when
no gate covers it. Write any Markdown or docs as UTF-8.

Commit on `task/111-pedestrian-rules`; do not push or merge. The lead reviews only commits.
