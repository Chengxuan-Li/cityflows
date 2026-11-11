# TASK-128 — Stations as trip ends

Owner: the lead, through a Claude Code subagent (owner's orchestration rule, 2026-11-11)
Gate: 10 candidates (owner backlog, 2026-11-10): rail item, people leave arriving trains
Branch: `task/128-station-trips` (created by the lead from main)
Depends on: TASK-126 (stations, platforms, entrances) and TASK-127 (the train timetable).
Lead refresh (2026-11-11): the owner's Codex run never started; the lead runs this task through a
Claude Code subagent alongside TASK-129 (car ownership), which changes `src/demand/population.ts`,
`schedule.ts` (driver assignment), `src/sim/parking.ts` and `persons.ts`. Keep edits to
`schedule.ts`, the person inspector and `bench/import-probe.ts` additive; the lead reconciles. Ids
and gates below are refreshed for main after TASK-131 (junction groups) and TASK-140.
Originally ran alongside: the lead's re-measure of TASK-122 (parking egress), which changes
`src/sim/parking.ts`, `src/sim/connectors.ts` and `src/sim/persons.ts` and will most likely merge
first. Stay out of `src/sim` where you can; the lead reconciles at merge.
Followed by: TASK-129 (car ownership) and TASK-113 (mode choice), which may later send residents
to the station by train. Not this task.
Design: this file; `docs/architecture.md` sections 5 (rail graph and trains, TASK-126/127), 8
(simulation and person trips, TASK-112) and 9 (demand). Read TASK-127's contract and its review in
`docs/plan.md`.

## Goal

People arrive by S-Bahn at Donnersbergerbrücke:
- when a train stops, its riders walk out of the station's entrances;
- each rider walks to a place nearby (work in the morning, a visit later in the day);
- later each rider walks back to the station, and that trip ends there: the rider boards a train
  and leaves the simulation.

The station becomes a real trip end. Riders are pedestrians only: no car, no parking, no mode
choice. Their timing follows TASK-127's timetable, so the walkers appear right after a train
stops.

What exists today:
- **Stations.** `Place.station { platforms, entrances }`. Donnersbergerbrücke is `p:1484`, with
  rail platforms `rp:10743` and `rp:10744` and entrance walk nodes; each entrance node carries
  `entrance.placeId = p:1484`, so `city.walk.places` already anchors walk trips at the station.
  Platforms are not on the walk network.
- **Trains.** `trainTimetable(rail)` and `TrainRoute.stops` (`src/network/trains.ts`): each S-Bahn
  stop has its platform, its position and `arrivalS` within the route. A train arrives at
  departure time + `arrivalS`, repeating every `periodS`, and dwells 40 s. Munich has 15 stops
  per hour at each of the two platforms. Sindelfingen and the synthetic fixtures have no S-Bahn
  stops.
- **Demand.** `scheduleTrips` (`src/demand/schedule.ts`) builds person trips from the population,
  then appends `throughTrips` and `eventTrips`, which are generated from the city and scenario
  without persons in the population. Walk trips with a `personId` are run by
  `src/sim/persons.ts` as person journeys (TASK-112), and a person's next trip waits for the
  previous one.

## Design

1. **Riders per stop.** Every S-Bahn stop at a platform that belongs to a station place brings
   riders who get off:
   - **Profile:** keep the numbers in one constants module (no settings UI), as riders per stop
     at full population (`personsPerResident = 1`), scaled by the scenario's
     `personsPerResident`:
     - commuters, by arrival hour: 05:00 10, 06:00 30, 07:00 50, 08:00 50, 09:00 30, 10:00 15;
     - visitors, 11:00 to 21:59: 10 per stop;
     - no riders from 22:00 to 04:59.
   - **Rounding:** fractional counts round by a seeded draw per stop, as `throughTrips` does, so
     the expected count is kept. Munich at 0.15 gets about 7.5 per stop at the 07:00 peak, about
     225 riders an hour.
   - **Main-line trains** pass and bring no riders.
2. **Trips.** Generate riders in a new demand module (suggested `src/demand/stations.ts`), called
   from `scheduleTrips` beside `throughTrips` and `eventTrips`. They are not added to the
   persisted population.
   - **Identity:** `rider:<stationId>:<stop key>:<i>`, where the stop key is stable (platform and
     arrival time). The trips are deterministic from the city, the timetable and the scenario seed.
   - **Arrival trip:** mode `walk`, from the station to the destination. It departs at the train's
     arrival plus the time to walk from the train's middle to the nearest entrance, at the default
     walk speed, straight line × 1.3. State the rule and report the median and maximum delay.
   - **Destination:** a place within 1 500 m straight line of the station, not a gateway, parking
     facility or the station itself. Commuters choose by `jobs × exp(−d / 600 m)`, visitors by
     `attraction × exp(−d / 600 m)`. A stop with no eligible place brings no riders; report it.
   - **Stay:** commuters stay the scenario's work duration, visitors a seeded 1 to 3 hours.
   - **Return trip:** mode `walk`, from the destination back to the station, same `personId`. It
     ends at the station's entrance: the rider boards and is done. Riders do not wait for a
     particular train.
3. **Simulation.** Riders should run through the existing person-trip path unchanged: walk trips
   with a `personId` and no gateway end.
   - Check what `src/sim/persons.ts` and the person inspector do with a `personId` that is not in
     the population, and fix only what riders need.
   - Prefer the demand and UI side. If a change in `src/sim` is unavoidable, keep it small, name
     it in your report, and do not touch `src/sim/parking.ts` or `src/sim/connectors.ts`
     (TASK-122).
4. **Inspection.** Selecting a rider walker shows a person whose day reads as "arrived by train at
   Donnersbergerbrücke 07:03", the destination, and the return to the station. Keep it to the
   existing person inspector.
5. **Census.** Per city, in `bench/import-probe.ts`:
   - riders per hour by kind, and per platform;
   - the top ten destinations with their counts;
   - the median and 90th-percentile walk distance, from the route the simulation used;
   - stops without riders and why.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report. Stop and ask the lead only for a file
named under "Out of scope", a contract change this task does not describe, or a behaviour change
to another feature.

Pre-approved, no need to ask:
- new modules in `src/demand/` (riders and the constants), and `src/demand/schedule.ts`;
- a read-only helper in `src/network/trains.ts` that lists station arrivals over a time window,
  if the timetable types are awkward to read from demand; trains must stay as they are (same
  timetable hash);
- the person inspector (`src/ui/inspector/person.tsx`) and person detail plumbing in the store;
- `bench/import-probe.ts` (the rider census), and `bench/traffic-baseline.json` (the baseline
  resets at this merge, owner rule 7; the lead re-records it);
- `docs/architecture.md` sections 8 and 9;
- tests: a new `tests/demand/T65-station-riders.test.ts` (or a folder that fits the existing
  layout), a new e2e spec `tests/e2e/T65-station-riders.spec.ts`, and the traffic tests'
  expected counts and hash pins that move, each named with its reason.

## Out of scope

- `src/sim/parking.ts` and `src/sim/connectors.ts` (TASK-122), and car behaviour of any kind.
- `src/routing/**`, the walk network, the rail network, the importer, the train timetable and its
  drawing.
- Residents travelling out by train, mode choice and car ownership (TASK-113, TASK-129).
- Riders waiting on platforms, train capacity, people drawn inside trains, and boarding at a
  particular train.
- Schema or scenario fields: the profile is constants only. A settings UI.

## Gates

1. **Rule.** In T65, on synthetic fixtures (reuse T64's synthetic rail city with a station):
   - **Timing:** riders depart only at an S-Bahn stop's arrival plus the stated platform-to-door
     delay, from the station; a main-line train passing brings none.
   - **Counts:** riders per stop follow the profile and scale with `personsPerResident`, and the
     expected count is kept by the seeded rounding.
   - **Destinations:** within 1 500 m, never a gateway, parking facility or the station.
   - **Return:** each rider's second trip ends at the station after the stated stay.
   - **Determinism:** same city and scenario, same trips and same hash.
   - **No trains, no riders:** the trip lists of Grid, Town, the Station fixture and Sindelfingen
     are equal to main's, and every synthetic simulation hash is unchanged.
2. **Munich at 0.15 to 10:00** (the gate in `munich-morning`, and the quick tier). Report each
   count against main at your branch point:
   - rider trips spawned, completed and failed by reason; walk fallbacks (straight-line legs) under
     2% of rider legs; failed rider trips under 2%;
   - cars against main's baseline (4 113 completed, 26 gridlocked, 0 parking failures, 0 stalled
     heads): completed at least 98% of main's, gridlocked at most main's plus 10, parking failures
     at most main's, 0 stalled heads;
   - the quick 09:30 tier with the same figures.
   The traffic baseline resets at merge (owner rule 7); the lead records it.
3. **Sindelfingen.** Every count equal to main's.
4. **Full demand.** Run Munich's full-demand test once and report completed, gridlocked, parking
   failures, stalled heads and riders against main.
5. **Performance.** Munich 07:00 to 10:00 wall time within 10% of main, measured on an idle
   machine; report it and the peak number of walkers.
6. **Pictures.** 2D and 3D shots of riders leaving Donnersbergerbrücke's entrances just after an
   S-Bahn stops, and of a selected rider with the person inspector. Check them yourself: the
   walkers start at the entrances, not on the tracks or in the station's middle.
7. **Checks.** The light tier (AGENTS.md "Delivering a task"):
   - `npm run check`, `npm run test:city`, `npm run test:traffic:light` and
     `npm run test:e2e:light` are green;
   - so are your T65 spec and `T53`, `T64-trains` and `T62-rail-stations`.

   Run e2e with `CITYFLOWS_TEST_PORT=5329` and `CITYFLOWS_PRODUCTION_TEST_PORT=5429`; never use
   port 4173 or 5173. Do not run the whole `npm run test:e2e`, `npm run test:traffic` or
   `npm run bench`; they run at checkpoints. Put the T65 e2e spec in the group that fits its cost
   in `playwright.config.ts` (Munich specs go to a full group, not the light set) and say which.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5329`), import Munich and play from 07:00 at
×5:
- watch an S-Bahn stop at Donnersbergerbrücke and its riders walk out of the entrances, in 2D and
  in 3D;
- select one rider and read its day in the person inspector;
- find a rider returning to the station and see the trip end there.

Describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the rider rule: profile, rounding, platform-to-door delay, destination choice, stay;
- the census and every count under Gates, against main;
- files changed outside the pre-approved list and why, and any `src/sim` change;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main.

Commit on `task/128-station-trips`; do not push or merge. The lead reviews only commits.
