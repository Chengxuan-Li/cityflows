# TASK-291 — Road clearance under rail bridges lowered by TASK-280

Status: in progress 2026-11-21 (wave C, owner's go). Proposed owner: Codex CLI (gpt-6.2-sol, high). Branch `task/291-rail-clearance`, worktree
`D:\cityflows-wt\291`, ports 5491 / 5591.

## Goal

TASK-280 shares one height profile between rail tracks on a bridge; 42 Freiburg track sections came out lower
(`rt:12392` 3.91 to 2.45 m, `rt:12830` 4.74 to 2.04 m), and a road passing under them may now have too little
clearance in 3D. Measure clearance between every road (and walkway) passing under a raised rail track and the
underside of that track's deck in every bundled city; where it falls below a general minimum (4.5 m over roads,
2.5 m over walkways, or the road's own `maxheight` when tagged), raise the rail profile there (or keep the deck
height the tracks had before TASK-280) by general rule. Rendering only.

## Scope

`src/render3d/rail.ts`, `heights.ts` (rail heights), tests, a bench clearance script.

Out of scope: `src/sim`, `src/network`, `src/schema`, importers, the archives.

## Gates

- A clearance census per bundled city, main against branch: crossings under 4.5 / 2.5 m, worst ten with ids.
- Close-ups before and after (day) of the worst Freiburg cases; covered-bed and floating-deck counts kept at 0.
- Simulation state hashes identical; 3D build time and frame p95 within budget.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
