# TASK-172 — Nightly three-seed traffic report (advisory)

Owner: Claude Code subagent (Sonnet 5.5, high). Branch `task/172-seed-report`, worktree
`D:\cityflows-wt\172`. It starts after the baseline reset that follows TASK-113.

## Goal

The nightly Full workflow publishes an artifact and a job summary for Munich at 0.15 to 10:00 on
seeds 1, 2 and 3, with mode choice both off and on. For each seed it gives:
- completed, gridlocked, stalled heads and parking failures;
- mean delay;
- TASK-154's drain criteria (a) to (d) and the per-visit waits on the six loop roads;
- mode shares, for the choice-on runs.

It compares against the baseline file and the previous night's artifact. It is advisory only: it
never fails the workflow, and the seed-1 gate stays as it is. Add a script, for example
`bench/seed-report.ts`, that also runs locally.

## Gates

- The script runs locally and writes JSON and markdown.
- The workflow change is validated with a manual Full run.
- `npm run check`.

## Report

Write it as the commit body.
