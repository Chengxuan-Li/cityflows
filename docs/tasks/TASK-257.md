# TASK-257 — Unmarked crossings: a marking field on walk links (owner-approved schema change)

Status: in progress 2026-11-20 (third unsupervised run). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/257-unmarked-crossings`, worktree `D:\cityflows-wt\257`, ports 5457 / 5557.

## Goal

OSM tags a crossing's marking (`crossing=unmarked|uncontrolled|marked|zebra|traffic_signals`,
`crossing:markings=no|yes|zebra|lines|...`, `crossing_ref=zebra`), but walk links carry only their kind,
so a `crossing=unmarked` way reaches the city as a crossing and paints as a zebra (24 in Munich; TASK-217's
review in `docs/plan.md`). The owner approved (2026-11-20) a schema field for it. Add an optional marking
field to walk links (for example `marking?: 'zebra' | 'lines' | 'none'`, absent meaning today's
behaviour), read it in the importer from the tags above (ways and, where TASK-248 builds links from
nodes, nodes), and draw what it says: no paint for `none`, the signalised broken lines where the
crossing is signalised (as now), a zebra only where OSM says zebra or marked without a finer tag. Older
projects without the field must open and draw as today.

Also report, without changing it, how the simulation treats walkers and cars at a crossing walk link
that is unmarked and unsignalised (who yields), and whether that matches German rules (no priority for
walkers at an unmarked crossing). A rule change there is a separate task.

## Scope

`src/schema/city.ts`, `city.schema.ts` (and a migration only if one is needed), `docs/architecture.md`
(the walk-link field), `src/importers/osm/walk.ts`, the crossing paint (`src/render/marking-geometry.ts`
`crossingPaint`, `road-paint.ts`, `src/render3d/markings.ts`), the inspector if it shows a walk link's
kind, tests, the Freiburg rebuild and pins, Munich re-pins, close-ups under
`docs/findings/2026-11-20-unmarked-crossings/` (aerial overlay for Freiburg; imagery read-only in
`D:\cityflows-wt\216-data`; download nothing).

Out of scope: walkers' and cars' crossing rules in `src/sim/**`, signal control, the audit, gate floors,
`bench/traffic-baseline.json`, OSM edits, per-id curation.

## Gates

- Tests: the tag reading (each tag form), an old project opening unchanged, the paint per marking; each
  fails without the change. Counts per city of crossings by marking, before and after.
- Close-ups before and after in 2D and 3D, Freiburg samples against the imagery.
- Drawing and data only: identical state hashes (Munich 0.15 seed 1 four configurations, Freiburg's gate,
  Sindelfingen, both full demands). If the field moves traffic, find why and keep it from doing so.
- Frame budgets on the Freiburg landing spec.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the field, the tag reading, counts per city, the simulation's current
yield rule at unmarked crossings, hashes, budgets.
