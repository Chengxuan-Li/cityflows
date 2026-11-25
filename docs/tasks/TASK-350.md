# TASK-350 — Ground vehicles serve more turnarounds at London City

Status: started 2026-11-25 in the owner's unsupervised run (airside: merge on gates). Owner: Claude subagent (Opus
5.5). Branch `task/350-gse-coverage`, worktree `D:\cityflows-wt\350`. Base: main.

## Finding (TASK-316 merge, 2026-11-25)

With vehicles on (`bench/airside-delay.ts --vehicles --checks`), full days:

| Airport | Visits served | Pushes with a vehicle tug |
|---|---|---|
| London City | 64–73% | 51–57 of 94–99 |
| Zurich | 95% | 79 of 98 |

Losses at London City, seed 1:
- 35 vehicles that held each other off at apron-road junctions and were taken out after 15 s;
- 19 with no room: catering at stands 6–7 and tugs at 11–12, where aircraft tails cover the road;
- 10 whose aircraft had already left;
- 8 taken out as a last resort.

Tow-aways on parking and the first departures of a run go without a vehicle tug (`metrics.unannounced`), because a
notice would change the aircraft's timing.

## Goal

Raise London City's served share and vehicle-tug pushes without changing the aircraft:

1. **Junctions:** vehicles meeting at apron-road junctions resolve by a deterministic give-way rule (for example
   priority by task urgency, then id), instead of mutual holds that time out.
2. **Room at stands:** where tails cover the road, use a reachable approach on the far side or a short wait, by
   rule. No per-stand curation.
3. **Tug dispatch:** dispatch the tug before the aircraft is ready, from the flight schedule (the planned off-block),
   so it arrives on time without delaying the aircraft. Do the same for tow-aways where the schedule allows.

## Scope

`src/sim/ground-vehicles.ts`, the vehicle hooks in `src/sim/flight-operations.ts` that do not change aircraft timing,
`bench/airside-delay.ts` (vehicle metrics), tests.

## Out of scope

Aircraft behaviour (`src/sim/aircraft.ts`), `src/schema`, cities.

## Gates

- London City seeds 1–3 and Zurich seed 1, full days with `--vehicles --checks`:
  - aircraft results identical to main without vehicles;
  - 0 vehicle overlaps, with aircraft or each other;
  - served share and vehicle-tug pushes up. Target: London City served at least 85%, vehicle-tug pushes at least 75%.
- Cities byte-identical.
- 3D render within budget.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.
