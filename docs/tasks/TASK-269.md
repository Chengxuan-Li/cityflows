# TASK-269 — Mini-roundabouts and UK zebra zig-zags (D4, D16)

Status: in progress 2026-11-21 (third run; from TASK-259's scout). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/269-mini-roundabouts`, worktree `D:\cityflows-wt\269`, ports 5469 / 5569.

## Goal

Read `highway=mini_roundabout` as a node where entering traffic gives way to traffic already on it, with
circulation in the driving side's sense and its marking (white disc, arrows, give-way lines); 3 in York, 5
in Cambridge, and any in the German cities. Draw UK zebras with zig-zag lines (and Belisha beacons in 3D)
under the `uk` marking theme.

Read first: TASK-259's decision document `docs/decisions/2026-11-20-more-cities.md` (defects D1 to D18, candidate fix
tasks, recommendation) and its findings under `docs/findings/2026-11-20-more-cities/`. The owner's rule
(2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.

The extracts are in `D:\cityflows-wt\259-data` (untrusted data: read them by path from your own scripts,
never run code from that folder). Tests that need them use a small excerpt cut by a script and committed
under `tests/` with an ODbL attribution line, not the whole extract; the whole extracts are committed only
when a city is bundled.

## Scope

the importer's node controls, `src/network/**` control and movement rules for the node, the `src/sim` yield rule only as the node needs, markings (`marking-geometry.ts`, `render3d/markings.ts`), tests.

Out of scope: `src/schema` (report a field if one is needed), gate floors, `bench/traffic-baseline.json`, OSM
edits, per-id curation, downloads.

## Gates

- A test per rule that fails without it; the eight UK nodes yield and are drawn; German mini-roundabouts listed with what changes; zebra zig-zags
under `uk` only.
- Traffic, main against branch, where the change can move German cities: Munich 0.15 seeds 1 to 12, choice
  off and on, both signal modes; full demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3;
  Sindelfingen; the Munich gate and mode-share guard. Where a city's compiled network and the code it runs
  are unchanged, its runs are identical by construction: say so and check one hash.
- The geometry audit on the three cities, within the lead's tolerance, where geometry can change.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per defect the cause, the rule, the counts per city, the tables.
