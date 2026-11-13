# TASK-176 — Performance pass after the 2026-11-13 merges

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/176-performance`, worktree
`D:\cityflows-wt\176`. It starts after most Wave B tasks are on main, on a quiet machine.

## Goal

Profile and improve against main as of this morning (b25e4c4) and against current main:
- **Simulation step time:** Munich at 0.15 to 10:00, mode choice off and on.
- **Load time:** import, compile, schedule and the mode-choice routes.
- **Frame time:** T62/T64 in 2D and 3D, Day and Night lighting.
- **Bundle size.**

Use CPU profiles diffed by function. Only exact rewrites that leave simulation hashes unchanged,
or render changes with matched shots.

## Gates

- Before and after numbers on a quiet machine.
- Hashes unchanged.
- `npm run check`, `test:city`, `test:e2e:light`, T62/T64.

## Report

Write it as the commit body.
