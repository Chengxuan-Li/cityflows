# TASK-287 — York's load time (TASK-284's F2)

Status: in progress 2026-11-21 (third run). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/287-york-load`, worktree `D:\cityflows-wt\287`, ports 5487 / 5587.

## Goal

York's first frame is 4.5 to 4.9 s on a quiet machine, 1.6x Freiburg's (TASK-284). Its profile names the
crossing-style lookup (1.27 s against Freiburg's 0.33 s, even after TASK-277's box prefilter), the UK zebra zig-zags
(0.71 s), `placeDetails` and `compileWalk`. Find the cause of each in general code and make it fast with identical
output, so York loads within about 1.2x Freiburg's time. Use TASK-284's York archive (merged into your base, or on
branch `task/284-bundle-luebeck-york`, read only).

## Scope

The hot paths the profile names (`src/network/crossings.ts`, `src/render/marking-geometry.ts`, place details, walk
compile), tests, a bench timing script.

Out of scope: what is drawn or simulated (identical output), `src/schema`.

## Gates

- Identical output: crossing styles, markings and walk compile hashed before and after in five cities; state
  hashes identical.
- Load and frame budgets for York, Freiburg, Munich, interleaved main against branch.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
