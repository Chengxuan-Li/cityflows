# TASK-125 — Parking claims

Owner: unassigned
Gate: 9 (occupancy-driven trips): cars that find parking without circling
Branch: `task/125-parking-claims` (created by the lead from main)
Depends on: TASK-102 (garages, choice on arrival), TASK-103 (strips and lot en-route counts),
TASK-118 (parking motion), TASK-124 (every garage and place has a car exit).
Followed by: the lead re-measures TASK-122 (trip cars park only where they can leave, on hold on
`task/122-parking-egress`) on top of this task. TASK-129 (car ownership) comes later.
Design: this file; `docs/architecture.md` section 8 (simulation: parking). Read the owner backlog
row for TASK-125 in `docs/plan.md` ("Owner backlog (2026-11-10)") and the lead's TASK-122 round 2
review first.

## Goal

When a car chooses where to park, other cars should know. Today only lots do this: a lot counts
the cars heading for it (`heading` / `enRoute` in `src/sim/parking.ts`, lead TASK-103 follow-up),
and a lot whose free stalls are all spoken for drops out of the choice. Strips and garages do not.

- **Strips:** each strip space has its own connector. `choose` picks a connector whose space is
  free now (`hasFreeSpace`), but the space is reserved only when the car starts its manoeuvre
  (`startArrival`). Every car that chooses before then may pick the same space. All but one
  arrive to find it taken, are rejected (`reject`), choose again and drive on. In TASK-122 round 2
  one freed space drew 44 searches over an hour.
- **Garages:** they check only `hasRoom` (occupied below capacity) when chosen. A garage with one
  free space attracts every car that chooses it until the first one enters.
- **Leak:** a lot's en-route count is released when the car parks, is rejected or chooses again.
  The lead found no release when a car leaves the simulation another way (removed for gridlock,
  failed, or dropped by an edit). Confirm this and fix it with the rest.

A claim fixes all three. A car that chooses a space or a facility claims it. Other cars treat
claimed spaces as taken. A facility whose free spaces are all claimed drops out of the choice, so
overflow cars go straight to their next option instead of circling.

## Design

1. **One claim per car.** A car holds at most one claim, on what it last chose:
   - a strip space (the space behind the connector it chose);
   - a lot (as today, by count);
   - a garage, by count.

   Strip claims replace today's manoeuvre-time reservation as the first point of exclusion. The
   manoeuvre then confirms the claimed space.
2. **When a claim is made.** A claim is made only when `choose` finds room (its `needRoom`
   pass). The departure fallback that heads for a full facility as a forecast
   (`atDeparture`, `needRoom = false`) makes no claim. The entry check then admits or rejects that
   car as today.
3. **What a claim excludes.**
   - **Strips:** a claimed space is not free for any other car (`hasFreeSpace`, `freeSpace`,
     `full`).
   - **Garages and lots:** they drop out of the choice when occupied plus claims reaches capacity,
     not counting the asking car's own claim.
   - **Soft garages:** inferred garages that admit every car (`soft`) are never full and need no
     count. State whether you count them anyway.
4. **When a claim is released.**
   - The car parks (the claim becomes the parked space).
   - The car chooses again (the old claim goes before the new one is made).
   - The car is rejected at the entry.
   - The car fails (`no_parking`), is removed for gridlock, respawns, or its trip ends any other
     way.
   - A live edit remaps or drops its target (the existing remap of `heading` and `reserved`).

   Every path that ends a car's trip must release its claim. Add one release point that all of
   them call, and a check, in tests and behind a debug flag in the engine, that no claim outlives
   its car.
5. **Origins and parked cars do not change.** Departures, origin spaces and the parked-car stock
   behave as on main. A claim never moves a parked car.
6. **Determinism and snapshots.** Claims are part of the parking state hash and the snapshot, so
   the same seed gives the same run, and an edit mid-run keeps or releases them consistently.
7. **Measure.** Per city, at 0.15 scale to 10:00, and for Munich at full demand to 10:00 (one run,
   for the lead):
   - completed, gridlocked, `no_parking` and stalled heads;
   - rejections at the entry, and the number of cars that chose the same strip space at once
     (0 by construction);
   - total and mean parking search time;
   - the 20 strip spaces and the 10 facilities with the most rejections, before and after;
   - claim-held time: how long claimed strip spaces stay empty while claimed. This is the cost
     of claims: a space held for a car still far away. Report its distribution and the longest
     cases.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report. Stop and ask the lead only for a file
