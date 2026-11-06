# TASK-087 — Importer: no overlapping carriageways near junctions (B41, B42)

Owner: unassigned
Gate: 5 (geometry rework follow-up; owner, 2026-11-06: "You have not fixed the overlapping
lanes at close to junction")
Depends on: TASK-084 (corridors, separation, relaxation), TASK-083 (junction polygons, the
realignment grouping by corridor). Design: `docs/plan.md` "Geometry rework" and the review log
entries for TASK-084 and TASK-083, backlog B41 and B42; `docs/architecture.md` sections 4, 5.1
(TASK-082, TASK-083) and 13 (import steps). Read those before the code.

## Goal

Lanes of different roads must not overlap or cross outside the junction polygons. On current
main they still do near junctions where the source draws the two carriageways of one street
closer than their lane blocks: Landsberger Straße converging on `n:104`, `n:324`, `n:721`,
`n:774`; Arnulfstraße on `n:446` and the signal `n:949`. They also cross along road bodies:
Landsberger `r:1277`/`r:1362`, Arnulfstraße `r:1354`/`r:447`, Marsstraße `r:1372`/`r:845`
30 m from `n:823`, the same-direction coincident Landsberger pair `r:729`/`r:984`, and
Sindelfingen `r:574`/`r:971`, `r:499`/`r:876`, `r:650`/`r:80` (all listed in
`tests/network/junction-audit.ts`). Fix them at the source, as TASK-084 did for coincident
pairs. Also B42: at `n:138` the realignment now bends Donnersbergerstraße within 25 m of the
node (R3-6 shot).

## Design

1. Measure first: add to `bench/geometry-audit.ts` (additive) a ninth measure, lane overlap:
   the area where lane surfaces of two different roads overlap outside every node outline,
   for all pairs except a movement's own from and to roads, reported per pair with the
   distance to the nearest node, same-corridor pairs included. Record the baseline.
2. Close carriageways: where two roads of one corridor (dual carriageway or divided pair, any
   direction) run closer than half of each lane block plus the 0.5 m median, push them apart
   laterally to that clearance, each by half, eased over the TASK-080 taper length where they
   part and kept up to the node where they meet it (the ends then meet the node side by side,
   as a separated coincident pair does). Node positions and ids fixed; provenance
   `separated`. Extend corridor detection where a pair the owner would call one street is not
   one corridor (same-direction coincident `r:729`/`r:984`: decide, say why).
3. Road-body crossings of carriageways of one street (the list above): find why each crosses
   (realignment bending one back, zero offsets, source data) and fix it in the import step
   responsible; a crossing of two unrelated streets at one grade without a node stays a
   named data error.
4. B42: at `n:138`, decide which arm the acute-approach realignment should bend now that
   Arnulfstraße's carriageways are one arm, so Donnersbergerstraße is not bent within 25 m of
   the node unless it is the acute one; check every other node where the TASK-083 grouping
   changed which arm is bent (list them before and after).

## In scope

- `src/importers/osm/**` (`corridors.ts`, `relax.ts`, `realign.ts`, `index.ts`),
  `bench/geometry-audit.ts` (additive measure), `tests/importers` (T39), the lists in
  `tests/network/junction-audit.ts`, and every expectation that moves, each named with its
  reason.

## Out of scope

- `src/network` (TASK-089 follows), `src/render` (TASK-088 in parallel), `src/sim`, schema.

## T39 and the gates

1. Lane overlap (measure 9) outside node outlines between roads of one corridor: zero on the
   four cities; between unrelated roads: no worse than main, each remaining pair named.
2. `importedRoadBodyOverlaps`: every carriageway pair of one street removed (no longer
   crossing); what remains is named as a data error with a reason.
3. The named nodes (`n:104`, `n:324`, `n:721`, `n:774`, `n:446`, `n:949`): no two lanes cross
   between the node and 40 m out; G2 keeps TASK-083's result (through within 0.1 m, bulge 0).
4. B42: `n:138` before and after, and the list of nodes whose bent arm changed.
5. Traffic: Munich at 0.15 at least 3 497 completed (90 percent of the stage 1 baseline
   3 886) and at least 90 percent of main, gridlocked at most 1.5 times main, stalledHeads 0,
   no non-gridlocked failures; benchmarks complete; `npm run route-audit` zero.

## Acceptance

- T39 passes; the audit before and after for all nine measures; `npm run geometry-shots`
  before and after; `npm run check` green; e2e (`--grep-invert T16`) green on a port of your
  own.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what is
not supported, measure 9 before and after per city and per named pair, T39 results, the
traffic numbers, changed expectations, image paths, the final lines of `npm run check`.
Commit in your git worktree; the lead reviews only commits.
