# TASK-212 — Geometry audit: junctions, lane splits and merges, markings

Status: done 2026-11-18. Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/212-geometry-audit`, worktree `D:\cityflows-wt\212`, ports 5412 / 5512. Read-only on
code.

## Goal

The owner asked for focused fixes to the general logic of junction generation, lane splitting, lane
merging and lane-marking generation. The B-findings in `docs/plan.md` ("Owner findings from real OSM
testing", B16 to B59, and "Geometry rework") were fixed mostly on Munich before 2026-11-12; Freiburg,
now the landing city, has never been audited closely. This audit finds the real defects so that three
fix tasks can follow, one per surface:

- **Junctions** (`src/network/junctions.ts`, `corridor.ts`, `groups.ts`): roads overlapping at
  irregular or acute junctions, the junction surface not matching the roads, stop-line setbacks,
  bulges at side streets.
- **Lane splits and merges** (`src/network/lanes.ts`, `lane-drop.ts`, `continuity.ts`): tapers where
  a lane is gained or dropped, splits at forks, gores, merge lanes alongside before joining.
- **Markings** (`src/render/road-paint.ts`, `marking-geometry.ts`, `src/render3d/markings.ts`): turn
  arrows against allowed movements, dividers stopping short of or crossing the junction, solid vs
  dashed near junctions, stop lines and crossings, 2D and 3D.

1. Run the existing geometry audit (`npm run geometry-audit`, `bench/geometry-audit.ts`) on Freiburg,
   Munich and Sindelfingen; compare Munich and Sindelfingen with the last recorded figures in
   `docs/plan.md` to catch regressions.
2. Look at every Freiburg junction with a signal, every junction with three or more lanes on any arm,
   every place a road gains or loses a lane, and every fork or merge, in 2D and 3D close-ups
   (`npm run geometry-shots` or Playwright on the dev build); and a sample of Munich hotspots named in
   past reviews.
3. Write a ranked defect list: for each, the node or road ids, the city, the surface it belongs to
   (junction / split-merge / marking), what is wrong, a close-up, how many places show the same
   pattern, and the likely code path. Rank by how visible it is on the landing view and how many places
   share it. Name the 5 to 10 cases each fix task must solve.

## Scope

`docs/findings/2026-11-19-geometry-audit/` (close-ups and `README.md`, which this task asks for),
scratch scripts outside the repo, no source changes.

## Gates

- Every listed defect has an id, a close-up and a count.
- `npm run check` passes on the branch.

## Report

The findings README, and a commit body with the top cases per surface.
