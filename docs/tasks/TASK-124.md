# TASK-124 — Every garage and place has a car exit (B58)

Owner: unassigned
Gate: 9 (occupancy-driven trips): parking that cars can leave
Branch: `task/124-garage-exits` (created by the lead from main)
Depends on: TASK-102 (garages), TASK-103 and TASK-119 (strips and mapped parking), TASK-104
(lots).
Runs alongside: TASK-123's round 3 (walk network; it owns `src/network/walk.ts`,
`walk-joins.ts` and the walk parts of `bench/import-probe.ts`). TASK-122 (trip cars park only
where they can leave) is on hold until this task is merged, and the lead re-measures it on top.
Design: this file; `docs/architecture.md` sections 4 (places, parking, connectors), 5
(diagnostics) and 13 (OSM import). Read B58 in `docs/plan.md` and the lead's TASK-122 reviews
(rounds 1 and 2) first.

## Goal

Two large Munich garages have no way out by car. Their cars park in the morning and cannot leave.
With TASK-122's rule, which refuses spaces a car cannot leave, about 120 morning arrivals
cruise nearby streets for up to two hours instead, and the traffic gate fails. A garage or place
whose exit leads nowhere is an import defect, not a driver decision: fix it where the exit is
chosen.

The lead's count on main's network (c9bb6bf; TASK-122's branch leaves the network as it is) of garages, lots and strips with more than 20 spaces whose exit
connectors cannot reach the largest strongly connected set of car-legal lanes. It uses TASK-122's
departure check (`src/sim/parking-egress.ts` on `task/122-parking-egress`), with lane changes at
30 m.

| City | Facility | Kind, spaces | Owner place | Exit lane, road | Its only continuations |
| --- | --- | --- | --- | --- | --- |
| Munich | `pk:1981` | implicit garage, 1 071 | `p:1733` | `c:1734` on `r:379` (Trappentreustraße, one direction of a two-way street) | `r:373`, bus only |
| Munich | `pk:2035` | implicit garage, 441 | `p:1841` | `c:1842` on `r:1060` | `r:921`, private |
| Sindelfingen | `pk:1443` | mapped garage, 7 414 | `p:1339` | `c:1444` on `r:558` | none |
| Sindelfingen | `pk:1445` | mapped garage, 77 | none | `c:1446` on `r:359` | `r:360`, `r:362` |
| Sindelfingen | `pk:1456` | implicit garage, 228 | `p:1413` | `c:1414` on private `r:266` | `r:263`, `r:265` |
| Sindelfingen | `pk:1457` | implicit garage, 45 | `p:1415` | `c:1416` on private `r:260` | `r:259` |
| Sindelfingen | `pk:1474` | lot, 26 | `p:1345` | two entries on `r:1563`, `r:1564` (destination only) | `r:1566`, `r:1574` |
| Sindelfingen | `pk:2358`, `pk:2359`, `pk:2423`, `pk:2424` | strips, 57 + 57 + 132 + 150 | none | `r:1063`, `r:1064`, `r:994`, `r:995` | each other: a closed loop |
| Sindelfingen | `pk:2382`, `pk:2384`, `pk:2385`, `pk:2386` | strips, 51 + 51 + 26 + 25 | none | `r:399`, `r:400`, `r:402`, `r:403` | each other and `r:292` |
| Sindelfingen | `pk:2369` | strip, 37 | none | `r:1244` | `r:962` |

The likely cause of the Munich pair: `placeConnector` in `src/importers/osm/places.ts` snaps a
place to the nearest lane in `networkAccess`'s core, and that core is built from every movement
regardless of vehicle class or road access. A lane whose only way on is a bus-only or private
road is in the core, so the place snaps to it. An implicit garage reuses its place's connectors
(`addImplicitGarages`), so the place's own car trips leave through the same trap. Mapped
garages (`placeConnector(..., parking = true)`) skip the core test altogether.

## Design

1. **Trace first.** For every facility in the table, and every place whose out connector has no
   car exit in either city (count them; the table lists only parking):
   - follow the exit lane's movements until they reach the car core or stop;
   - name the cause: snapped to a lane that is only in the all-class core, a mapped garage
     snapped without a core test, a mapped aisle loop with no mapped junction to the street, a
     road cut by the crop, or something else.

   Group by cause and put the table in your report. If a large group needs a change in the
   vehicle network (lanes, movements, junctions), stop and report to the lead before building it.
2. **A car exit for snapping.** "Has a car exit" means exactly what TASK-122's departure check
   (`parkingEgress` in `src/sim/parking-egress.ts` on `task/122-parking-egress`) decides for a
   car: per origin access zone, the lanes open to it (`car` allowed, access `yes`, or `private`
   or `destination` in the origin's own zone), the largest strongly connected set of them, and
   the backward pass with lane changes at 30 m. Do not build a separate public-only core (lead
   ruling, 2026-11-10: in Sindelfingen it is 62 lanes, disjoint from the network cars actually
   use, because the circulation runs through private zones). Port that definition into a new
   module in `src/network/` that the importer and the diagnostics share; TASK-122 will use it
   when it is re-integrated. Before changing any connector, show that the module reproduces
   your census on main: Munich 21 facilities / 1 607 spaces, Sindelfingen 44 / 8 523.

   Use it in `placeConnector` for places and for every garage and lot entry the importer places,
   mapped or inferred. A connector then sits on a lane a car can both reach and leave, on
   whichever direction of a two-way street does that. Measure a mapped garage's or lot's
   distance from its footprint, not its centroid. State the distance limit you use and what
   happens beyond it. If `pk:1443` has no candidate within a limit you can justify, report the
   distance and stop there for that one garage.
3. **Private and destination roads.** A facility whose only road is a private or destination
   road (`pk:1456`, `pk:1457`, `pk:1474`) may keep its entry there when that road leads into the
   car core. Only where it leads nowhere does the connector move. Say which rule each of these
   three follows.
4. **What the network cannot fix here.** Strips sit on their own mapped road, so their slots do
   not move. A strip on a road cut by the crop, or on roads whose only way out is a private
   zone it cannot enter, stays as it is and is listed as a real gap, with its reason. The lead
   accepts the strips in the trace of 766a4d5 on these grounds (Munich 16 strips / 85 spaces,
   Sindelfingen 32 / 721). A missing junction between a mapped aisle and the street is a
   vehicle-network change: report it, do not add it. Gateways sit on the crop edge by design;
   count them, but they are not part of the place gate.
5. **A warning for saved projects.** Connectors are saved in the project, so files imported
   before this task keep their traps. Add a compile warning `parking_no_exit` for a garage or lot
   whose out connectors cannot reach the car core, and `place_no_exit` for a place whose out
   connectors cannot. Each names the connector and its lane. It is a warning, not an error: the
   city still compiles and runs. List the codes in `docs/architecture.md` section 5, with the others.
6. **Measure.** In both cities, before and after:
   - facilities and spaces without a car exit, and places without one;
   - connectors moved: how many, and how far;
   - completed, gridlocked and stalled heads at 0.15 to 09:30 and to 10:00, and at full demand;
   - parking failures (`no_parking`) and total parking search time (summed over every trip's
     `parkingSearchTimeS`, including unfinished searches) in the same runs;
   - import time.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested, as long as it is not named
under "Out of scope"; list each such file and why in your report. Stop and ask the lead only
for a file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature. Trip counts may change; that is not a behaviour change
to ask about.

Pre-approved, no need to ask:
- `src/importers/osm/places.ts` (`networkAccess`, `placeConnector`), `parking.ts`,
  `buildings.ts`, and the other importer files that place connectors. If the Overpass query
  changes, bump `queryVersion` in `src/importers/overpass.ts`;
- a new module in `src/network/` for the car-exit check (Design 2);
- `src/network/parking.ts` (implicit garages, entry checks) and `src/network/diagnostics.ts`;
- `docs/architecture.md` sections 4, 5 (diagnostics) and 13;
- `bench/import-probe.ts`: an exit census (facilities, spaces and places without a car exit).
  Keep it apart from the walk counters, which TASK-123 is changing;
- tests: a new `tests/importers/T61-car-exits.test.ts`, plus the hash pins and counts that move,
  each named with its reason.

## Out of scope

- `src/sim/**` (TASK-122's parking rules wait for this task), `src/demand/**`, `src/routing/**`.
- The vehicle network: lanes, movements, junctions, strips and lot aisles. The lanes and
  movements hash stays equal to main's in both cities; only connectors move.
- `src/network/walk.ts`, `walk-joins.ts`, `crossings.ts` (TASK-123).
- `fixtures/osm/**`. Do not download new data.
- `tests/e2e/**` other than a spec of your own.

## Gates

1. **Rule.** In T61, on synthetic fixtures:
   - a place nearest a lane whose only movement enters a bus-only road snaps to the nearest lane
     a car can leave, and its implicit garage follows it;
   - the same with a private road, and with a road cut off by the crop;
   - a two-way street where only one direction leads into the network: the connector goes on
     that direction;
   - a mapped garage entrance on a dead-end lane moves to a lane with an exit, within the limit
     you state;
   - a private road that leads into the car core keeps its connector;
   - `parking_no_exit` and `place_no_exit` appear for a saved city whose connector is on a trap
     lane, and not after re-import.
2. **Exits.** No garage or lot with more than 20 spaces, and no place other than a gateway with
   residents or jobs, lacks a car exit in either city, except the real gaps you list with their
   reasons. Garages, lots and places in the real gaps hold at most 2% of each city's garage and
   lot spaces. Strips are listed but do not count toward that 2% (Design 4). `pk:1981`,
   `pk:2035` and `pk:1443` are not real gaps, unless you stop on `pk:1443` under Design 2.
3. **Cars unchanged.** The lanes and movements hash equals main's in both cities. Connectors may
   move.
4. **Traffic.** On Munich at 0.15:
   - `npx vitest run --project traffic tests/traffic/munich-morning.test.ts --reporter=verbose
     --silent=false` passes (10:00: completed at least 90% of 3 571, gridlocked at most 34, 0
     stalled heads);
   - `npm run traffic:quick`: completed at least 98% of main's 3 357, gridlocked at most 12,
     stalled heads at most main's 3;
   - `tests/traffic/T53-munich-pedestrians.test.ts` passes;
   - `tests/traffic/munich-full-demand.test.ts` passes; report its parking failures against
     main's 30.

   Sindelfingen at 0.15 to 10:00: report completed, gridlocked and `no_parking` against main
   (156 / 0 / 245). They must not get worse.
5. **Performance.** Import within 5% of main's on both cities, compile within 5%. Measure warm
   runs, side by side.
6. **Checks.** `npm run check`, `npm run test:city`, `npm run traffic:quick` and
   `npm run test:e2e:smoke` are green. Run e2e with `CITYFLOWS_TEST_PORT=5325` and
   `CITYFLOWS_PRODUCTION_TEST_PORT=5425`; never use port 4173 or 5173. Before committing, also
   run `demo-a-commute`, `T52`, `T54-parking-motion`, `T57-person-trips` and the import specs
   (`gate5-controls`' Import OSM case, `qa-mobile`'s import case).

## Checks to run

- While iterating: `npm test` (unit tier), T61, the import probe on both cities.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick`, the three
  traffic tests named in gate 4, `npm run test:e2e:smoke` and the e2e specs in gate 6.
- Do not run the whole `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`. The
  lead runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5325`), import Munich, select the garage
`pk:1981` and its place `p:1733`, and check where the exit connector now sits. Run to 09:00 and
follow a car that leaves `p:1733`: it reaches the street network without entering a bus-only
road. Describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the trace table, grouped by cause, and the real gaps left;
- the car core and the snapping rule as built, with the distance limit;
- the counts listed under Measure;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main. Write any Markdown or docs as UTF-8.

Commit on `task/124-garage-exits`; do not push or merge. The lead reviews only commits.
