# TASK-282 — Left-hand turn ranking: the far-side right yields like a left (TASK-268's follow-up)

Status: in progress 2026-11-21 (third run, wave B). Proposed owner: Claude Code subagent (Opus 5.5, high).
Branch `task/282-left-hand-turn-rank`, worktree `D:\cityflows-wt\282`, ports 5482 / 5582.

## Goal

TASK-268 made left-hand cities protect the far-side right turn at signals and removed the mirrored priority
to the left. The turn rank inside each movement's priority (`docs/architecture.md` section 5.3) still ranks a
left below through traffic and a right with it, for both sides. Under left-hand traffic the right turn
crosses oncoming traffic and must rank as the left does under right-hand traffic, and the left with
through traffic. This contract describes the change to section 5.3: mirror the turn rank by driving side
and update the section's text. Right-hand cities must be unchanged.

## Scope

The movement priority code (`src/network`), `docs/architecture.md` section 5.3, tests.

Out of scope: signal programs (TASK-268 did them), `src/schema`, gate floors.

## Gates

- A test that fails without the mirror. York (TASK-259's extract in `D:\cityflows-wt\259-data`, read by path,
  never run code there) at 0.15 with choice on and off: completed, gridlock, mean delay and worst visit,
  before and after. Report any movements whose rank changes at three named junctions.
- Right-hand cities: city and compiled hashes identical (Munich, Freiburg, Sindelfingen), one state hash
  each.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
