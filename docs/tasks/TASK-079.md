# TASK-079 — Markings up to the junction, arrows once, offsets kept on curves

Owner: unassigned
Gate: 5 (owner findings B33, B34, B35, round 3, 2026-11-06)
Depends on: TASK-072, TASK-074, TASK-075. Design: `docs/architecture.md` section 11 (TASK-072,
TASK-074 marking clip, TASK-079), section 14 (T32). Read those before the code.

## Goal

From the owner's screenshots in `docs/findings/2026-11-06/`:

- B33 (`1-t-junction-curbs-markings.png`, red dashes): lane dividers stop short of the
  junction on some approaches. Suspect TASK-074's `markingClips` (another road's mouth piece
  within 10 m of its cut can cut into this road's approach) or the taper rule in `drawRoad`
  (no dividers at all on a road with any tapering lane).
- B34 (`7-signal-curbs-arrows.png`, the two circles marked X, on the short road south of
  Munich's Y-junction n:823 down to the signal): lane arrows the owner does not want. Find
  what those arrows are (which node, which movements: u-turns or a service road turning off
  are likely) and apply the section 11 rule.
- B35 (`2-bend-outer-edge.png`, clarified by the owner: "the center line and boundary line not
  being properly drawn at a long curve"): markings are `offsetPolyline` of the lane polyline
  (per-vertex miter, clamped to twice the offset), which drifts on tight, densely sampled
  curves. Build markings per section 11 so they keep their offset.

## In scope

- `src/render/layers/roads.ts`: `drawRoad`'s dividers and centre lines, `markingClips`,
  `approachMarkings` and `drawApproachMarkings`, and a marking-offset helper (it may live in
  `src/geo/polyline.ts` as a new export; do not change `offsetPolyline` itself, lanes use it).
- `src/render/layers/roads.test.ts` and `tests/render/T32-markings.test.ts`.
- A curve fixture in `src/fixtures` if no existing one has a long tight curve.

## Out of scope

- `src/network` (TASK-078 and TASK-080 run there in parallel), `src/render/layers/nodes.ts`,
  `transitions.ts`, `junction-markings.ts`, `scene.ts`, `src/sim`. If a lane polyline itself
  is wrong on a curve (not just the marking drawn from it), report it with the road id
  instead of changing `lanes.ts`.

## T32 (unit)

1. On the grid and Munich, every approach's dividers and centre line reach its `stopM`
   (within 0.5 m) unless the stretch lies inside another road's surface.
2. Arrows: once per lane, 6 to 9 m before `stopM`; none on lanes under 12 m, at nodes whose
   other movements are only u-turns or service-road turns, or where all lanes of the road
   allow the same turns. Name what the owner's X-marked arrows were and show they are gone.
3. On a curve fixture (a two-way street around a tight bend sampled every 1 m or finer) and on
   every Munich road: each divider, centre line and edge line stays within 0.05 m of its
   offset from the lane polyline outside tapers.
4. Marking length outside outlines stays at least 98 percent of main's on every city (the
   TASK-074 audit measure).

## Acceptance

- T32 passes; existing render tests keep their intent.
- Screenshots before and after: the owner's junction 1 approach, the X-marked road, the
  worst curve your measure finds.
- `npm run check` green; `npm run test:e2e -- --grep-invert T16` green on a port of your own.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, what the X-marked arrows were, the curve offset errors before and after,
T32 results, screenshot paths, the final lines of `npm run check`. Commit in your git
worktree; the lead reviews only commits.
