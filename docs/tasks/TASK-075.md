# TASK-075 — Lane markings continue through junctions without signals

Owner: unassigned
Gate: 5 (owner finding 2026-11-05, round 2, point 1)
Depends on: TASK-061, TASK-063, TASK-071, TASK-072. Design: `docs/architecture.md` section 11
(junction guide markings, TASK-075), section 14 (T28). Read those before the code.

## Goal

At a junction without traffic lights the lane markings stop at the road end and the junction
is a blank patch, so a priority road reads as broken where a side street joins. Real streets
carry dashed guide lines through such junctions: the lane dividers of the priority road, its
centre line, and its edge line across the side street's mouth. Draw them.

## In scope

- `src/render/layers/junction-markings.ts` (new): the guide lines of section 11 for every
  node whose control is not `signal`, that has an outline (continuation nodes already
  continue their dividers, TASK-071), built from compiled geometry only (movement polylines,
  lane widths, road surfaces, node outline, movement priority).
- `src/render/scene.ts`: wire the layer above node areas and below places and vehicles, with
  the same zoom fade as lane markings and rebuilt on the same `compiled.version` change.
- `src/render/style.ts`: the dash pattern and line widths, additively.
- Tests: `tests/render/T28-junction-markings.test.ts`.

## Out of scope

- `src/render/layers/roads.ts`, `src/render/layers/nodes.ts`, `src/network` (TASK-074 runs in
  parallel there and may move outlines and setbacks; build only from the compiled fields, so
  your markings follow whatever geometry it produces), `src/sim`, `src/ui`.
- Signalized junctions, roundabouts, markings painted on the junction for turns.

## T28 (unit)

1. A T-junction where a yield side street joins a two-way priority road: the centre line and
   the far-side lane dividers continue dashed through the junction, the near-side edge line
   continues dashed across the side street's mouth, and the side street gets nothing inside
   the junction.
2. A four-way all-way stop or equal-priority uncontrolled crossing: no guide lines (no road
   has priority over the other), and a signalized four-way: none either.
3. Every dash lies inside the node outline unioned with the road surfaces it joins (0.1 m
   tolerance), and no guide line crosses another guide line.
4. A two-lane one-way priority road through a yield junction: one dashed divider between
   its two through movements, following their curve.

## Acceptance

- T28 passes; existing render tests unchanged.
- Screenshots: the grid at a yield or priority junction, and three Munich junctions without
  signals (name the node ids), at a zoom where lane markings are visible.
- No visible cost: the layer is static geometry rebuilt only on a version change; report the
  number of dashes on Munich and the build time.
- `npm run check` green; `npm run test:e2e` green on a port of your own (T16 may be skipped).

## Commands

`npm run check`, `npm run test:e2e -- --grep-invert T16` (set `CITYFLOWS_TEST_PORT`),
`npm run dev` for the screenshots.

## Deliverable

A report in the body of your last commit message (no new Markdown files): what works, what
is not supported, the T28 results, the screenshot paths, the final lines of `npm run check`,
and anything found on another surface. Commit your work in a git worktree of this
repository; the lead reviews only commits.
