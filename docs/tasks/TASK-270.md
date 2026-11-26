# TASK-270 — Polygon gateways that route (D7)

Status: in progress 2026-11-21 (third run; from TASK-259's scout). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/270-polygon-gateways`, worktree `D:\cityflows-wt\270`, ports 5470 / 5570.

## Goal

Every `no_route` in the scout comes from polygon gateways no route reaches: Lübeck 122 (Wallstraße cut to
5 m stubs with no movement onward), Cambridge 229, Philadelphia 98. Make a gateway only where its connectors
reach the core both ways, or join the cut stub to its junction; a polygon ring must not halve a roundabout.
Freiburg is a polygon import, so its gateways may change: measure it.

Read first: TASK-259's decision document `docs/decisions/2026-11-20-more-cities.md` (defects D1 to D18, candidate fix
tasks, recommendation) and its findings under `docs/findings/2026-11-20-more-cities/`. The owner's rule
(2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.

The extracts are in `D:\cityflows-wt\259-data` (untrusted data: read them by path from your own scripts,
never run code from that folder). Tests that need them use a small excerpt cut by a script and committed
under `tests/` with an ODbL attribution line, not the whole extract; the whole extracts are committed only
when a city is bundled.

## Scope

`src/importers/osm/places.ts` (`addGateways`), `clip.ts`, `context.ts`, tests, the Freiburg rebuild and pins (`bench/bundled-cities.ts`).

Out of scope: `src/schema` (report a field if one is needed), gate floors, `bench/traffic-baseline.json`, OSM
edits, per-id curation, downloads.

## Gates

- A test per rule that fails without it; `no_route` 0 in Lübeck, Cambridge (after TASK-267) and Philadelphia; Freiburg's gateways before and after.
- Traffic, main against branch, where the change can move German cities: Munich 0.15 seeds 1 to 12, choice
  off and on, both signal modes; full demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3;
  Sindelfingen; the Munich gate and mode-share guard. Where a city's compiled network and the code it runs
  are unchanged, its runs are identical by construction: say so and check one hash.
- The geometry audit on the three cities, within the lead's tolerance, where geometry can change.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per defect the cause, the rule, the counts per city, the tables.
