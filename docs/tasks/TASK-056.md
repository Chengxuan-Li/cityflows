# TASK-056 — Draw order by level

Owner: unassigned
Gate: 5 (owner backlog B19)
Depends on: TASK-047

## Goal

Roads that are on top in reality draw on top, and where the level is unknown the order is
at least consistent. `Road.layer` and `Node.layer` exist (from OSM `layer`), and the scene
already draws one grade group per layer value (`src/render/scene.ts`, `grades`), but the
groups are added to the map in first-seen order rather than by level, and the importer fills
`layer` only from the `layer` tag (`src/importers/osm/roads.ts`, `addNode` in `index.ts`),
so a bridge mapped as `bridge=yes` without `layer` draws at ground level and may lose to the
street it crosses.

## In scope

- `src/importers/osm/roads.ts` (the `layer` field) and `src/importers/osm/index.ts`
  (`addNode`'s layer computation only; TASK-054 edits the junction seed list in the same
  file in parallel, so keep the change local): `layer` is the integer `layer` tag when
  present, otherwise +1 for `bridge` other than `no`, −1 for `tunnel` other than `no` or
  `covered=yes`, else 0. A node shared by ways of different layers takes the layer of the
  way it is a junction for; a bridge's end nodes stay at ground level.
- `src/render/scene.ts`, `src/render/layers/roads.ts`, `src/render/layers/nodes.ts`: grade
  groups ordered ascending by layer, with the layer stored on the group; within a grade,
  roads in compiled index order (already deterministic). A road whose layer is above a road
  it crosses draws over its junction surface and markings too. Vehicles already draw per
  grade; keep that.
- `tests/importers/layers.test.ts` (new): bridge without `layer` gets 1, tunnel gets −1,
  explicit `layer=2` wins, a ground street under a bridge stays 0.
- `tests/render`: the ordering as a pure function (extract it) tested with layers seen in
  the order 0, 1, −1.

## Out of scope

- Junction geometry and markings (B16), the compiler, routing, the simulation, the
  importer's junction logic (TASK-054).

## Acceptance

- On the Munich extract: the Donnersbergerbrücke carriageways have `layer` 1 or more and
  draw over the streets and the railway crossing below; the count of roads per layer is
  reported in the PR; a screenshot of the bridge area at detail zoom before and after.
- The grid, town and Station fixtures look unchanged (all at layer 0); T16 numbers within
  noise of the plan's table.
- `npm run check` green; `npm run test:e2e` green.

## Commands

`npm run check`, `npm run test:e2e`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148`

## Deliverable

PR with the importer rule, the ordering, the tests and the two screenshots.
