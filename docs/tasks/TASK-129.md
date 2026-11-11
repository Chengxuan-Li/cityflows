# TASK-129 — Car ownership: household cars that park near home

Owner: unassigned
Gate: 10 candidates (owner backlog, 2026-11-10): car ownership, before mode choice
Branch: `task/129-car-ownership` (created by the lead from main)
Depends on: TASK-112 (person trips), TASK-122 (parking egress) and TASK-125 (parking claims), all
merged.
Runs alongside:
- **TASK-128** (stations as trip ends) adds riders in a new `src/demand/stations.ts`, one call in
  `src/demand/schedule.ts`, lines in the person inspector and a census in `bench/import-probe.ts`.
  Riders are walk-only persons outside the population: they have no household and no car. Keep
  your edits to those shared files additive; the lead reconciles at merge.
- **TASK-130** (the Landsberger loop) changes `src/sim/engine.ts`, `intersection.ts`,
  `reroute.ts`, `lane-change.ts` and `merge.ts`. Stay out of them.

Each of the three resets the traffic baseline at its merge (owner rule 7).
Followed by: TASK-113 (mode choice), which will choose between the modes a person has, among them
"no free household car".
Design: this file; `docs/architecture.md` sections 8 (parking and person trips, TASK-103,
TASK-112, TASK-118, TASK-122, TASK-125), 9 (demand) and 12 (project format). Read the TASK-112,
TASK-122 and TASK-125 review entries in `docs/plan.md` before the code.

## Goal

Cars belong to households, and they live near home:
- **Households:** the people of a home are grouped into households, and each household owns its
  cars.
- **Driving:** a person drives only a car their household owns, and only when that car is at home
  when the person's day starts.
- **Parking:** every car starts the day parked near its home, and comes back to park near home,
  not at a facility far away.

What exists today:
- **Cars.** `generatePopulation` draws `Person.hasCar` per person with `carShare`.
  `scheduleTrips` makes every trip of a car owner `car` and every trip of anyone else `walk`.
  There is one car per owner, and a person's car trips chain by `personId` (`previous` and
  `nextTrip` in `src/sim/parking.ts`; the person-journey chain in `src/sim/persons.ts`).
- **The starting stock** at a home is `ceil(round(residents × personsPerResident) × carShare)`
  ownerless cars. They are spread over the home's garage and, by `streetParkingShare`, over strips
  and lots within `parkingSearchRadiusM` (400 m). A person's first car trip of the day takes the
  first stock car it finds, in departure order: in a street strip or lot near home, in the home's
  garage, or in the inferred home garage. So which car a person drives depends on who leaves first,
  and a car can end up in another home's stock.
- **Going home.** A car whose trip ends at home ranks facilities as any other trip does: own
  garage or a near strip first, then garages within the radius, then public facilities beyond
  it (rank 3). When the near ones are full or claimed, the car parks beyond 400 m from home.

## Design

1. **Trace first.** On main at your branch point, Munich at 0.15, seed 1, 07:00 to 10:00, and
   Sindelfingen 0.15 to 10:00, report:
   - persons, persons with a car, car trips and walk trips by origin kind;
   - for each car trip that ends at its home: the distance from home to where the car parked
     (median, 90th percentile, maximum), and how many parked beyond 400 m and why (near ones full,
     claimed, no exit for the next trip, no facility at all);
   - how many first car trips took a stock car that started near another home.

   Then build.
2. **Households.** In `src/demand`, group each residential home's persons into households, in
   person index order:
   - **Sizes:** draw household sizes from a constants module (no settings UI): 1 person 41%,
     2 persons 34%, 3 persons 12%, 4 persons 9%, 5 persons 4% (Germany, 2023 microcensus). Use a
     seeded sub-stream per home, so adding a place does not reshuffle other homes. The last
     household takes the persons left over.
   - **Sampling:** households group the sampled persons, so at `personsPerResident` 0.15 a home
     with 7 sampled persons has two or three households. State this in `docs/architecture.md`.
   - **Gateways:** a gateway person (an external commuter) is a household of one, as today.
   - **Persistence:** add `householdId` to `Person`, for example `hh:<homePlaceId>:<k>`. The
     population stays the persisted source.
   - **Old projects:** a saved population without `householdId` loads with the households the
     same grouping gives, by a pure function of the saved persons and the demand seed. A migrated
     population then has the same households as a freshly generated one with the same persons.
