# TASK-198 — The showcase landing city

Status: planned; waits for TASK-197 and the owner's pick. Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/198-landing-city`, worktree `D:\cityflows-wt\198`.

## Goal

Build the place the owner picks from `docs/decisions/2026-11-17-landing-city.md` as a curated bundled
project and make it the landing view:

1. Commit its extract and terrain with attribution, and a script that builds the project from them, so
   it changes only when rebuilt on purpose. Ship it as `fixtures/projects/<id>.cityflows.json`.
2. A natural boundary, entry points where the main roads leave, and the basemap and terrain beyond the
   edge so there is no hard square.
3. Curate it: walk it in 2D and 3D, fix junctions, lanes, turn rules, names and parking with the editor,
   and keep the fixes in the project.
4. Make it the default `open()` source with a showcase camera; keep the grid and the other test cities
   under New city. Move every e2e spec that relies on the grid to open it by name.
5. Its own gate: pinned hashes, no gridlock and the 900 s drain at its scenario demand, a load-time
   budget, and a frame budget in 2D and 3D.

The exact scope, including importer changes and any contract change (polygon boundaries, entry points),
is set from TASK-197's findings before this starts.

## Report

Write it as the commit body.
