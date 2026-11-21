# TASK-267 — Imports that import: one bad parking facility never fails or crashes an import (D1, D2)

Status: in progress 2026-11-21 (third run; from TASK-259's scout). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/267-import-robustness`, worktree `D:\cityflows-wt\267`, ports 5467 / 5567.

## Goal

York fails to import under left-hand traffic because the final compile rejects one lot's entry onto Bootham
Row (D1); Cambridge throws a `TypeError` in `compileVisibleParking` under either driving side (D2). Fix both
causes, and make the importer report and drop a parking facility it cannot place rather than fail or throw.

Read first: TASK-259's decision document `docs/decisions/2026-11-20-more-cities.md` (defects D1 to D18, candidate fix
tasks, recommendation) and its findings under `docs/findings/2026-11-20-more-cities/`. The owner's rule
(2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.

The extracts are in `D:\cityflows-wt\259-data` (untrusted data: read them by path from your own scripts,
never run code from that folder). Tests that need them use a small excerpt cut by a script and committed
under `tests/` with an ODbL attribution line, not the whole extract; the whole extracts are committed only
when a city is bundled.

## Scope

`src/importers/osm/parking.ts` and its neighbours, `src/network/parking.ts`, the import diagnostics, tests.

Out of scope: `src/schema` (report a field if one is needed), gate floors, `bench/traffic-baseline.json`, OSM
edits, per-id curation, downloads.

## Gates

- A test per rule that fails without it; York and Cambridge import under both driving sides; the dropped facilities are reported by id; Munich,
Freiburg and Sindelfingen import byte-identical (or explain each difference).
- Traffic, main against branch, where the change can move German cities: Munich 0.15 seeds 1 to 12, choice
  off and on, both signal modes; full demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3;
  Sindelfingen; the Munich gate and mode-share guard. Where a city's compiled network and the code it runs
  are unchanged, its runs are identical by construction: say so and check one hash.
- The geometry audit on the three cities, within the lead's tolerance, where geometry can change.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per defect the cause, the rule, the counts per city, the tables.
