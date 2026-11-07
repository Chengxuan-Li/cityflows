# TASK-095 — Roads that approach a node side by side are drawn attached, with a divider line (B54, B55)

Owner: unassigned
Gate: 5 (owner findings round 6)
Depends on: TASK-089 (split converging ends, shift profiles), TASK-092 (corners, noses),
TASK-093 (corridor second ways, `MEDIAN_VOID_M`), TASK-090 (tiers). Design: `docs/plan.md`
backlog B54, B55 and the screenshots in `docs/findings/2026-11-07-round6/`;
`docs/architecture.md` section 5.1 (TASK-083, TASK-089, TASK-092, TASK-093). Read those
before the code.

## Goal

The owner (round 6):

- **B54, one street's carriageways (Munich).**
  - At `n:138`, Arnulfstraße's carriageways run apart with irregular voids, both west
    (`r:386`/`r:716`) and east (`r:715`/`r:958`). The owner: "merge both segments into paired
    road with center divider marker lines".
  - At `n:638` (screenshot 2; the owner called it n:168), east of the Donnersberger bridge,
    `r:654` (5 lanes in) and `r:680` (2 lanes out, one corridor) open a lens as they leave the
    node. The owner drew them attached, with a divider between them, up to where they part.
  - TASK-093 closed only voids narrower than 3 m (`MEDIAN_VOID_M`). The owner now wants one
    street's carriageways attached wherever they run side by side.
- **B55, different roads at a small angle.** The owner: "we still need to make the '2 roads
  approach an intersection at small angle diff or parallel' handling".
  - In Sindelfingen at `n:841` and `n:68`, two different streets approach the node nearly
    parallel. Their surfaces overlap near the node and part farther out.
  - Their curbs, drawn in red in both screenshots, should sweep as TASK-092's corners do.

## Design

1. **Attach one street's carriageways (B54).** Two carriageways of one corridor running
   within 20 degrees of each other are drawn side by side at the 0.5 m median, with a divider
   line, wherever they run that close. They ease apart over the TASK-080 taper only where:
   - the source lines part by more than 20 degrees;
   - the gap would exceed a width you set, starting at 15 m and named in the report; or
   - a node or another road lies between them.

   This replaces the 3 m threshold. Implement it where TASK-093 put `MEDIAN_VOID_M`, whether
   that is the importer or the network shift profiles. The divider is TASK-089's touching-edge
   marking: a solid double line between opposite directions, a solid single line between the
   same direction.
2. **Attach different roads at a small angle (B55).** Two road ends at one node within
   20 degrees of each other whose lane surfaces overlap within 40 m of the node, or come
   closer than the 0.5 m median:
   - Each keeps its own lanes.
   - They are held side by side up to the node, using TASK-089's split ends and shift
     profiles. This now applies to any such pair, not only one corridor's.
   - They ease back to their own lines where the source lines part.
   - The gore between them gets TASK-092's rounded nose.
   - A solid edge line is drawn between them while they touch.
   - Opposite directions keep the side that matches driving on the right. If the pair would
     have to cross over, leave it as drawn and name it.
3. **Network.** Movements, ids, places and connectors stay as imported. Connector positions
   along their lanes may move; report the largest move.
4. **Measure.**
   - Extend `bench/geometry-audit.ts` measure 9 to report, for every pair of road ends
     within 20 degrees at a node, the overlap area within 40 m of the node.
   - Add one more measure: void area between one corridor's carriageways, where the gap is
     wider than the median and narrower than your gap limit.
   - Give the baselines.

## In scope

`src/importers/osm/corridors.ts`, `realign.ts`, `src/network/continuity.ts`, `corridor.ts`,
`lanes.ts`, `compile.ts`, `types.ts`, `junctions.ts`, `src/render/layers/nodes.ts` and
`roads.ts` (the divider marking only), `bench/geometry-audit.ts` (the measures),
`bench/geometry-shots.ts` (cameras; the lead added `R6-n138`, `R6-n638`,
`R6-sindelfingen-n841` and `R6-sindelfingen-n68`), `tests/network` and `tests/importers`
(T39 extended, or a new T43), and the expectations that move, each named.

## Out of scope

`src/sim`, the stop and crossing rules (TASK-094), the schema.

## Gates

1. **Owner nodes.**
   - `n:138` (both sides) and `n:638`: no void between the carriageways from the node to
     where they part, and a divider line along them (shots).
   - Sindelfingen `n:841` and `n:68`: no overlap, attached side by side, a rounded gore and
     curbs (shots).
2. **Every city.**
   - On all four cities, overlap within 40 m of a node is zero for pairs within 20 degrees,
     except named ones with a reason each.
   - Corridor voids under your gap limit: zero.
   - List the pairs changed per city.
3. **No regressions.**
   - Audit (TASK-090 tolerances): bulge, self-crossings, corner sharpness (measure 10), G2,
     and T39.5 wobble.
   - `npm run test:traffic` passes the gate against `bench/traffic-baseline.json` (4 017
     completed, 41 gridlocked). Use `traffic:quick` while iterating.
   - Benchmark hashes unchanged.
4. `npm run check` and `npm run test:city` green; `test:e2e:smoke` green on port 5289.

## Acceptance

All gates. Give `npm run geometry-shots -- <dir> --only ...` before and after for the R6
cameras, B41-n104, T93-n967, T93-n721-n328 and G2-n774. Read every image yourself, zoomed in
on the divider lines and gores. Numeric gates pass easily while edges wobble.

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- the rules and thresholds as implemented;
- the measures before and after;
- the pairs changed;
- named exceptions;
- traffic numbers;
- image paths;
- the final lines of `npm run check`.

Commit in your git worktree; the lead reviews only commits.
