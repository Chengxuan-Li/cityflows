# TASK-118 — Parking motion: circulation inside lots, visible park and leave manoeuvres

Owner: unassigned
Gate: 7 (road betterment), feature 7.1 follow-up; owner bug report of 2026-11-08 (items 1 and 2),
Phase 3b of "Roadmap: Gates 7 to 9" in `docs/plan.md`
Branch: `task/118-parking-motion` (created by the lead from main)
Depends on: TASK-103 (strips, lot stalls in the simulation, manoeuvre holds), TASK-104 (lots,
stalls, aisles), the lead's TASK-103 follow-up (stock per person, lots serving their
neighbours). Design: this file; `docs/architecture.md` sections 4, 5, 8, 9 (the TASK-103 notes
and the lead follow-up) and 11. Read those before the code.

## Goal

The owner tested TASK-103 and found that parking still teleports:

1. A car that reaches a surface lot's entry is put into the nearest free stall at once. Cars
   never drive inside a lot, and most lots (Munich 18 of 22) have no aisle in the vehicle
   network at all. Cars should drive to a stall along the lot's aisles, and choose among the
   good free stalls stochastically, not always the single best one.
2. A strip car brakes in the curb lane, waits, and vanishes into its slot; a leaving car
   appears in the lane. Both should move visibly between lane and slot. And a strip empties
   from one end, because slots are handed to cars and trips in compiled order; cars should
   come and go individually.

The owner's routing guidance (2026-11-08): keep parking search out of the road network. The
vehicle router finds the lot entry; inside the lot a small local problem moves the car to an
appropriate stall.

## Design

1. **Lot circulation (compile, derived).** For every lot with stalls, a small circulation
   graph inside its polygon, stored with the lot (`CLot`), never in the vehicle network:
   - aisle paths: for mapped aisles, the aisle centrelines; for generated layouts, the
     centreline of each driving gap between stall rows, joined where rows end, clipped to the
     polygon;
   - one access point per stall on its aisle, with the stall's entry pose;
   - links from each lot entry (its connector position on the street lane, or the end of a
     mapped aisle lane) to the nearest aisle point;
   - shortest paths entry → stall precomputed lazily or per arrival (the graph is tiny).
   A lot whose stalls cannot all be reached from an entry reports them (diagnostic) and they
   stay unused. Lanes, nodes, movements and junction geometry do not change.
2. **Stall choice.** On arrival at the lot entry a car picks a free, unreserved stall
   stochastically (seeded per vehicle from `Scenario.seed`): score each free stall by path
   length from the entry plus straight-line walking distance to the destination place; take
   the stalls within `stallChoiceSlackM` (default 25 m) of the best score, and pick one of
   them uniformly. Reserve it at once. Record the choice in the vehicle inspector.
