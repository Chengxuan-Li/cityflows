# TASK-305 — Airport editing: stands, taxiways, holding points, limits, configurations

Status: planned 2026-11-22 (airports batch, owner's go; starts after TASK-302). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/305-airport-editing`, worktree `D:\cityflows-wt\305`, ports 5505 / 5605.

## Goal

Airports become editable as roads are (owner, 2026-11-22: a later task, after Zurich;
`docs/decisions/2026-11-22-airports.md`), through the editor's commands, undo and the restart policy.

- Stands: add, move, delete; change kind and aircraft code limit; their lead-in follows.
- Taxiways and taxilanes: draw, split, delete, change width and code limit; the graph and code limits recompile.
- Holding positions: add, move, delete, assign the protected runway.
- Runway configurations and concept tables: edit the per-airport table and the tailwind limit.
- Edits apply to a running day by the existing restart policy; saved projects reopen with the edits.

## Scope

`src/editor`, `src/ui` (inspectors and tools), `src/network` recompilation of the airside, `src/project`, tests.

Out of scope: new airports, OSM edits, gate floors, `bench/traffic-baseline.json`, any download.

## Gates

- Tests: each edit command and its undo; a recompiled graph after a taxiway split; a code limit edit that
  re-routes an aircraft; a saved and reopened project equal to the edited one.
- e2e: in London City, add a remote stand, run until an aircraft uses it; screenshots.
- Existing archives and hashes byte-identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
