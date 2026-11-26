# TASK-271 — Reading rules for building passages, conditional access and alternating one-ways (D6, D12, `oneway=faux`)

Status: in progress 2026-11-21 (third run; from TASK-259's scout). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/271-passages-access`, worktree `D:\cityflows-wt\271`, ports 5471 / 5571.

## Goal

(D6) Building passages and covered streets read as tunnels (York 98 roads at layer -1); Freiburg's curation
raises them by hand (`bench/freiburg.ts`). Make it a rule in the importer, and remove that curation
block if the rule reproduces it. (D12) Time-conditional access (`motor_vehicle:conditional`) and
alternating one-ways (`oneway=alternating`), read as the schema allows; a schema field is out of scope, so
report one if needed. (D18) `oneway=faux` is not a one-way.

Read first: TASK-259's decision document `docs/decisions/2026-11-20-more-cities.md` (defects D1 to D18, candidate fix
tasks, recommendation) and its findings under `docs/findings/2026-11-20-more-cities/`. The owner's rule
(2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.

The extracts are in `D:\cityflows-wt\259-data` (untrusted data: read them by path from your own scripts,
never run code from that folder). Tests that need them use a small excerpt cut by a script and committed
under `tests/` with an ODbL attribution line, not the whole extract; the whole extracts are committed only
when a city is bundled.

## Scope

`src/importers/osm/roads.ts` (`osmLayer`), walk layers, access reading, `bench/freiburg.ts` (removing the curation block), tests, the Freiburg rebuild and pins.

Out of scope: `src/schema` (report a field if one is needed), gate floors, `bench/traffic-baseline.json`, OSM
edits, per-id curation, downloads.

## Gates

- A test per rule that fails without it; York's passages at grade; Freiburg's city identical to its curated one where the rule covers it (list
any differences); Munich's changes listed.
- Traffic, main against branch, where the change can move German cities: Munich 0.15 seeds 1 to 12, choice
  off and on, both signal modes; full demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3;
  Sindelfingen; the Munich gate and mode-share guard. Where a city's compiled network and the code it runs
  are unchanged, its runs are identical by construction: say so and check one hash.
- The geometry audit on the three cities, within the lead's tolerance, where geometry can change.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per defect the cause, the rule, the counts per city, the tables.
