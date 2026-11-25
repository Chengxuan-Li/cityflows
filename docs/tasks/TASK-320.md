# TASK-320 — Parked aircraft on their stand's heading and stop

Status: planned 2026-11-23 (starts after TASK-312, which owns `src/sim/aircraft.ts` now). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/320-stand-pose`, worktree `D:\cityflows-wt\320`, ports 5520 / 5620.

## Goal

TASK-316 found that at London City parked aircraft are drawn on the stand heading while their physical (sim) pose is
off by up to 61 degrees (stands 5 to 8: 51 to 61; 26: 40; 22, 23, 25: 18 to 23; 27, 28: 11 to 14), and parked tails at
stands 11 and 12 lie 7.7 to 8.7 m past the apron service road's centreline (`D:\cityflows-wt\316-evidence\lcy-stand-poses.txt`).
The arrival's turn-in ends wherever the lead-in path leaves the aircraft, and the drawn pose snaps to the stand.
Make the physical parked pose match the stand: the turn-in ends on the stand heading at the stop position (by
following the lead-in to its end with the turn radius, or a final alignment segment), the drawn pose equals the sim
pose, and stop positions keep the parked body clear of the apron road where the stand geometry allows (or report the
stands whose mapping makes that impossible). Pushback starts from the corrected pose. General rule, every airport.

## Scope

`src/sim/aircraft.ts` (arrival turn-in and parking, pushback start), `src/routing/airside.ts` lead-in paths,
`src/render` and `src/render3d` (drop the snap once poses agree), tests, `docs/architecture.md`.

Out of scope: ground vehicles (TASK-316, parked until this lands), throughput logic beyond parking, gate floors,
`bench/traffic-baseline.json`, any download.

## Gates

- Physical-versus-stand heading at stop under 3 degrees at every London City and Zurich stand (table per stand before
  and after), and the same check at Boston and Heathrow; tails past the apron road reported per stand.
- No overlaps, conflicts or stuck aircraft; London City's, Zurich's and TASK-312's gates kept; airport startup pins
  re-pinned only where parking poses change, stated.
- TASK-316's branch re-run on top: London City service rate and tug coverage reported (target 85% and every
  reachable push).
- Existing cities unchanged; the lead's tiers.

## Report

Write it as the commit body.
