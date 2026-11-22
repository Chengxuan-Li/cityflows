# TASK-316 — Airside ground vehicles

Status: planned 2026-11-22 (airports wave G; starts after TASK-312). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/316-ground-vehicles`, worktree `D:\cityflows-wt\316`, ports 5516 / 5616.

## Goal

Owner: "ground (airport area only) vehicles". Service vehicles that work the turnarounds on the airside only: pushback
tugs (the tug that pushes, replacing the implied one), baggage tractors with carts, fuel trucks or hydrant dispensers,
catering trucks, passenger buses to remote stands, follow-me cars where useful. They drive on airside service roads
and apron lanes (mapped or derived by rule), give way to aircraft, park at stand equipment areas, and follow each
turnaround's timeline; no landside trips, no persons.

## Scope

`src/sim` (a ground-vehicle module tied to flight operations), `src/network` (airside service lanes), `src/render`,
`src/render3d`, tests, `docs/architecture.md`.

Out of scope: road traffic outside the airside, schema beyond what the vehicles need, gate floors,
`bench/traffic-baseline.json`, any download.

## Gates

- Tests: a turnaround's vehicle set and timeline; vehicles never overlap aircraft or each other; they yield at taxiway
  crossings; determinism.
- London City and Zurich full days with vehicles: aircraft gates kept (completion, delays, zero overlaps); screenshots.
- Existing cities unchanged; render within TASK-311's budget.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
