# TASK-175 — Road grade in the compiled network

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/175-road-grade`, worktree
`D:\cityflows-wt\175`, ports 5375 / 5475. It can start now; it is independent of the running
tasks except at merge.

## Goal

Compiled roads and lanes carry their vertical level: `grade`, from OSM `layer`, `bridge` and
`tunnel` and TASK-132's height model, consistent with the 3D heights. This is a contract change,
pre-approved by the owner on 2026-11-13. Document it in architecture section 4/5 and in the
schema.

Use it where level matters today:
- TASK-157's lot-exit hold ignores roads at another level, which fixes the 78 to 98 under-bridge
  cases at pk:2049, pk:2050 and pk:2056 and pk:2050's `r:884` ramp case;
- `bodyClearLane` and the crossing checks;
- picking in 3D;
- collision of lot motions with roads above.

## Gates

- Census before and after of the under-bridge parking cases.
- No change in traffic other than the explained parking holds. Munich gate; seeds 2 and 3.
- Pins move only for the new field, proved by stripping it.
- `npm run check`, `test:city`, `test:e2e:light`.

## Report

Write it as the commit body.
