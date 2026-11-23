# TASK-312 — Airside throughput at scale and realistic taxi speeds

Status: in progress 2026-11-22 (airports wave F; based on the lead line with TASK-310, 311, 302, 313, 314, 315 and TASK-317's taxi-speed fix). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/312-airside-scale`, worktree `D:\cityflows-wt\312`, ports 5512 / 5612.

## Goal

The airside operations of TASK-298 to 300 work at London City's 150 movements a day and collapse beyond it: Boston
227/1,000, Heathrow 56/1,306 (parked TASK-303 and 304; Zurich per TASK-302's report). Make them scale, and make taxi
speeds realistic (owner: "Taxiing speed may increase - check real taxiing speed in real world (this may also be a
source of delay)").

- Taxi realism: compare the sim's achieved taxi speeds and taxi times (straight, turns, apron, rapid exits) with
  published operating figures (roughly 15 to 25 kt on straight taxiways, about 10 kt in turns, rapid exits up to about
  50 kt, slower on aprons; state sources as type-level or operator figures); fix where the sim is slower than real
  (profiles, start-stop from reservations, holding too early).
- Throughput: find and fix the scaling causes the parked reports name (stand allocation and route retries, whole-route
  one-way locks, runway sequencing, diversions) by general rules: finer locks with deadlock-free ordering, stand
  planning ahead of arrival, runway sequencing with mixed or segregated modes.
- Bring Boston and Heathrow into the New city panel once they pass, taking their bundling and the good rules from the
  parked branches (`dacf5ae`: the apron rule; `c0b4b2f`: the population and curb fixes), not their clearance changes.

## Method (owner's time cut, 2026-11-22)

1. First build a fast bench: airside only (no road traffic, no rendering), headless, a peak window (for example
   06:00 to 10:00 sim time) per airport, printing completed, diverted, queued and the delay attribution TASK-317
   defined (`bench/airside-delay.ts` is a start). Iterate on it; a run should take minutes, not an hour.
2. Use the attribution to pick fixes: TASK-317 and TASK-302 found the waits are approach sequencing, departure start
   grants and surface clearance (whole-route locks), departure readiness waiting for inbound aircraft, and stand
   admission; taxiing itself is under 1% at the large airports, and taxi speed is already fixed.
3. Run full days only for the final gate numbers.

## Scope

`src/sim` (aircraft, flight operations, configurations), `src/routing/airside.ts`, `src/network/airside*.ts`,
`src/demand/flight-schedule.ts`, `src/schema/aircraft.ts` figures, bundling files, tests, `docs/architecture.md`.

Out of scope: load and render performance (TASK-310, 311), visuals (TASK-314, 315), ground vehicles (TASK-316),
gate floors, `bench/traffic-baseline.json`, any download.

## Gates

- Full days at seed 1 (and seeds 2, 3 reported) for London City, Zurich, Boston and Heathrow: completion at least
  98%, mean delay and worst delay reported against London City's (aim mean under 10 min at the large airports), go-arounds
  under 1% of arrivals, zero overlaps, runway or crossing conflicts, nothing stuck.
- Achieved taxi speeds and taxi-out times per airport against the published figures.
- London City's current gates kept; existing cities unchanged per the rule bullet.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.

## Report

Write it as the commit body.
