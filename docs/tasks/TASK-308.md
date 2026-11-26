# TASK-308 — Flight schedule generator and runway configuration chooser

Status: in progress 2026-11-22 (airports batch wave A, owner's go). Proposed owner: Codex CLI (gpt-6.2-sol, high).
Branch `task/308-schedule-config`, worktree `D:\cityflows-wt\308`, ports 5508 / 5608.

## Goal

The two decision engines TASK-299 and TASK-300 plug in, as pure, seeded functions over small input types of their
own, independent of the airport model (`docs/decisions/2026-11-22-airports.md`, wave A).

- **Schedule.** Input: stands summarised as counts by kind and aircraft code, runway count, a daily volume (or one
  derived from stands and a stated turns-per-stand rule), an hourly profile (morning and evening peaks, an optional
  curfew window), a type mix (catalogue ids with weights, filtered to what the largest stand code admits), a share
  of overnight aircraft, maintenance and irregular tow rates, helicopter movements when helipads exist. Output: a
  seeded list of flights (arrival time, departure time after the type's turnaround, type, stand kind and code
  needed, flags for overnight, tow and maintenance moves). Defaults for London City (about 150 movements a day,
  regional, propeller, A220 and private, curfew at night) and a large-airport default.
- **Configuration chooser.** Input: runway ends (designator, heading), a list of allowed configurations (arrival
  and departure ends; at crossing runways which pairs run together), an optional time-of-day concept table, wind
  direction and speed, a tailwind limit (default 5 kt) and per-type crosswind limits. Output: the configuration in
  force at a time, and the times a change is due over a day for a wind series. Derive the allowed configurations by
  rule from the runway ends when none are given (each end alone; parallel ends together).
- Tests: determinism by seed; volumes and peaks match the profile; no type above the largest stand code; turnaround
  per type; curfew respected; the chooser keeps tailwind within the limit, follows the concept table, switches on a
  wind reversal.

## Scope

New modules under `src/demand` (schedule) and `src/sim` or `src/network` (chooser) as the architecture suits, tests,
a short `docs/architecture.md` paragraph. `src/schema/aircraft.ts` gains turnaround minutes per type if needed.

Out of scope: the airport model (TASK-295), aircraft motion (TASK-298, 306), UI, gate floors,
`bench/traffic-baseline.json`, any download.

## Gates

- Tests above; existing archives and hashes byte-identical (no engine change); added test time reported.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