named under "Out of scope", a contract change this task does not describe, or a behaviour change
to another feature.

Pre-approved, no need to ask:
- `src/sim/parking.ts` (claims, release, hash, snapshot, metrics);
- `src/sim/engine.ts`, only to call the release point where a car leaves the simulation, and
  `src/sim/types.ts` for the metrics;
- `docs/architecture.md` section 8 (parking choice and claims);
- `bench/import-probe.ts` and `bench/traffic-baseline.json` (the baseline resets at this merge,
  owner rule 7; the lead re-records it);
- tests: a new `tests/sim/T63-parking-claims.test.ts`, plus `T48-parking`, `T52-parking-stock`,
  `T54-parking-motion`, the traffic tests' expected counts and hash pins that move, each named
  with its reason.

## Out of scope

- `src/importers/**`, `src/network/**` (including `parking-egress.ts`), `src/render/**`,
  `src/render3d/**`, `src/ui/**`: no import, network or drawing change.
- `src/demand/**` and `src/routing/**`: trips and routes stay as they are.
- TASK-122's rule (spaces a car cannot leave) and its branch.
- Car ownership and where a car parks overnight (TASK-129).

## Gates

1. **Rule.** In T63, on synthetic fixtures:
   - one free strip space and three cars choosing it in turn: the first claims it, the other two
     choose elsewhere at once, and none of them is rejected at the space;
   - a garage with two free spaces and three cars: the third drops the garage at choice time;
   - a lot keeps today's behaviour;
   - a car removed for gridlock, a failed car and a respawned car each release their claim
     (count back to zero, the space free for the next car);
   - a car that chooses again releases the old claim before taking the new one;
   - the departure fallback to a full facility makes no claim;
   - a live edit that removes a claimed strip releases the claim;
   - same input, same parking hash; save and load mid-run keep claims.
2. **Munich at 0.15 to 10:00 (the gate in `munich-morning`).**
   - Completed at least main's (3 571).
   - Gridlocked no more than main's (23).
   - `no_parking` no more than main's (13).
   - 0 stalled heads.
   - Total parking search time below main's (56 894 s).

   Report every count beside main's, and explain any change of more than 2%. The baseline
   resets at merge.
3. **T53** passes its rule (zone stops with walkers at most plain × 1.5 + 10; main 51 / 57).
4. **Sindelfingen at 0.15 to 10:00:** completed, gridlocked and `no_parking` beside main's
   (156 / 0 / 245). Explain the `no_parking` count: is it claims, capacity, or reach?
5. **Performance:** a Munich 0.15 run to 10:00 takes within 5% of main's wall time (warm, side by
   side, same machine, nothing else running). Report both times.
6. **Checks.** The light tier (AGENTS.md "Delivering a task"): `npm run check`,
   `npm run test:city`, `npm run test:traffic:light` and `npm run test:e2e:light` are green, plus
   the specs that drive parking and the sim: `T54-parking-motion`, `T16-performance`,
   `T49-lots`. Run e2e with `CITYFLOWS_TEST_PORT=5327` and
   `CITYFLOWS_PRODUCTION_TEST_PORT=5427`; never use port 4173 or 5173. Do not run the whole
   `npm run test:e2e`, `npm run test:traffic` or `npm run bench`; they run at checkpoints. The
   lead runs the full-demand gate at merge.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5327`), import Munich, run to 08:30, turn on
parking occupancy, and select a car searching for parking: its inspector shows the facility it
is heading for and, for a strip, the space it has claimed. The inspector already shows
`parking.detail`'s `parkingFacility` and `parkingSpace`; make `parkingSpace` report the claimed
space before the manoeuvre, with no UI change. Select a strip that cars were chasing on main (from your top-20 list)
and describe what happens there now.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the claim model as built: where claims are made, checked and released, and every release path
  you found;
- whether the lot count leaked on main, with the case that shows it;
- the measurements under Design 7, beside main's;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main.

Commit on `task/125-parking-claims`; do not push or merge. The lead reviews only commits.
