# TASK-174 — Transit as a mode: walk, tram or S-Bahn, walk

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/174-transit-mode`, worktree
`D:\cityflows-wt\174`, ports 5374 / 5474. It starts after TASK-173. It may carry past the 24-hour
window; commit resumable milestones.

## Goal

Persons can choose transit, the third alternative TASK-113 left empty:
- **Routing:** walk to a stop or platform, wait for a scheduled tram (TASK-138) or S-Bahn (TASK-127
  timetable), ride, transfer if needed, and walk to the destination. Routing works on a time-
  expanded timetable graph.
- **Capacity:** vehicles have capacity, with a full vehicle leaving riders to wait for the next
  one. Riders are drawn boarding and alighting at platforms and are visible in the vehicle
  inspector.
- **Choice:** the logit gains a transit utility: walk access and egress, wait, in-vehicle time
  times a comfort factor, and fare times value of time.
- **TASK-128's riders:** keep the station riders as background demand, or fold them in if natural;
  report which.
- **Metrics:** mode shares gain transit.

## Scope

`src/demand` (the model), a new transit routing module, `src/sim` (rider movement and vehicle
occupancy), the inspector and metrics UI, and tests.

## Gates

- Unit tests for routing and capacity.
- A Munich census of transit share by distance and of riders per line.
- The gate with mode choice off unchanged.
- The mode-share guard updated with justification.
- `npm run check`, `test:city`, `test:e2e:light`.
- Shots of boarding and alighting.

## Report

Write it as the commit body.
