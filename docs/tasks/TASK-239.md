# TASK-239 — Crossings mapped only as OSM nodes get walk links and paint (TASK-217, TASK-224 D1)

Status: done 2026-11-20 (landed as TASK-248). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/239-node-crossings`, worktree `D:\cityflows-wt\239`, ports 5439 / 5539.

## Goal

TASK-217 (review in `docs/plan.md`) paints zebras only where OSM maps a crossing way; crossings mapped
only as a `highway=crossing` node on a road (with `crossing=zebra`, `crossing_ref=zebra`,
`crossing=marked`, `traffic_signals`) have no walk link and are not drawn: the zebras at `n:211` and
`n:1139` in TASK-224's Hbf box (2 of 13 mapped zebras matched on main). TASK-217's full version built
them and found that allocating their ids last keeps Freiburg's tram timetable and its gate within
budget (79 s then).

1. Census per city: crossing nodes on roads with no crossing way through them, by kind.
2. Give each a walk link across the carriageway at the node (joining the footways or sidewalks either
   side, as the existing crossing links do), its crossing paint by kind (zebra, signal lines,
   unmarked unpainted), and the stop line and pedestrian priority the existing crossing rules give.
   Allocate new ids after every existing one so no existing id moves.
3. Measure; walkers will use the new links, so traffic moves; the merge rule judges.

## Scope

The importer's crossing handling (`src/importers/osm/`), `src/network/walk.ts` and `crossings.ts` where
links and crossings are built, `src/render/marking-geometry.ts` only if paint needs a hook, the
Freiburg rebuild and pins, tests, close-ups under `docs/findings/2026-11-20-node-crossings/` (aerial
overlay; imagery read-only in `D:\cityflows-wt\216-data`; download nothing).

Out of scope: `split.ts` and `junctions.ts` (TASK-234), `corridors.ts` (TASK-238),
`rail-crossings.ts` (TASK-237), `src/schema` (no new field: `crossing=unmarked` on ways stays an owner
decision), gate floors, `bench/traffic-baseline.json`.

## Gates

- A test per rule that fails without it; the census before and after; D1's matched zebras in the box.
- The audit on the three cities: no worsening beyond the lead's audit tolerance (decisions log,
  2026-11-20).
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both modes; full demand
  both modes (references: the latest full-demand figures in `docs/plan.md`; TASK-235 moves them);
  Freiburg's gate and seeds 1 to 3; Sindelfingen; the Munich gate and mode-share guard.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the census, the rules, the audit, the traffic tables.
