# TASK-123 — One connected walk network (B57)

Owner: unassigned
Gate: 9 (occupancy-driven trips): walk legs follow the walk network
Branch: `task/123-walk-connectivity` (created by the lead from `task/lead-112`, which integrates
TASK-121 and TASK-112 before they reach main). Two tasks run at the same time and own other
files: TASK-112's round 2 changes e2e specs, and TASK-122 changes parking and the person code in
`src/sim/`. Leave both alone (see "Out of scope").
Depends on: TASK-110 (walk network), TASK-111 (crossings in the simulation), TASK-112 (person
walks, the `walkFallbacks` count).
Design: this file; `docs/architecture.md` section 5.6 (pedestrian graph, TASK-110), and the
crossing rules from TASK-091 and TASK-094.

## Goal

TASK-112 sends each person on an access walk to the parked car and an egress walk from it. When
the walk router finds no route, the person walks a straight line instead (`walkFallbacks`). In
Sindelfingen at 0.15, 99 of 140 walk legs (70.7%) fall back, all of them egress from a garage.
Munich has none. The cause is the walk graph, not the router: Sindelfingen's walk network is in
pieces.

The lead's count on `task/lead-112`, finding the connected sets with union-find over walk links:

| Measure | Munich | Sindelfingen |
| --- | ---: | ---: |
| Walk nodes / links | 6 573 / 11 582 | 2 778 / 3 252 |
| Connected sets | 66 | 111 |
| Largest set, then the next ones (nodes) | 6 202, 123, 36, 20 | 1 653, 257, 132, 108 |
| Place anchors outside the largest set | 0 of 147 | 23 of 72 |
| Parking facilities with no anchor in the largest set | 0 of 443 | 71 of 128 |
| Parking connectors outside the largest set | 1 of 267 (`c:1451`) | 56 of 136 |

Sindelfingen's second to fourth sets are whole residential areas, with their sidewalks, corners
and crossings. They lie 180 m, 3 m and 13 m from the largest set. Two leads:

- **Separately mapped sidewalks.** Six of Sindelfingen's ten secondary road pieces carry
  `sidewalk=separate`, so `compileWalk` draws no sidewalk there. Two more say `no`. The extract
  holds only 120 footways and 16 crossing ways, so the separate sidewalks may be missing or
  cropped, or may not meet the generated residential sidewalks and crossings. Residential streets
  that end on such a road then have no way along or across it.
- **Short gaps.** Sets 3 m and 13 m apart point at snapping (`SNAP_M = 4`) or at a crossing
  missing where a generated sidewalk meets a mapped footway.

Trace before choosing a fix. The 180 m gap may be the A81 or the crop; say which gaps are real.

## Design

1. **Trace first.** For each set outside the largest one, in both cities, that holds a place
   anchor or a parking anchor or connector:
   - find where it comes closest to the largest set;
   - name what lies between: a road with `sidewalk=separate` or `no`, a crossing the rules leave
     out, a gap wider than the snap, a mapped footway cut by the crop, a motorway, or the crop
     edge.

   Group the sets by cause and put the table in your report. If a large group needs a change
   outside this task's files, stop and report to the lead.
2. **Fix it in the walk compile.** Add whatever the trace shows is needed, each as derived data
   in `compileWalk` (or the walk importer when the OSM data supports it). Likely candidates:
   - where a road is tagged `sidewalk=separate` and no mapped footway runs along that side
     within a few metres, draw the generated sidewalk as if the tag were absent;
   - join a mapped footway or crossing way to the generated sidewalk or corner it meets, within a
     stated distance and on the same layer;
   - add the crossing a junction arm needs to join the sidewalks on both sides, under the
     existing crossing rules.

   Mark every added link `generated: true`, as TASK-110's links are. Use the same layer rule as
   today: never join walk links across layers except at mapped steps or ramps.
3. **Keep the owner's rules.** Never put a crossing on a motorway, trunk or expressway ramp (B50).
   A crossing you add follows TASK-091's set-back and TASK-094's placement at signals. It is a
   `zebra` or `signal` crossing that TASK-111's walkers and cars already obey; do not add a new
   kind. A `sidewalk=no` side stays without a sidewalk.
4. **Live edits.** The walk graph is derived and recompiled after an edit; your additions must be
   too. A road edited from `sidewalk=separate` to `yes` or `no` gives the same graph as importing
   it that way.
5. **What is left.** A place or garage that still has no walk route to the largest set must be a
   real gap: for example, the far side of the motorway with no mapped way across, or beyond the
   crop. List each one with its reason.
6. **Measure.** In both cities, before and after:
   - the number of connected sets and the anchors outside the largest one;
   - walk links added, by kind and by the rule that added them, and crossings added;
   - `walkFallbacks` and walk legs at 0.15 to 10:00;
   - mean walk distance and time of access and egress legs;
   - walk compile time;
   - completed and gridlocked trips, and zone stops (walkers on new crossings make cars yield).

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested, as long as it is not named
under "Out of scope"; list each such file and why in your report. Stop and ask the lead only
for a file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature. Trip counts may change; that is not a behaviour change
to ask about.

