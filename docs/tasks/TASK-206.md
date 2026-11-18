# TASK-206 — 3D load time back under its budget

Status: done 2026-11-19. Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/206-3d-load`, worktree `D:\cityflows-wt\206`, ports 5406 / 5506.

## Goal

TASK-198 measured Freiburg's 3D view at 2.0 to 4.0 s after the first frame (production bundle, this
machine). On 2026-11-18 it measured 5.2 to 6.9 s (TASK-201, TASK-203), so `qa-production.spec.ts`
fails its local 3D budget (5 s) on main. TASK-201 showed building parts are not the cause (same 3D
geometry time with and without them).

1. Find where the time went since TASK-198 (merge `200bc3e`): measure the phases of the 3D first
   frame (geometry build per layer, upload, first draw) on main and on `200bc3e`, interleaved, in
   the production bundle; bisect the merges in between if needed (`git worktree add` at a commit
   under `D:\cityflows-wt\206-bisect`, its own `node_modules` junction, removed at the end by
   deleting the junction first).
2. Fix the cause without changing what is drawn: 3D screenshots before and after match.
3. Get 3D under 5 s after the first frame on this machine, idle. If the regression alone does not
   get there, make the smallest further change (deferring layers that are not in view, sharing
   work with 2D, moving work off the main thread) and say what it costs.
4. Measure, without turning it on, what Freiburg's terrain (`fixtures/terrain/freiburg.json`) costs
   after your change, per phase, and what would make it affordable. A report, not a change.

## Scope

`src/render3d/**`, the 3D start-up in `src/ui/map-view.tsx`, `src/render/**` shared geometry, tests and
e2e specs.

Out of scope: `src/schema`, the simulation, `fixtures/**`, `bench/freiburg.ts`, the 2D first frame
(must stay within 3 s), what is drawn.

## Gates

- 3D after the first frame under 5 s in three idle runs and first frame within 3 s, production bundle
  (`qa-production.spec.ts`), with the machine load reported (other agents run at the same time:
  measure main and branch interleaved and report both).
- Render CPU p95 2D under 4 ms, 3D under 6 ms; 3D screenshots of the Freiburg landing view and the
  Münster unchanged (pixel diff or side by side).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the phase timings before and after, the cause, the fix, the terrain
figures.
