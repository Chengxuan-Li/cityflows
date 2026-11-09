# TASK-122 — Trip cars park only where they can leave

Owner: unassigned
Gate: 9 (occupancy-driven trips): parking failures at full demand
Branch: `task/122-parking-egress` (created by the lead from `task/lead-112`, which integrates TASK-121
and TASK-112 before they reach main; TASK-112's round 2 runs on that branch at the same time and
changes e2e specs, so leave `tests/e2e/**` other than your own to it)
Depends on: TASK-103 (visible parking), TASK-118 and TASK-119 (parking motion, mapped strips),
TASK-112 (trips made by people; it owns where a person walks to their car).
Replaces: TASK-120 (dead-end turnarounds), rejected 2026-11-09. Read its review entry in
`docs/plan.md` first: the strips that strand cars are not at dead ends, so a turnaround in the
network does not reach them, and it cost 168 lot bays.
Design: this file; `docs/architecture.md` section 9 (demand: parking choice, starting stock, the
lead's starting-stock follow-up) and section 8 (simulation: parking motion).

## Goal

At full demand, Munich had 32 parking failures (`no_parking`) out of 1 599 local arrivals at the
TASK-118/119 merge (2.0%), and the full-demand test was relaxed to 2.5%. After the TASK-121/112
merge it has 30 out of 1 729 (1.7%) and the test is back at 2%. That figure fell because more trips
arrive, not because the cause went away. Most failures are a trip car that starts on a strip
whose lane has no legal way back into the city. The lead's trace at the TASK-118/119 merge found:

| Strip | Road | Slots | Lane | Why a car cannot leave |
| --- | --- | --- | --- | --- |
| `pk:9127` | `r:953` (tertiary) | 16 | 744 | no outgoing movement; the one-way lane ends at the cropped gateway `n:952` |
| `pk:9336` | `r:64` | 10 | 529 | no outgoing movement; cropped one-way gateway `n:63` |
| `pk:9348` | `r:75` | 7 | 623 | no outgoing movement; cropped one-way gateway `n:74` |
| `pk:2416` (Sindelfingen) | `r:904` | 7 | | cropped boundary `n:129`; the reverse `r:903` is banned by an inferred junction-consolidation rule |

Failures were also seen at `pk:9339` (`r:67`), `pk:9217` (`r:1275`) and `pk:9294` (`r:379`). Each of
those lanes has one outgoing movement; find out where it leads. Eleven of the 32 were private
residential-to-gateway trips that never departed and had no origin facility; they are not
explained yet.

These are artefacts of the crop and of one-way streets, not cul-de-sacs, so the network should
stay as it is. The car's decision is what needs to change: a car that will drive again should not
start on, or park in, a space it cannot drive away from.

## Design

1. **Trace first.** Before changing anything, account for every `no_parking` failure in:
   - full-demand Munich (`tests/traffic/munich-full-demand.test.ts`'s run);
   - Munich at 0.15 to 10:00;
   - Sindelfingen at 0.15 to 10:00, where main fails 245 trips `no_parking`.

   For each failure, give the trip, its origin and destination, the facility and space it
   started from or chose, its lane, and the cause. Group them by cause. Explain the eleven trips
   that never departed. Put the table in your report. If a large group has a cause this design
   does not cover, stop and report to the lead before building something else.
2. **Which spaces a car can leave (new, in the sim).** At load, and again after a live edit that
   changes the network, decide for each space's departure connector whether a car can drive from
   it back into the network. The suggested test: the departure lane reaches the largest strongly
   connected set of lanes in the car movement graph, using the movements open to cars. Compute it
   once per compile, not once per trip. Any rule that is as cheap and gives the same answer on the
   named strips is fine; describe what you built.
3. **Starting stock.** Cars that have a trip never start on a space they cannot leave:
   - the residential street share (`streetParkingShare`) skips those spaces, and the car stays in
     its garage or takes the next space in the usual order;
   - a trip's origin slot (`originSpaces`) is never one of them, and the facility choice moves on
     to the next facility when none of its free spaces can be left.

   Background parked cars, the initial stock that never drives, may still stand there, so the
   strips stay full and drawn.
4. **Arrival.** Parking choice (`choose`, `freeSpace`, `hasFreeSpace`) skips those spaces for a
   car whose person has a later trip from that place. A car with no later trip may still use
   them. Keep everything else about the choice as it is: the ranking, straight-line walking
   distance, `streetParkingShare` and the lot stall choice.
5. **Anything else the trace finds** that is a parking decision, such as a garage or lot whose
   only exit cannot reach the destination, may be fixed the same way. Report each such fix.
6. **Determinism and live edits.** Same seed, same state hash. The set of spaces a car can leave
   is derived data, not saved; a live edit recomputes it. A car already parked on a space that an
   edit makes unleavable keeps its space and departs as today.
7. **Measure.** Per run (full-demand Munich, Munich 0.15 at 09:30 and 10:00, Sindelfingen 0.15 at
   10:00):
   - `no_parking` failures before and after, by cause;
   - completed and gridlocked trips;
   - spaces that cannot be left, per city, with their facilities;
   - trip cars that started in a garage instead of on a strip because of this rule;
   - parking search time and walking distance, before and after;
   - load time and step time.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested, as long as it is not named
under "Out of scope"; list each such file and why in your report. Stop and ask the lead only
for a file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature. Trip counts may change; that is not a behaviour change
to ask about.

Pre-approved, no need to ask:
- `src/sim/parking.ts`, `connectors.ts`, `persons.ts` (where the person walks to the car, if the
  car's start moves), `metrics.ts`, `patch.ts`, and a new helper module in `src/sim/` for the
  departure check;
- `src/sim/engine.ts` (hooks only);
- `bench/import-probe.ts` (failure attribution by cause, unleavable spaces);
- `docs/architecture.md` section 9 (starting stock and parking choice: the departure check);
- `tests/traffic/munich-full-demand.test.ts`: its comment, and `0.01` if gate 2 allows it;
- tests: a new `tests/sim/T59-parking-egress.test.ts`, plus the hash pins and counts that move,
  each named with its reason.

## Out of scope

- `src/network/**` and importers: no new movements, turnarounds, capacity changes or crop
  changes. Strips keep their slots.
- `src/sim/intersection.ts`, `reroute.ts`, `lane-change.ts` and the gridlock path (TASK-121).
- Routing cost functions in `src/routing/**`.
- The parking choice ranking, `streetParkingShare`, the search radius, and the number of cars in
  the starting stock.
- Mode choice (TASK-113).

## Gates

1. **Rule.** In T59, on synthetic fixtures:
   - a strip on a one-way lane into a gateway: no trip car starts there, background stock still
     fills it, and a resident whose share would have put the car there starts in the garage and
     completes the trip;
   - a car with a later trip does not park there; a car with no later trip may;
   - a live edit that adds a way out makes the strip usable again, and one that removes it makes
     it unusable for new choices without moving cars already parked;
   - same seed, same state hash.
2. **Full demand.** `tests/traffic/munich-full-demand.test.ts` passes at `0.02`. Run that test
   yourself (`npx vitest run --project traffic tests/traffic/munich-full-demand.test.ts`, about
   6 to 8 minutes) and report its counts. No `no_parking` failure is left at the named strips,
   and the total is at most half of main's 30. Tighten the test to `0.01` if the result allows
   it with room to spare, and say so.
3. **Traffic.** `npm run traffic:quick` against main:
   - completed at least 98% of main's;
   - gridlocked at most main's plus 10%;
   - stalled heads at most main's;
   - counted parking failures at most main's.
4. **Sindelfingen.** Report its `no_parking` failures before and after, by cause. They must not
   rise; say how much of the 245 this rule removes and what the rest are.
5. **Stock.** The number of cars parked at 07:00 (trip cars and background stock) equals main's
   in both cities. Only their placement changes.
6. **Performance.** Load time within 10% of main and step time within 5%, on Munich at 0.15.
7. **Checks.** `npm run check`, `npm run test:city`, `npm run traffic:quick` and
   `npm run test:e2e:smoke` are green. Run e2e with `CITYFLOWS_TEST_PORT=5322`; never use port
   4173 or 5173. Before committing, also run `demo-a-commute`, `T16-performance`, `T52`,
   `T54-parking-motion`, `T57-person-trips` and `qa-exports`.

## Checks to run

- While iterating: `npm test` (unit tier), `npm run traffic:quick`, the full-demand test.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick`,
  `npm run test:e2e:smoke`, the full-demand test and the e2e specs named in gate 7.
- Do not run the whole `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`. The
  lead runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5322`), import Munich, set the scale to 0.15,
turn "Parked cars" on, and look at `pk:9127` on `r:953` at 07:00 and at 09:30. The strip is full of
parked cars and none of them is a trip car that later fails. Describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the failure trace, grouped by cause;
- the departure check as built, and what it costs at load;
- the counts listed under Measure;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main. Write any Markdown or docs as UTF-8.

Commit on `task/122-parking-egress`; do not push or merge. The lead reviews only commits.
