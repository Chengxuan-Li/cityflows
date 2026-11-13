# TASK-178 — Repair the full test tier after the 2026-11-13 merges

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/178-full-tier`, worktree
`D:\cityflows-wt\178`, ports 5378 / 5478. Top priority: under AGENTS.md, a red Full run blocks new
merges.

## Problem

The manual Full run 43479489386 on `738af8c` (main with TASK-113, the Mac UI, TASK-171 and
TASK-172) failed in these places:

- **Traffic tier:** `tests/traffic/munich-full-demand.test.ts` timed out at 900 s.
- **e2e (a):** T19 live town, T47 road access (town and Munich), V100 vehicle classes.
- **e2e (b):** gate4-layers, qa-mobile, T16 grid5x5-stress (`start.active` ≥ 2,700), and T63 (since
  fixed by TASK-173 on main).
- **e2e (c):** the T54 Munich lot case ("controlled arrivals drive the camera lot at 08:00"), which
  also failed on main before.
- **e2e (rest):** see the log.

Likely causes:
- **Mode choice is on by default (TASK-113).** Specs that expect car traffic now see walkers. TASK-113
  switched only the light-set specs to `driveEveryone`.
- **UI layout (TASK-160).** Panels moved into sidebar sections.
- **Simulation changes:** TASK-161, 164, 165, 173 and 175.
- **Slower full-demand runs.**

## Goal

Get the full tier green on current main.
- For each failure, find the cause and fix it at the right level:
  - A spec assumption that the owner's decisions changed (mode choice on, the Mac layout): the spec
    drives everyone, finds its control by role or name, or follows the new behaviour.
  - A real bug: fix the code with a regression test.
  - Timeouts: measure. Use TASK-171's `limit()` for limits written in test files, and justify any new
    budget from CI timings.
- No gate floor or baseline changes.

## In scope

`tests/e2e/**`, `tests/traffic/**`, test helpers, and small code fixes with tests. List every code
fix.

## Out of scope

Behaviour changes beyond real bug fixes, the baseline, and gate floors.

## Gates

1. Every previously failing spec passes locally, one worker.
2. `npm run check`, `test:city`, `test:traffic` (full) and `test:e2e` (full), with
   `CITYFLOWS_TEST_PORT=5378` and `CITYFLOWS_TEST_WORKERS` as needed.
3. The lead confirms with a manual Full run after merge.

## Report

Write it as the commit body: per failure, the cause and the fix; timings; anything left open.
