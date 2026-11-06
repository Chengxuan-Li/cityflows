# TASK-083 — Junction polygons, osm2streets-style: through roads keep their line

Owner: unassigned
Gate: 5 (geometry rework, stage 3; owner round 4 G2, round 3 B32, B39 drawing)
Depends on: TASK-082 (corridors), TASK-084, TASK-085, TASK-081 (the audit). Design:
`docs/plan.md` "Geometry rework" (G2, stage 3, the gates, the owner's decisions),
`docs/architecture.md` sections 4 (`Road.corridorId`), 5.1 (TASK-063, TASK-074, TASK-078,
TASK-082 corridors) and 5.2. Read those before the code.

## Goal

On Landsberger Straße (G2, the owner's round 4 screenshot 2: `n:774` with `r:777`, and `n:719`
east of it) the through road bulges into lobes either side of the side road and its lanes dip
toward the node: today each road end is set back by SUMO-style curb intersections, the outline
is stitched from those ends plus curb arcs, and movements are Bézier curves between lane ends,
so nothing keeps a continuing road on its own line. Rebuild junctions the way osm2streets
does, on TASK-082's corridors: the junction is the polygon between the road ends where their
corridors meet, a through road keeps its alignment and its far edge, and turning paths run
between the cut boundaries.

## Design

1. Corridor ends. Each road end at a node is a corridor end (TASK-082's surfaces). Roads of one
   `corridorId` approaching the node together (a divided pair, a dual carriageway) form one
   approach with a median.
2. Cuts. Walking the approaches in angular order, each approach is cut square to its own
   reference line at the farthest point where its corridor edges meet a neighbour's (as
   osm2streets trims), plus the tangent length of a curb arc of class radius (TASK-078's 6, 9,
   12 m by the lower-ranked road). The 10 m cap stays as a storage guard: where a cut would go
   further, the cap holds and the overlap beyond it is covered by the polygon (the TASK-063
   gore), as today.
3. Through roads. At a node where two approaches are within 30 degrees of opposite and of the
   highest class there, they are a through road: they are cut only as far as the widest side
   approach's mouth (its corridor width plus the curb tangents) needs, their through lanes'
   movements follow the through road's reference line across the node (no Bézier toward the
   node point), and the polygon's edge on each side of the through road where no approach
   joins is the through road's own edge, straight across.
4. The polygon is the union, with `clipper2-ts`, of the cut corridor ends' mouths, the curb
   arcs between neighbouring approaches, and every movement surface; it must be simple.
   `CNode.outline` carries it; `CNode.curbs` is removed (the curbs are part of the outline).
   Continuation nodes (TASK-071/080) and through nodes are unchanged.
5. Turning paths: movements between cut boundaries as today (TASK-085's added movements
   included), except through movements on a through road as in 3.
6. The TASK-063/074 outline and TASK-078 apron code and their tests are deleted once this
   passes the gates (owner); their assertions that still matter move into T38.

## In scope

- `src/network/junctions.ts` (rewritten), the movement geometry in `src/network/movements.ts`
  (through-road movements), `src/network/types.ts`, `src/network/compile.ts` wiring,
  `src/geo` helpers, `src/render/layers/nodes.ts` (`drawNode`), `src/importers/osm/realign.ts`
  only where it calls the old setback function.
- Tests: `tests/network/T38-junction-polygons.test.ts`; T20, T27, T31 rewritten or removed with
  the code they test (name what moved where); every expectation that moves, with its reason.

## Out of scope

- Corridors and lanes (TASK-082's, merged), `src/importers` beyond `realign.ts`'s call,
  `src/sim` rules, `src/render/layers/roads.ts` beyond following the new outline.

## T38 and the gates

1. G2: the through road at `n:774` and `n:719` stays within 0.1 m of its alignment across the
   junction (TASK-081's through-road measure, far and near edges), its lanes dip under 0.1 m,
   and the bulge measure is zero there.
2. On the four cities: junction polygons simple, every movement surface inside its polygon
   (0.1 m), every cut on the polygon, bulge total at most a quarter of the stage 2 value, no
   unrelated overlap introduced.
3. Curbs: every concave corner between neighbouring approaches is a tangent arc of its class
   radius or the largest that fits.
4. Storage: no approach lane shorter by more than 2 m than after stage 2.
5. The plan's traffic gate and check gate, against main after stage 2.

## Acceptance

- T38 passes; the audit before and after tables for all eight measures; `npm run geometry-shots`
  before and after for every case (G2, round 3's junctions, B39); `npm run check` green; e2e
  (`--grep-invert T16`) green on a port of your own.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what is
not supported, the audit tables, T38 results, the traffic numbers, what was deleted, changed
expectations, image paths, the final lines of `npm run check`. Commit in your git worktree; the
lead reviews only commits.
