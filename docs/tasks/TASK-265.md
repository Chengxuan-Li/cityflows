# TASK-265 — Zebras where OSM maps them: crossing placement from the crossing node (`n:211`)

Status: in progress 2026-11-21 (third run). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/265-crossing-placement`, worktree `D:\cityflows-wt\265`, ports 5465 / 5565.

## Goal

TASK-256 found (review in `docs/plan.md`) that `n:211`'s zebra is painted 4.2 m along the street from its
OSM crossing node. The node sits 3.5 to 3.7 m from the road end, on the zebra in the imagery. The band
follows TASK-091's curb rule: it starts 1 m past the farthest curb-return tangent, which is 5.4 to 5.6 m
because it counts the other half's curb. TASK-140 then moves the walk link onto the band, so walkers,
their conflict zone and the stop line all follow the band. Moving only the paint would split the zebra
from the crossing.

Place a crossing's band, walk link, conflict zone and stop line at the mapped crossing node, or at the
crossing way where it meets the road, when OSM maps one within reach of the road end. Keep the band
clear of the drawn curb returns: say what happens when the node lies inside them, and pick a rule with
evidence. Use the curb rule only where OSM maps no crossing. TASK-217's move did this and failed the merge
rule (Freiburg 87 s); TASK-256 lists 5 arms it would shift (Freiburg `n:7`, `n:8`, `n:211`, `n:254`,
Munich `n:6`). Measure why it moved traffic and keep the move to what OSM maps.

## Scope

`src/network/crossings.ts`, `stops.ts`, and the walk-link placement (TASK-140's code), the crossing paint
where it follows, tests, the Freiburg rebuild and pins, Munich re-pins, close-ups under
`docs/findings/2026-11-21-crossing-placement/` (aerial overlay; imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: walkers' and cars' yield rules in `src/sim/**`, `src/schema`, the audit, gate floors,
`bench/traffic-baseline.json`, OSM edits, per-id curation. TASK-257 (the walk-link marking field) runs in
parallel in the importer and paint. Keep to placement.

## Gates

- A test that fails without the rule; the crossings moved per city with distances before and after;
  `n:211` and a sample against the imagery.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full
  demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; the Munich gate and
  mode-share guard.
- The geometry audit on the three cities, within the lead's tolerance.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the rule, the counts and distances, the imagery checks, the audit, the
traffic tables.