Pre-approved, no need to ask:
- `src/network/walk.ts`, `src/network/crossings.ts` (only where the crossing defaults decide
  that an arm gets a crossing; say what moves), and a new helper module in `src/network/` for
  the joins;
- `src/importers/osm/walk.ts` (which footway, crossing and sidewalk ways and tags are read). If
  the Overpass query changes, bump `queryVersion` in `src/importers/overpass.ts`;
- `src/routing/walk.ts`, only if the router's handling of a place or parking anchor is part of
  the cause;
- `bench/import-probe.ts` (walk connectivity counts);
- `docs/architecture.md` section 5.6;
- tests: a new `tests/network/T60-walk-connectivity.test.ts`, `tests/network/T50-walk*.test.ts`,
  `tests/importers/walk.test.ts`, plus the hash pins and counts that move, each named with its
  reason.

## Out of scope

- `src/sim/**`, including `persons.ts`, `walkers.ts`, `parking.ts` and `connectors.ts`
  (TASK-122 owns them now), and `src/demand/**`.
- `tests/e2e/**` other than a spec of your own (TASK-112's round 2 is changing them).
- The vehicle network: lanes, movements, road surfaces, strips, lots and junction shapes. Car
  routes must not change except through walkers yielding at new crossings.
- `fixtures/osm/**`. Do not download new data; work with the extracts as they are.
- Pedestrian signal phases and zebra priority (TASK-111's rules stay as they are).

## Gates

1. **Rule.** In T60, on synthetic fixtures:
   - a residential street ending on a road tagged `sidewalk=separate` with no mapped footway:
     the sidewalks join, and a place on the far side has a walk route;
   - the same with a mapped footway along that road: the footway is used, with no duplicate
     generated sidewalk beside it;
   - a mapped footway ending within your join distance of a generated sidewalk is joined, and
     one ending on another layer is not;
   - no crossing is added on a motorway, trunk or ramp;
   - a live edit of the sidewalk tag gives the same graph as importing the edited city.
2. **Connectivity.** Every place anchor and parking anchor in both cities is in the largest
   connected set, except the real gaps you list with their reasons. The real gaps hold at most 2%
   of each city's anchors.
3. **Fallbacks.** At 0.15 to 10:00, `walkFallbacks` is under 2% of walk legs in both cities.
   Report the counts; Munich must not rise.
4. **Traffic.** `npm run traffic:quick` against `task/lead-112`:
   - completed at least 98% of its count;
   - gridlocked at most its count plus 10%;
   - stalled heads at most its count.

   Sindelfingen at 0.15 to 10:00: completed at least 97% of `task/lead-112`'s, with the cars that
   now yield at new crossings named. T53 passes.
5. **Cars unchanged.** The vehicle network hash (lanes, movements, connectors) is equal to
   `task/lead-112`'s in both cities. Only the walk graph and the crossings drawn on it change.
6. **Performance.** The walk compile within 10% of `task/lead-112`'s on both cities, and the
   whole compile within 5%. TASK-110's compile once ran 8 times main on Sindelfingen; measure
   warm runs.
7. **Pictures.** Before and after shots, in 2D with the walk layer on, of one Sindelfingen place
   from each group in your trace (for example `p:1407` with `pk:1453`, and `p:1433` with
   `pk:1466`). Read them yourself: new sidewalks lie on the road edge, not across buildings or
   lanes, and new crossings sit where TASK-091 puts them.
8. **Checks.** `npm run check`, `npm run test:city`, `npm run traffic:quick` and
   `npm run test:e2e:smoke` are green. Run e2e with `CITYFLOWS_TEST_PORT=5323`; never use port
   4173 or 5173. Before committing, also run the e2e specs that draw or inspect walkers and
   crossings: `T53`, `T57-person-trips` and `T52`.

## Checks to run

- While iterating: `npm test` (unit tier), the T60 and T50 tests, the import probe on
  Sindelfingen.
- Before committing: `npm run check`, `npm run test:city`, `npm run traffic:quick`,
  `npm run test:e2e:smoke` and the e2e specs named in gate 8.
- Do not run the whole `npm run test:traffic`, the full `npm run test:e2e` or `npm run bench`. The
  lead runs them at merge, and GitHub CI runs the rest after the merge.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5323`), import Sindelfingen, turn the walk
layer on, run to 08:00 and select a person whose egress walk leaves the garage `pk:1453` or
`pk:1466`. The walk follows sidewalks and crossings to the place, not a straight line across
blocks. Describe what you saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the trace table, grouped by cause, and the real gaps left;
- each rule as built, and how many links and crossings it adds per city;
- the counts listed under Measure;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against `task/lead-112`. Write any Markdown or docs as UTF-8.

Commit on `task/123-walk-connectivity`; do not push or merge. The lead reviews only commits.
