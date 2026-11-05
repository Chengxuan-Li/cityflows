# TASK-071 — Lanes that continue through splits, merges and lane drops

Owner: unassigned
Gate: 5 (owner findings 2026-11-05, points 3 and 4)
Depends on: TASK-061, TASK-063, TASK-066, TASK-068. Design: `docs/architecture.md` section
5.1 (TASK-071 lane continuity: continuation nodes, branch slices, end offsets, `taperM`,
`CRoad.startOffsetM` and `endOffsetM`, `CLane.taperStartM` and `taperEndM`), section 11
(TASK-071 markings), section 14 (T25). Read those before the code.

## Goal

The owner sees a 5-lane road that splits into 3 + 2 lanes drawn as 5 lanes, then a thin
pinch at the node, then two roads re-expanding; and lane merges and drops that happen
abruptly at a node with no taper and no markings. The cause: each road's lanes are centred
on its own centerline at the node, so at a split all three lane blocks are centred on one
point. Real roads keep their lanes where they are: the branch lanes leave the trunk from
the positions they had in it and drift apart, and a dropped lane narrows away. Build that
geometry, and draw the markings that go with it.

## In scope

- `src/network/lanes.ts`: lane polylines and `CRoad.surface` from a lateral offset that varies
  along the road (end offsets easing over `taperM`), and the taper lengths on lanes.
- `src/network/continuity.ts` (new): find continuation nodes and compute each branch's slice
  and end offset from the movements, deterministically; called from `compile.ts`.
- `src/network/junctions.ts`: setbacks 0 and no outline at continuation nodes; nothing else.
- `src/network/movements.ts`: only if the straight join of coincident lane ends needs it.
- `src/network/types.ts`, additive: `CRoad.startOffsetM`, `CRoad.endOffsetM`,
  `CLane.taperStartM`, `CLane.taperEndM`. TASK-072 adds `CLane.stopM` to the same file in
  parallel; keep your additions together and do not touch its field.
- `src/render/layers/transitions.ts` (new): tapering lane surfaces and dividers, merge
  chevrons; `src/render/layers/roads.ts` only in `drawRoad`'s divider loop, to skip or bend
  dividers that `transitions.ts` draws; `src/render/scene.ts` to wire the new layer
  (additive). Do not edit `drawApproachMarkings` or `crossingStripes` (TASK-072).
- A seeded fixture `src/fixtures/continuity.ts` (a 5-lane road splitting into 3 + 2, a
  3 + 2 merge into 5, a 3-to-2 narrowing and a 2-to-3 widening) and
  `tests/network/T25-lane-continuity.test.ts`, `tests/render` for the markings.

## Out of scope

- `src/sim` (vehicles already change out of a dropped lane; report any engine problem with
  vehicle, lane and node ids), `src/routing`, `src/importers`, `src/ui`, stop lines and
  crossings (TASK-072), the general junction shape (phase 2).

## T25 (unit)

1. On the continuity fixture, at the split the branch lanes' first points coincide with the
   trunk lanes' last points they connect to (0.01 m), the node has no outline, and no
   cross-section of the combined surface within 10 m of the node is narrower than the
   trunk's lane block (no pinch); likewise for the merge.
2. Each branch's offset reaches its own `lateralOffsetM` at `taperM` with continuous heading
   (1 degree) and no self-intersecting lane polyline.
3. The dropped lane's drawn width falls from full to zero over `taperM` and carries two merge
   chevrons; the added lane grows from zero; dividers next to them converge and diverge.
4. Junctions with any turn or crossing movement are unchanged: their setbacks and outlines
   match main exactly on the grid and Munich (report the count of continuation nodes there).

## Acceptance

- T25 passes; T20, T21 and T24 keep their intent; `npm run route-audit` zero on the four cities.
- Lane lengths at continuation nodes change, so state hashes may change: report the four new
  hashes with completed and failed counts (completed may not fall, failed stays zero) and
  Munich at `--scale 0.15` against main's 2 175.
- Screenshots: the fixture's split and merge, a Munich split or ramp diverge, and a grid
  narrowing, at a zoom where markings show.
- `npm run check` green; `npm run test:e2e` green on a port of your own (T16 may be skipped).

## Commands

`npm run check`, `npm run test:e2e -- --grep-invert T16` (set `CITYFLOWS_TEST_PORT`),
`npm run bench`, `npm run route-audit -- <project or osm file ...>`,
`npm run import-probe -- fixtures/osm/munich-donnersberger.osm 11.525 48.135 11.545 48.148 --scale 0.15`.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the T25 results and continuation-node counts, the hashes and Munich
numbers, the screenshot paths, the final lines of `npm run check`, and anything found on
another surface. Commit your work in a git worktree of this repository; the lead reviews
only commits.
