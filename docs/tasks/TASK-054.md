# TASK-054 — Signal junctions on import

Owner: unassigned
Gate: 5 (owner backlog B15)
Depends on: TASK-048, TASK-049

## Goal

On real extracts some points where a road is merely split come out as signalized junctions.
`src/importers/osm/index.ts` seeds the junction set with every node tagged
`highway=traffic_signals` (`junctions(ways, controlled)` in `split.ts`), and every such node
gets a generated program (`addSignal` in `controls.ts`), whether or not streets meet there.
Two OSM habits produce false junctions: a signal node in the middle of a way (a pedestrian
signal, or the signal of one carriageway mapped on its approach node a few metres before the
crossing), and a crossing mapped as a small cluster whose control nodes TASK-048's
consolidation keeps apart on purpose. The result is a degree-two node with lights and a
two-phase program on a plain stretch of road.

## In scope

- `src/importers/osm/index.ts` (the junction seed list and `addNode` control handling only),
  `src/importers/osm/split.ts`, `src/importers/osm/controls.ts`,
  `src/importers/signal-program.ts` if the generator needs a change.
- Rule to implement: a node is a signal junction only where roads from at least two
  different streets meet (degree three or more after the short-section merge, or two roads
  that are not sections of one street). A `traffic_signals` node that does not qualify moves
  its control to the junction it leads to when one lies within the consolidation distance
  (60 m along the road, same as TASK-048's cluster rule) and is then merged like any plain
  split; otherwise it becomes an uncontrolled node, kept as a split only if something else
  needs it. Stop and give-way nodes follow the same rule for where their control lands.
- Record what moved as an `inferred` provenance entry so the diagnostics step can show it.
- `tests/importers`: a synthetic way with a mid-way signal node (no junction results, no
  program), a crossing with signals on the approach nodes of each carriageway (one junction,
  one program, the approach nodes merged away), and the Munich assertions below.

## Out of scope

- `src/importers/osm/roads.ts` (TASK-056 edits it in parallel), the renderer, the
  simulation, pedestrian crossing visuals, roundabouts.

## Acceptance

- On the Munich reference extract: no signalized node of degree two; every signal node has
  road ends from at least two streets; the signal count (24 after TASK-048) reported before
  and after with the OSM ids of nodes that lost or gained a signal; the probe keeps zero
  failed trips and every connector pair routable; `road_too_short` and `dead_end` not higher
  than the TASK-048 column.
- The downtown, highway, suburb and Sindelfingen fixtures import with the same or fewer
  warnings; the gate5-controls Sindelfingen scenario and demo D pass.
- `npm run check` green; `npm run test:e2e` green.

## Commands

`npm run check`, `npm run test:e2e`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148`

## Deliverable

PR with the rule, the tests and the before and after signal table.
