# TASK-169 — Keep-clear at driveways, lot mouths and exit crosswalks

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/169-keep-clear`, worktree
`D:\cityflows-wt\169`, ports 5369 / 5469. It starts once TASK-164 and TASK-165 are on main.

## Problem

Through traffic that queues across a lot mouth or driveway holds the exiting car indefinitely.
Examples:
- pk:2049: exit waits up to 3,152 s, with car 3544 held while traffic stands across its join point
  on `r:639#0`;
- TASK-157's crossed-lane holds;
- TASK-153's open item.

## Goal

A queued vehicle doesn't stop with its body across a marked keep-clear zone: lot and garage
mouths, driveway connectors with real exit traffic, and exit-side crosswalks, consistent with
TASK-165. Approaching cars stop short when the space beyond the zone can't take their whole body,
so the zone stays open for crossing and exiting traffic. Add keep-clear markings, drawn as the
regulatory hatched box or as text by marking theme, where the rule applies.

## Scope

`src/sim/**` car-following and queue-stop placement, the zone definitions in `src/network`, the
marking in the renderer, and tests.

## Gates

- Census: longest and mean exit waits per lot, before and after. pk:2049's longest exit wait under
  600 s.
- Regression tests.
- Munich seed-1 gate against the current baseline; report seeds 2 and 3.
- T21, T53, T54, T59, T63, T77, `npm run check`, `test:city`, `test:e2e:light`.
- Shots of pk:2049 before and after.

## Report

Write it as the commit body.
