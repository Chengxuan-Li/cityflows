# TASK-078 — Junction curbs with a realistic radius, lanes untouched

Owner: unassigned
Gate: 5 (owner finding B32, round 3, 2026-11-06)
Depends on: TASK-063, TASK-074. Design: `docs/architecture.md` section 5.1 (TASK-063,
TASK-074, TASK-078 curbs), section 11, section 14 (T31). Read those before the code.

## Goal

The owner's screenshots `docs/findings/2026-11-06/1-t-junction-curbs-markings.png`,
`6-crossing-curbs.png`, `7-signal-curbs-arrows.png` and `8-y-junction-curbs.png` show in red
the curbs a junction should have: sweeping arcs from one road's edge into the next. Today
the curb is an almost sharp corner, because TASK-074 ties its radius to the setback and set
it to 1 m (a larger radius cut approach lanes and cost Munich 400 trips). Draw the curb as a
separate apron with a realistic radius, so the picture improves while lanes, movements and
the simulation stay exactly as they are.

## In scope

- `src/network/junctions.ts`: `CNode.curbs` per section 5.1 TASK-078, computed after the
  outline; setbacks and outline unchanged.
- `src/network/types.ts`: `CNode.curbs: Vec2[][]`, additively.
- `src/geo/polyline.ts`: helpers, additively.
- `src/render/layers/nodes.ts`: `drawNode` fills the aprons in the junction colour with the
  node area (`drawRoadJoins` belongs to TASK-080; do not edit it).
- `bench/junction-audit.ts`: an apron section (count, radius used, how often shrunk, overlap
  with other roads).
- Tests: `tests/network/T31-curbs.test.ts`.

## Out of scope

- Setbacks, outlines, `SETBACK_CAP_M`, lanes, movements, `continuity.ts`, `lanes.ts` (TASK-080
  runs in parallel there), `src/render/layers/roads.ts` (TASK-079), `src/sim`, `src/routing`,
  `src/importers`, `src/ui`. If the aprons cannot be built without changing setbacks or
  movements, stop and report.

## T31 (unit)

1. On the grid, the town, Sindelfingen and Munich: every apron is a simple polygon outside
   both of its roads' surfaces (0.05 m tolerance), overlapping no other road surface and no
   other apron; its arc is tangent to both edges (turn under 2 degrees at each tangent point).
2. A right-angle residential corner gets a 6 m arc; a residential side street at a secondary
   road gets 6 m (the lower-ranked class); a primary-primary corner 12 m unless shrunk.
3. Unchanged: every node's setbacks and outline, every lane polyline and movement, and the
   four benchmark hashes against main.
4. No apron at continuation nodes, through nodes or gores.

## Acceptance

- T31 passes; T25, T27 and T20 hold unchanged.
- Screenshots after (same camera as the owner's where you can find them; the Y-junction is
  Munich n:823 and the signal below it), and the five Munich junctions with the most aprons.
- Munich at `--scale 0.15` identical to main (the simulation is untouched).
- `npm run check` green; `npm run test:e2e -- --grep-invert T16` green on a port of your own.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the audit's apron section, T31 results, screenshot paths, the final lines
of `npm run check`. Commit in your git worktree; the lead reviews only commits.