3. **Driving inside a lot (simulation).** The car leaves the street lane at the connector (the
   existing entry rule: the connector admits it, the lane is released) and drives the path at
   `lotSpeedMps` (default 2.5 m/s) with simple following: on a shared path segment it keeps
   `minGapM` behind the car ahead and never overtakes; at a merge of two segments the car
   already on the merge point goes first. At the stall's access point it pulls in along a
   short curve over `parkManoeuvreS.perpendicular` (or the stall layout's value) and becomes
   a parked car. Leaving reverses out along the curve (`leaveManoeuvreS`), drives the path to
   an exit entry, waits there for an accepted gap (the existing spawn and merge rules) and
   joins the lane at speed 0. A car inside a lot is in a new vehicle state (`in_lot`) and in
   no lane; gridlock rules do not apply inside the lot.
4. **Strip manoeuvres.** Parking at a slot: the car brakes to a stop at the slot position in
   the curb lane as now, then follows a pull-in path from its lane pose to the slot pose
   (parallel: a reverse S-curve; angled and perpendicular: a forward arc) over the layout's
   `parkManoeuvreS`; the lane is held until the car's body has left it. Leaving: the car
   follows the path out from the slot pose to the lane over `leaveManoeuvreS`, holding the
   lane (the existing gap check before it starts), and joins the lane at speed 0. Poses are
   continuous: no jump larger than the car's speed over one step plus 0.05 m.
5. **Individual slots.** Initial stock and the trip-to-slot assignment pick slots seeded at
   random among the eligible free slots of a facility, not in compiled order, so a strip's
   cars leave one by one along its length. Stall choice (item 2) already does this for lots.
6. **Host, snapshot and drawing.** Cars driving in a lot or manoeuvring travel in the snapshot
   as moving vehicles with pose and heading (no new layer); a parked car leaves the parked
   set when it starts its manoeuvre out and joins it when its manoeuvre in ends. Frames follow
   TASK-115's rule.
7. **Metrics.** Mean time from lot entry to parked, mean in-lot drive and leave times, strip
   manoeuvres per hour, and stall-choice spread (mean rank of the chosen stall).
8. **Measure.** Munich and Sindelfingen: lots with circulation, unreachable stalls, entry →
   parked times; Munich morning completed, gridlocked, parking failures and search time
   against main; step time against main.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested (callers, constructors,
host and worker wiring, store, panels, dev pages, fixture builders, shared types, test
helpers), as long as it is not named under "Out of scope"; list each such file and why in
your report. Stop and ask the lead only for a file named under "Out of scope", a contract
change this task does not describe, or a behaviour change to another feature. Trip counts
may change; that is not a behaviour change to ask about.

Pre-approved, no need to ask: `src/network/stalls.ts`, a new `src/network/lot-paths.ts`,
`src/network/types.ts` (`CLot` circulation), `compile.ts` (wiring); `src/schema/sim.ts`,
`src/schema/demand.schema.ts` and `src/sim/params.ts` (`lotSpeedMps`, `stallChoiceSlackM`);
`src/sim/parking.ts`, `connectors.ts`, `engine.ts`, `vehicle.ts` (the `in_lot` state),
`types.ts`, `metrics.ts`, `hash.ts`, a new `src/sim/manoeuvre.ts`; `src/host/**` and the
snapshot; `src/render/layers/` and `src/render3d/` (moving cars off lanes, parked set
handover), `src/render/scene.ts`, `src/render3d/scene.ts`; `src/ui/inspector/**` (stall choice,
in-lot state), `src/ui/panels/metrics.tsx`; `bench/geometry-shots.ts` (new cameras);
`docs/architecture.md` sections 5, 8, 9 and 11; tests (a new `tests/sim/T54-parking-motion.test.ts`,
a network case for circulation, an e2e case tagged `@smoke`), and the expectations that move,
each named with its reason.

## Out of scope

The vehicle routing graph (`src/routing/**`: no lot aisles or stalls in the road search),
vehicle lanes, nodes, movements and junction geometry; the importers, strips import and
mapped street-side parking areas (TASK-119, in parallel; it owns `src/importers/**` and
`src/network/strips.ts`); pedestrians and person trips (TASK-112), walkers (TASK-111), garage
admission and the lead's stock and serving rules (keep them), parking fees.

## Gates

1. **Network untouched.** The compiled vehicle network for grid, town, Munich and Sindelfingen
   equals main's (hash without `CLot` circulation, as T52 does).
2. **Lot motion.** In T54: a car arriving at a lot drives the circulation path to its stall
   (no position jump beyond speed × step + 0.05 m), parks after the pull-in, and later backs
   out, drives to an entry and joins the lane after a gap; two cars on one aisle never
   overlap (sampled every step); stall choice over 200 seeded arrivals picks more than one
   stall and only stalls within the slack; deterministic (two runs equal).
3. **Strip motion.** In T54: a parking car's pose moves continuously from lane to slot and the
   lane stays held until its body is clear; a leaving car moves continuously from slot to
   lane; departures from a ten-slot strip do not follow slot order (Spearman rank correlation
   between slot index and departure order below 0.5 over seeded runs).
4. **Traffic.** `npm run traffic:quick` against main (3 296 / 32 / 5 after the lead's follow-up).
   Trip counts may change; every failure is a gridlock or a counted parking failure, parking
   failures under 2% of local arrivals; explain any rise in gridlock (a lot exit queue or a
   strip manoeuvre on a busy lane is the expected cause; say where). The lead runs the full
   gate and resets the baseline at merge.
5. **Render.** 2D and 3D shots: `V118-munich-lot` (the TASK-104 lot camera at 08:00 with cars
   driving its aisles), `V118-munich-street` (a strip with a car mid-manoeuvre) and their 3D
   versions; read them yourself: cars on aisles, not on stalls or buildings; a manoeuvring car
   between lane and slot; nothing else moves. Frame time within noise of main.
6. **Performance.** Step time within 15% of main on the quick Munich morning; compile within
   10%. Profile and fix anything larger before reporting.
7. `npm run check`, `npm run test:city`, `npm run traffic:quick` and `npm run test:e2e:smoke`
   green, plus `demo-a-commute`, `T16-performance`, `qa-exports` and `T52-parking-cities`.
   Heavy e2e cases need `test.setTimeout(420_000)` for CI's software GPU. Run e2e with
   `CITYFLOWS_TEST_PORT=5318`; never use port 4173.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run traffic:quick`,
  `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick`,
  `npm run test:e2e:smoke` and the four e2e files named in gate 7.
- Do not run `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`; the lead
  runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates, and the shots read by you. Open the app (`npm run dev -- --port 5318`), import
Munich, play from 07:00 with "Parked cars" on, watch cars drive into the TASK-104 lot and pick
different stalls, watch a strip car pull in and another pull out, select a car inside a lot;
describe what you saw in 2D and 3D.

## Deliverable

A report in the body of your last commit message (no new Markdown files): the circulation
graph and stall choice as implemented, the manoeuvre paths, lots with circulation and
unreachable stalls per city, traffic before and after with the gridlocked roads, image
paths, files changed outside the pre-approved list and why, expectations changed with their
reasons, and the final lines of `npm run check`. Report every timing that grew against main
(compile, step, frame), even when no gate covers it. Write any Markdown or docs as UTF-8.

Commit on `task/118-parking-motion`; do not push or merge. The lead reviews only commits.
