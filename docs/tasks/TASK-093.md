# TASK-093 — One street's carriageways: overlap at n:967, median voids, lane-to-lane continuation (B49, B45, B47)

Owner: unassigned
Gate: 5 (owner findings round 5)
Depends on: TASK-084, TASK-087, TASK-089 (corridors, separation, split converging ends),
TASK-071 (continuation lanes), TASK-090 (test tiers). Design: `docs/plan.md` backlog B45,
B47, B49 and the screenshots in `docs/findings/2026-11-06-round5/` (1, 3, 5);
`docs/architecture.md` sections 4 and 5.1 (TASK-082, TASK-089). Read those before the code.

## Goal

1. **B49, `n:967`** (5, signal). Landsberger Straße's two carriageways east of the node still
   overlap into the junction: `r:961` (incoming, secondary, 3 lanes, no `corridorId`) and
   `r:1276` (outgoing, 2 lanes, corridor `300081440+1421494354+1421494357`). The owner drew
   them parallel, each with its own lanes and a median line, separated up to the junction, as
   at Landsberger Straße in (1). Find why TASK-087/TASK-089 missed this pair (corridor
   detection, the class differing from its partner, angle, or a third way in the corridor),
   and fix it in that step.
2. **B45, `n:721` to `n:328`** (1; pairs `r:724`/`r:1279` and `r:1280`/`r:1334`). Traffic is
   fine, but irregular voids remain between the carriageways. The owner's suggestion, not a
   hard requirement: where OSM draws one street as two or more lines (one name or ref, one
   corridor), draw them parallel and attached, without irregular median gaps.
   - Implement: close median voids narrower than 3 m by pulling both carriageways toward
     their shared corridor line until they meet the 0.5 m median. Ease over the TASK-080
     taper where the source median widens past 3 m, and leave wider medians as drawn.
   - Report the threshold. The owner may change it.
3. **B47, `n:212` and `n:55`** (3). On Westendstraße, a one-way, one-lane road (`r:213` into
   `n:212`, `r:57` out of `n:55`) continues as a two-way road (`r:1172`/`r:1173`,
   `r:192`/`r:193`). The geometry aligns the centre lines. It should instead align the
   one-way lane with the lane of the same travel direction, so a car drives straight through.
   - Apply this to every continuation where the lane count or the directions change across a
     two-arm (or through) node.
   - Ease over the TASK-080 taper on the road with fewer lanes.

## In scope

`src/importers/osm/corridors.ts`, `realign.ts`, `relax.ts` (if needed),
`src/network/continuity.ts`, `corridor.ts`, `lanes.ts`, `compile.ts`, `types.ts`,
`bench/geometry-shots.ts` (cameras), `tests/importers` (T39 extended), `tests/network`
(T35 or a new T43), and the expectations that move, each named.

## Out of scope

`src/network/junctions.ts` and `src/render/layers/nodes.ts` (TASK-092 is in parallel; if
your fix needs a polygon change, stop and say so), `src/render/layers/roads.ts` (TASK-091),
`src/sim`.

## Gates

1. **`n:967`.** Measure 9 for `r:961`/`r:1276` is zero, the two carriageways meet the node
   side by side with the median line, and no lanes cross within 40 m (shot).
2. **Median voids.**
   - Between `n:721` and `n:328`: none narrower than 3 m. List the corridor pairs changed per
     city.
   - Network unchanged: movements, places and connectors equal to main's on all four cities.
3. **Lane-to-lane continuation.** At `n:212` and `n:55`, the one-way lane's centreline
   continues the matching lane of the two-way road within 0.1 m at the node, with heading
   continuous. List every such continuation per city before and after.
4. **No regressions.**
   - Audit (TASK-090 tolerances): bulge, self-crossings, measure 9 (same-corridor pairs stay
     zero), G2, and T39.5 wobble.
   - `npm run test:traffic` passes the gate. Use `traffic:quick` while iterating.
   - Benchmark hashes unchanged.
5. `npm run check` and `npm run test:city` green; `test:e2e:smoke` green on port 5283.

## Acceptance

All gates. Give `npm run geometry-shots -- <dir> --only ...` before and after, with new
cameras for `n:967`, `n:721`–`n:328` (Landsberger), `n:212` and `n:55`. Read the images
yourself.

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- the cause found at `n:967`;
- the threshold and the pairs closed;
- the continuations aligned;
- the audit and traffic numbers;
- image paths;
- the final lines of `npm run check`.

Commit in your git worktree; the lead reviews only commits.
