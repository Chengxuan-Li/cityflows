# TASK-190 — Parking bays under low ramps

Status: planned, not started; awaiting owner approval (lead, 2026-11-14). Proposed owner: Claude Code
subagent (Sonnet 5.5, high). Branch `task/190-ramp-bays`, worktree `D:\cityflows-wt\190`, ports 5390 / 5490.

## Goal

TASK-175 open item (plan.md): stall generation compares whole-number grades, so bays can sit under the
low part of a ramp (for example pk:2056, ramps 2.3 to 4.4 m up) where a car would not fit. Use the
road height profile (`laneHeightAt` in `src/network/heights.ts`) at each bay: no bay where the road
overhead is less than 4.5 m above it (the clearance TASK-175 uses).

## Scope

Stall generation in `src/importers/**` or `src/network/**` (wherever bays are placed), tests.

Out of scope: lot behaviour, `src/schema`, ramp heights themselves.

## Gates

- A unit test: a lot under a ramp keeps bays where clearance is at least 4.5 m and drops them below.
- Census: report which lots change (expected pk:2056 and perhaps pk:2050); pk:2049 unchanged.
- Re-pin hashes that move, with the reason; Munich gate and mode-share guard pass.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
- A 3D screenshot of pk:2056 before and after.

## Report

Write it as the commit body.