3. **Cars.** A household owns one car for each member with `hasCar`, so the fleet is the same as
   today's car owners and no existing draw moves.
   - **Identity:** a stable id, for example `car:<householdId>:<k>`.
   - **Who drives, decided per day in `scheduleTrips` from the planned agenda.** A member's day
     away from home runs from their first departure to their planned return home, plus a 30 min
     margin.
     - **Car owners first:** members with `hasCar`, in order of first departure, each take a free
       car of their household for their day away.
     - **Then the others:** a member without `hasCar` takes a car only if one is free for their
       whole day away.
     - **Everyone else walks all day:** this round has no mode choice (TASK-113).
     - **A day without car trips:** the car stays parked at home all day.
   - **On the trip:** a car trip carries its `carId`, a new optional field on `TripRequest`. Walk
     trips, riders, through and event trips have none.
   - **Report:** cars driven, cars that stayed home, borrowed car days (a member without `hasCar`
     drove), and members who wanted a car but found none free.
4. **One car, several drivers.** The simulation chains a car's trips by `carId` (falling back to
   `personId`), not by person:
   - **Where the car leaves from:** the second driver's first trip leaves from where the first
     driver parked it.
   - **Waiting:** if that car is not back yet, the trip waits for it, as a person's next trip
     waits for their previous one today. Report the waits (count, median, maximum).
   - **No other car:** a trip never takes another car.
   - **Files:** keep the change to the chain keys in `src/sim/parking.ts` and the journey wait in
     `src/sim/persons.ts`. TASK-122's exit mask (`requiresExit`, `departure(nextTrip)`) follows the
     car's next trip, whoever drives it.
5. **Starting stock.** The cars of the households are the stock:
   - **Placement:** each household car starts parked near its home under the existing placement
     rules: home garage, `streetParkingShare` to strips and lots within the radius, the inferred
     home garage as the fallback. Placement is seeded per car, not first come first served.
   - **Driving:** the car's first trip leaves from that car's space.
   - **Count:** the stock per home is the number of household cars there. Report it against
     today's `ceil(…)` formula, summed per city.
   - **No ownerless cars:** every parked car at 07:00 belongs to a household, and a car never
     starts in another home's place.
6. **Park near home.** A car trip that ends at its household's home chooses only facilities
   within a home radius:
   - **The radius:** `SimParams.homeParkingRadiusM`, default 400, the same as
     `parkingSearchRadiusM`.
   - **When everything near home is full or claimed:** the car goes to the home's inferred
     garage if there is one (it never turns a car away). Otherwise it searches within the radius
     under the existing search rules, and only beyond the radius when no facility inside it
     admits the car at all.
   - **Report:** every car parked beyond the radius, with its reason.

   Trips to other destinations keep today's choice.
7. **Inspection.** In the person inspector:
   - the household (its id and members);
   - the car the person drives today, or "no free household car today";
   - for a borrowed car, its owner.

   Selecting a parked or moving car shows its household; reuse the existing car detail.
8. **Census.** In `bench/import-probe.ts`, per city:
   - households by size;
   - cars per household;
   - every count under Design 3, 4 and 6;
   - the distance-from-home figures of Design 1, against main.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file the
feature needs in order to be wired in, type-check or be tested, as long as it is not named under
"Out of scope"; list each such file and why in your report. Stop and ask the lead only for a file
named under "Out of scope", a contract change this task does not describe, or a behaviour change
to another feature.

Pre-approved, no need to ask:
- `src/demand/population.ts`, `schedule.ts`, `agenda.ts` (read the planned times), a new
  households module and its constants;
- `src/schema/demand.ts` and `demand.schema.ts` (`Person.householdId`, `TripRequest.carId`),
  `SimParams.homeParkingRadiusM` in `src/schema` with its default in `src/sim/params.ts`, and the
  population loading in `src/project/open.ts` (Design 2, old projects);
- `src/sim/parking.ts` (the chain key, per-car starting stock, the home radius) and
  `src/sim/persons.ts` (the wait for a car, person detail);
- the person inspector (`src/ui/inspector/person.tsx`), the car detail, store plumbing, and
  the demand panel's car count (`src/ui/panels/demand.tsx`);
