# TASK-186 — 2D Evening frame cost

Status: planned, not started; awaiting owner approval (lead, 2026-11-14). Proposed owner: Claude Code
subagent (Sonnet 5.5, high). Branch `task/186-evening-cost`, worktree `D:\cityflows-wt\186`, ports 5386 / 5486.

## Goal

2D Evening costs +10.6% against Day after TASK-184 (+9.2% before; TASK-163's limit is 10%; plan.md,
TASK-163, TASK-176 and TASK-184 reviews). Night is cheaper than Evening. Bring 2D Evening within 10%
of Day, ideally near Night's cost, with no visible change to the Evening scene.

Profile the night layer (`src/render/layers/night.ts`): lamp pools and halos, the evening tint,
window lights, and TASK-184's per-grade vehicle-light containers and deck masks. Name the cost before
changing anything.

## Scope

`src/render/layers/night.ts`, `src/render/layers/vehicles.ts` (lights only), `src/render/lighting.ts`
if a value must be precomputed, the 2D scene wiring, tests.

Out of scope: the simulation, 3D, `src/schema`, the lighting model's colours and timings.

## Gates

- 2D Evening against Day within 10% on the T64 workload and the Donnersberger workload, at least three
  rounds each (report every round, with Night for reference).
- Before/after screenshots of Munich 2D Evening and Night at two zooms, matching (a pixel diff, or
  name every differing region and why).
- V163, `npm run check`, `test:city`, `test:e2e:light`, T62/T64.

## Report

Write it as the commit body.
