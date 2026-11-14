# TASK-185 — 2D street-label frame cost

Status: planned, not started; awaiting owner approval (lead, 2026-11-14). Proposed owner: Claude Code
subagent (Sonnet 5.5, high). Branch `task/185-label-cost`, worktree `D:\cityflows-wt\185`, ports 5385 / 5485.

## Goal

TASK-167's 2D labels cost T62 2D +4.0% and +5.5% and T64 2D +2.8 to 3.8% against TASK-167's 5% gate
(plan.md, TASK-176 review; TASK-167 review). Bring the 2D label layer's frame cost under 5% on both
workloads in repeated rounds, without changing which labels are placed or how they look.

Likely places: re-placing or re-measuring labels on frames where the zoom step did not change, text
objects that are re-laid out per frame, or labels drawn off screen. Profile first and name the cost.

## Scope

`src/render/layers/labels.ts`, `src/render/labels.ts` (no change to placement results), the 2D scene
wiring in `src/render/scene.ts`, tests.

Out of scope: the simulation, `src/schema`, the 3D labels (TASK-183), label rules and styles.

## Gates

- T62 and T64 2D with labels on within 5% of labels off, in at least three rounds each on a quiet
  machine (report every round).
- Placement unchanged: the TASK-167 label tests and pins pass unchanged; a before/after screenshot of
  Munich 2D at two zooms matches.
- `npm run check`, `test:city`, `test:e2e:light`, T62/T64.

## Report

Write it as the commit body.
