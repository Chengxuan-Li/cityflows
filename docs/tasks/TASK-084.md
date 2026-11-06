# TASK-084 — Importer: corridors, separated carriageways, relaxation of overlapping roads

Owner: unassigned
Gate: 5 (geometry rework, stage 2; owner round 4)
Depends on: TASK-066, TASK-068, TASK-070, TASK-081. Design: `docs/plan.md` "Geometry rework"
(road corridors, stage 2, the gates, the owner's decisions), `docs/architecture.md` section 4
(`Road.corridorId`) and section 13 (the OSM import steps, smoothing and realignment). Read
those before the code.

## Goal

The owner wants overlapping and malformed OSM geometry fixed at its source, keeping OSM
topology and provenance: the engine must know which roads are carriageways of one street,
opposite one-way carriageways drawn on one centerline (Marsstraße `r:368`/`r:480`) must be
separated into a divided pair, and unrelated same-grade roads that overlap or come too close
must be pushed apart by a bounded, deterministic relaxation whose limit is chosen by
experiment.

## Design

1. `corridorId` on every imported road: the two directions of a two-way way (its
   `streetGroupId`); two opposite one-way roads whose centerlines lie within 1 m of each other
   over at least 80 percent of the shorter one (coincident pair); two opposite one-way roads of
   one name running within 30 degrees of each other at a lateral distance under 25 m over at
   least 50 m (dual carriageway). Deterministic ids (`corridor:` plus the sorted way ids).
2. Separation: each road of a coincident pair moves to its own side so the two lane blocks sit
   side by side with a 0.5 m median, ends included up to the junction zones, eased back over
   the TASK-080 taper length where the pair stops being coincident. Recorded as inferred
   provenance (`separated`).
3. Relaxation (new `src/importers/osm/relax.ts`), after smoothing and realignment: every road
   is a capsule (its centerline, half its lane block plus a 0.3 m clearance). Pairs of
   same-grade roads that share no node, are not one corridor, and overlap outside the junction
   zones of their nodes (within the setback cap plus 5 m of a shared node's position) are
   pushed apart by position-based constraints on their interior points, the lower class moving
   more, with a smoothness term (second differences) and anchors at nodes, in a fixed number of
   iterations in a fixed order, so the result is deterministic. Displacement is capped by a
   parameter `relaxMaxM` (an internal import option; not exposed in the UI yet). Bridges and
   tunnels (different grade) never interact. Recorded as inferred provenance (`relaxed`) with
   the largest displacement per road.
4. Experiments: run Munich and Sindelfingen with `relaxMaxM` at 1, 3, 5, 10 m and unbounded,
   and report for each: remaining unrelated overlap (TASK-081 measure 5), the number of roads
   moved and their mean and largest displacement, the audit's other measures, and the plan's
   traffic gate numbers. Recommend a default with the reason; the lead decides and records it.

## In scope

- `src/importers/osm` (new `corridors.ts`, `relax.ts`, wiring in `index.ts`), import options
  (`relaxMaxM`), `tests/importers` (`T36-corridors-relax.test.ts`, the Munich warning table and
  fixtures that move, each named).

## Out of scope

- `src/network` (TASK-082 and TASK-085 in parallel), `src/sim`, `src/ui` (the import option is
  not exposed yet), the schema (`corridorId` exists).

## T36

1. Corridors: the grid-like OSM fixture's two-way ways, Marsstraße's coincident pair and one
   Munich dual carriageway get the expected `corridorId`s; a re-import gives identical ids.
2. Separation: Marsstraße's two lane blocks no longer overlap (measure 5 at zero there), each
   moved by half its block plus the median, eased at the ends; topology and ids unchanged.
3. Relaxation: on a synthetic pair of unrelated parallel roads overlapping by 2 m, the result
   clears them, moves the lower class more, keeps nodes fixed and curvature bounded; the same
   input gives byte-identical output; `relaxMaxM = 0` changes nothing.
4. The plan's traffic gate on Munich at the recommended value.

## Acceptance

- T36 passes; the experiment table; the audit before and after at the recommended value;
  `npm run geometry-shots` after for G1, G2 and Marsstraße; `npm run import-probe` and
  `npm run route-audit` on the result; `npm run check` green; e2e (`--grep-invert T16`) green
  on a port of your own.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what is
not supported, the corridor counts by kind, the experiment table and the recommended
`relaxMaxM`, T36 results, changed expectations, image paths, the final lines of
`npm run check`. Commit in your git worktree; the lead reviews only commits.
