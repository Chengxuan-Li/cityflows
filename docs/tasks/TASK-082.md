# TASK-082 — Corridors first: lanes and surfaces at a constant offset

Owner: unassigned
Gate: 5 (geometry rework, stage 2; owner round 4 G1, backlog B38)
Depends on: TASK-071, TASK-079, TASK-080, TASK-081. Design: `docs/plan.md` "Geometry
rework" (G1, stage 2, the gates), `docs/architecture.md` section 5.1 (lane layout, TASK-071,
TASK-080 tapers) and section 4 (`Road.corridorId`). Read those before the code.

## Goal

On Munich's service roads `r:917`/`r:921` and `r:1059`/`r:1060` (G1, the owner's round 4
screenshot 1) the edges and the centre line are not parallel: each direction offsets its
lanes and surface vertex by vertex (miter clamped to twice the offset) from a centerline that
TASK-066's smoothing sampled every 0.6 m, so on a tight curve the width breathes, offsets fold
back (B38) and the two directions' centre lines part. Build each street's geometry from one
corridor and robust offsets, so every lane, edge and centre line keeps its offset.

## Design

- A corridor is the reference line shared by the roads of one `corridorId` that use one
  source centerline (a two-way street's two directions; the reverse road uses it reversed).
  Roads of a corridor with their own centerlines (a divided pair, a dual carriageway) keep
  their own reference lines but know their partners.
- The reference line is resampled by curvature: points closer than 0.2 m dropped, spacing at
  most 1 m where the radius is under 30 m and at most 5 m on straights, endpoints kept exactly.
  Where an offset needed by the corridor (its outermost edge) exceeds the local radius of
  curvature on the inside of a bend, the reference line is locally eased (bounded, recorded in
  a diagnostic note) instead of letting the offset fold.
- Every lane centerline, lane edge, road edge and the TASK-071/080 tapers are computed by one
  parallel-offset function of the reference line by arc length (the normal at each resampled
  station, no per-vertex miter), so a station s on any lane corresponds to station s on the
  reference line. `parallelOffset` (TASK-079) and `offsetPolyline` are replaced where they
  build network geometry; markings keep using the lane polylines.
- `CRoad.surface` and a new `CRoad.corridorSurface` (the union of the corridor's roads) are
  polygons built from those edges and cleaned with `clipper2-ts` (union, no self-overlap).

## In scope

- `src/network/corridor.ts` (new), `src/network/lanes.ts`, `src/network/compile.ts` (wiring),
  `src/network/types.ts` (additive), `src/geo/polyline.ts` (additive, or a new `src/geo` file).
- `src/render/layers/roads.ts` only where it reads offsets it should now take from the lane
  polylines, `src/render/layers/transitions.ts` likewise.
- Tests: `tests/network/T35-corridors.test.ts`, and every geometry expectation that moves
  (T20, T25, T27, T31 fingerprints, T32, T33, throughput routes), each named with its reason.

## Out of scope

- `src/network/junctions.ts` (stage 3 replaces it), `src/network/movements.ts` (TASK-085 in
  parallel), `src/importers` (TASK-084 in parallel), `src/sim`.

## T35 and the gates

1. On the four cities, by TASK-081's audit: corridor width error under 0.05 m (max, outside
   tapers), centre-line gap under 0.02 m (max), zero lane folds and self-intersections; G1's
   four roads named in the report with before and after.
2. A curvature-resampled reference line keeps every original endpoint and deviates from the
   source centerline by under 0.05 m except where eased (each easing listed).
3. Station correspondence: for every lane, the station at 25, 50 and 75 percent maps to the
   reference line station within 0.1 m.
4. The plan's traffic gate (Munich at 0.15, benchmarks, route audit) and its check gate.

## Acceptance

- T35 passes; the audit before and after tables for all eight measures (nothing else may get
  worse by more than 5 percent, say why where it moves); `npm run geometry-shots` before and
  after for G1 and G2; `npm run check` green; e2e (`--grep-invert T16`) green on a port of your
  own.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what is
not supported, the audit tables, T35 results, the traffic numbers, changed expectations,
image paths, the final lines of `npm run check`. Commit in your git worktree; the lead
reviews only commits.
