# TASK-274 — Elevators mapped only as points (TASK-263's follow-up; owner-approved schema value)

Status: in progress 2026-11-21 (third run). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/274-elevator-points`, worktree `D:\cityflows-wt\274`, ports 5474 / 5574.

## Goal

TASK-263 draws buildings and parts valued `elevator` as glass shafts. `highway=elevator` nodes without a
mapped shaft are not in the city: Freiburg has 5 that serve only underground or indoor levels, and Munich 7,
two of them outdoor lifts up to the Donnersbergerbrücke. The owner approved (2026-11-21) adding a point type
value in `src/schema` for them.

Add the value and the importer reading. Check whether today's query and extracts already carry these
nodes (TASK-263 counted them in the extracts). Change the query only if it does not, and say so. TASK-273
owns this run's query version bump, so coordinate by keeping any query edit minimal. Draw an outdoor
elevator node with no shaft as a small glass shaft (about 1.6 m square) by TASK-263's rule: landings where
walks of different levels meet it, the height to the top landing plus 3 m. Indoor-only or underground ones
draw nothing (say how you tell). Older projects without the value open unchanged.

## Scope

`src/schema` (the point value, Zod), `docs/architecture.md`, the importer's point reading,
`src/render3d/elevators.ts`, tests, the Freiburg and Munich rebuilds via `bench/bundled-cities.ts`,
close-ups under `docs/findings/2026-11-21-elevator-points/`.

Out of scope: `src/sim/**`, walk topology, gate floors, downloads.

## Gates

- Tests: the reading, an old project opening unchanged, the drawing rule. Counts per city.
- Close-ups of the Donnersbergerbrücke lifts, day and night.
- State hashes identical (render and data only).
- Frame budgets and 3D build.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