- `docs/architecture.md` sections 8, 9 and 12, and the "households sharing a car" item in
  section 16;
- `bench/import-probe.ts` (the census) and `bench/traffic-baseline.json` (the baseline resets at
  this merge, owner rule 7; the lead re-records it);
- tests: a new `tests/demand/T67-households.test.ts`, a new `tests/sim/T67-car-ownership.test.ts`,
  T57 and T59 cases that move, an e2e spec `tests/e2e/T67-car-ownership.spec.ts` if the inspector
  needs one, and the traffic tests' expected counts and hash pins that move, each named with its
  reason.

## Out of scope

- `src/sim/engine.ts`, `intersection.ts`, `reroute.ts`, `lane-change.ts`, `merge.ts` (TASK-130).
- `src/demand/stations.ts` and the riders (TASK-128), except that riders stay car-less.
- `src/sim/connectors.ts`, `walkers.ts`, `src/routing/**`, `src/network/**`, the importer.
- Mode choice, licences, car availability over time beyond Design 3, and car sharing between
  households (TASK-113 and later).
- Settings UI for household sizes or the radius: constants and a defaulted `SimParams` field only.

## Gates

1. **Rules.** In T67, on synthetic fixtures:
   - **Households:** sizes follow the constants over many homes. The same seed gives the same
     households, and adding a place leaves other homes' households unchanged. A migrated
     population without `householdId` equals a regenerated one.
   - **Fleet:** cars per household equal its members with `hasCar`; the number of persons with
     `hasCar` and the agendas equal main's.
   - **Drivers:** owners first, borrowers only for a free whole day away, nobody drives a car
     outside their household, and a second driver's trip leaves from where the first parked.
   - **Waiting:** a second driver whose car is late waits for it and never takes another.
   - **Stock:** every 07:00 parked car belongs to a household of its home.
   - **Home parking:** a car going home parks within `homeParkingRadiusM` when anything within
     admits it.
   - **Determinism:** same seed, same state hash.
   - **No households, no change:** fixtures where every home holds one person give the same trips
     and simulation hashes as main.
2. **Munich at 0.15 to 10:00**, seeds 1 to 3 (the gate in `munich-morning`, and the quick tier).
   Against main at your branch point, report:
   - car and walk trips, completed, gridlocked, parking failures by reason, stalled heads with
     their roads, mean delay;
   - every census count.

   Pass when, for each seed:
   - parking failures are at most main's;
   - no car parks beyond the home radius while anything within it admits the car;
   - completed is within 3% of main's, unless car trips themselves moved; explain any change.

   The traffic baseline resets at merge (owner rule 7); the lead records it.
3. **Sindelfingen 0.15 to 10:00:** the same figures; parking failures at most main's (245).
4. **Full demand.** Run Munich's full-demand test once; report the same figures against main.
5. **T53** passes at the 5% walker cost.
6. **Performance.** Munich 07:00 to 10:00 wall time and step time within 5% of main, warm, side by
   side, on an idle machine.
7. **Pictures.** 2D shots at 07:00 and 09:00 around one Munich residential block with its parked
   cars, and the person inspector for a driver, a borrower and a member with no free car. Check
   them yourself.
8. **Checks.** The light tier (AGENTS.md "Delivering a task"):
   - `npm run check`, `npm run test:city`, `npm run test:traffic:light` and
     `npm run test:e2e:light` are green;
   - so are `T54-parking-motion`, `T57-person-trips`, `demo-a-commute` and your T67 spec.

   Run e2e with `CITYFLOWS_TEST_PORT=5331` and `CITYFLOWS_PRODUCTION_TEST_PORT=5431`; never use
   port 4173 or 5173. Do not run the whole `npm run test:e2e`, `npm run test:traffic` or
   `npm run bench`; they run at checkpoints.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5331`), import Munich at 0.15 and play from
07:00 at ×10 to 10:00:
- select persons of one household and see who drives which car;
- follow a car home and see it park near its home.

Describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the trace of Design 1 on main;
- the household and car rules, and the old-project migration;
- the census and every count under Gates, against main, for each seed;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main.

Commit on `task/129-car-ownership`; do not push or merge. The lead reviews only commits.
