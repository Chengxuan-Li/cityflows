# TASK-171 — Test infrastructure: timeouts, heavy-test scheduling, warm caches

Owner: Claude Code subagent (Sonnet 5.5, high). Branch `task/171-test-infra`, worktree
`D:\cityflows-wt\171`, ports 5371 / 5471. Run it when few sim branches are open, because it
touches many test files.

## Problem

All day, local runs failed on time limits under load. Several limits are written into test files:
T46 30 s, T36.1 120 s, route-audit 60 s, and the gate's setup hook. Agents and the lead lost hours
rerunning tests alone.

## Goal

- **One setting for every limit.** Each per-test and hook timeout reads one env-driven scale, for
  example `CITYFLOWS_TEST_TIMEOUT_MS`, or a multiplier applied to the defaults. Keep today's values
  as defaults, so CI behaves the same.
- **Heavy tests tagged.** Tests that import or simulate a whole city get a tag and run in a
  serial pool inside their vitest project, which stops the parallel cold imports that caused the
  timeouts.
- **Warm cache.** A `pretest` step warms the city import cache once, before parallel workers start.
- **Docs.** Record the knobs in AGENTS.md "Commands", in a few lines.

## Gates

- Same pass and fail results as main.
- Local `npm run check` under load with three or more agents running has no timeout failures.
  Measure before and after.
- CI duration not worse.
- No pinned values change.

## Report

Write it as the commit body.
