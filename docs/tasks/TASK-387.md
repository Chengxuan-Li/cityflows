# TASK-387 — Freiburg warnings F1 and F2: U-turns at dead-end lot aisles; lanes into a group's inner road

Status: started 2026-11-28. Started by the lead in the 9 h autonomous run (owner 2026-11-28: "Take all suggestions"). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-207)

TASK-207 held two importer changes for the owner (its branch is gone; rebuild them from the description):
- **F1.** A car at the end of a dead-end lot aisle has no way back. Letting it turn there cut dead ends by 20 in
  Freiburg, 17 in Munich, 45 in Sindelfingen. It moved 13 Munich and 13 Sindelfingen pins and two TASK-164 lot-exit
  tests.
- **F2.** Lane mapping into a junction group's inner road is wrong at `r:1148#4`. The fix shifted later road ids by 2,
  which then halved Freiburg's trams because departure offsets came from a hash of the id. TASK-214 since salts the
  offsets (`src/network/trains.ts` `buildTimetable`), so an id change alone should no longer thin the service.

## Goal

The owner accepted both (2026-11-28). Implement F1 and F2 by rule, rebuild the bundled cities and re-pin.
- F1 follows the lot's aisle geometry (a turn where the aisle end has room for the design car, else the existing
  behaviour); no per-id curation.
- F2: check first that the tram service count and headways do not depend on road ids (a test that renumbers roads and
  compares the timetable apart from offsets); then fix the mapping.

## Scope

`src/importers/**` (lots, lane mapping), `src/network/**` as needed, `src/sim/parking*` if the turn needs it, tests,
bundled-city rebuilds and re-pins. Out of scope: OSM edits, per-id curation, gate floors, `bench/traffic-baseline.json`.

## Gates

- Warning codes before and after for every bundled city (`dead_end`, `parking_no_exit`, `lot_stalls_unreachable`).
- Freiburg tram departures per route unchanged in count; `r:1148#4` lanes correct.
- Traffic merge rule against main (Munich within 3%, full demand within 2% on the mean of seeds 1–5, Freiburg within
  5 s, drain, every showcase passes).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
