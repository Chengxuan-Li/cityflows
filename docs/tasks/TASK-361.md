# TASK-361 — Zurich ground vehicles: dropped and late tugs, vehicles queued at day's end

Status: started 2026-11-26 (owner defaults; bounded, Codex). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-356, 2026-11-26)

Zurich seed 1 (`--daily 730`, `--vehicles --checks`) still has 179 of 441 pushes without a vehicle tug, and ground
service is 60.6%. The tugs were either dropped or late on the way: held off, cleared by a push, or stuck in Zurich's
crowded service lanes.

The number of vehicles still queued on lanes at the end of the Zurich day rose from 13 to 29 with TASK-356. London
City is at 3, 3 and 9 pushes without a tug, with service at 92–95%.

## Goal

1. Find out why Zurich's tugs and service vehicles are dropped or late. Count each by cause:
   - held off by an aircraft;
   - cleared by a push;
   - lane queue;
   - no route;
   - and others.
2. Fix the largest causes with general rules in the ground-vehicle layer. Possible rules:
   - lane priority or passing places;
   - dispatch from the nearest free depot;
   - giving up and re-routing after a bounded wait;
   - not entering a lane whose exit is blocked.
3. Bring the end-of-day lane queue at or below main's before TASK-356 (13), or explain what holds the rest.

Aircraft must not change: the vehicles follow the aircraft, never the reverse.

## Scope

`src/sim/ground-vehicles.ts`, its tests, and the vehicle fields of `bench/airside-delay.ts`.

## Out of scope

`src/sim/aircraft.ts` and `src/sim/flight-operations.ts` (other agents are changing them), `src/schema`, the importer.

## Gates

- Full days with `--vehicles --checks`: Zurich seeds 1–3 (`--daily 730`) and London City seeds 1–3:
  - aircraft fields identical to the same seed with `--roads --checks` on main;
  - 0 vehicle overlaps with aircraft and with one another;
  - Zurich pushes without a tug down from 179 on seed 1 (report every seed);
  - served share not lower;
  - end-of-day queued vehicles down;
  - London City not worse.
- `npm run check`, `npm run test:city`, `npm run test:traffic:light`, `npm run test:e2e:light`.

## Result (2026-11-26)

**PASS for TASK-361 on matched aircraft baselines.** The task branch includes TASK-353. Compared directly with pre-TASK-353 main, the whole branch does not have identical aircraft output. TASK-361 does not edit aircraft or flight operations. To test the vehicle change separately, the final ground-vehicle module was also run against frozen main `d510b589` (the executable tree in worktree `7246da22`, which differs only in `docs/plan.md`).

The first unmodified Zurich seed 1 day reproduced 179 missed tugs out of 441 pushes, 879/1450 visits served and 29 vehicles stopped more than ten minutes at midnight. Its aircraft fields matched its roads-only run exactly. The diagnostic rerun reproduced the same outcome and separated depot queues, lane queues and aircraft holds.

The biggest problems were traffic cycles and depot choice by straight-line distance. At Zurich stand `st:21356`, the nearest depot in plan required about 7.5 km of driving, but another reachable depot needed about 1.3 km. Dispatch and returns now use driven distance, and dispatch can use a free depot with a comparable route. Vehicles reserve each junction passage as they cross its hold line or enter an aircraft zone containing it, let go when their back clears, and keep only the surviving reservations when a path is spliced.

A stable wait cycle gives way in urgency order, with returns yielding before inbound service and tugs. A visit that loses a cycle can be dispatched once more after 15 s if the aircraft still needs it and a route fits the remaining time. In the first London City seed 3 trial a fuel visit was discarded despite having several minutes left. The single retry restored service without changing aircraft timing.

### Zurich seed 1 causes on frozen main

A missing tug gets one cause at push. A traveling vehicle uses the current blocker, or its last sustained blocker if it has resumed. A planned visit uses its last failed dispatch cause. Late means over two minutes after the planned visit, or too late to serve for non-tugs.

| Cause                              | Dropped visits | Pushes without tug | Late tugs | All late visits |
| ---------------------------------- | -------------: | -----------------: | --------: | --------------: |
| Lane queue                         |       243 → 77 |            86 → 24 |    6 → 11 |         33 → 67 |
| Depot queue                        |        204 → 0 |             33 → 0 |     1 → 0 |           8 → 0 |
| Held by aircraft                   |        33 → 38 |            15 → 21 |   14 → 22 |         49 → 83 |
| Cleared by push or tow             |          2 → 1 |              0 → 0 |     0 → 0 |           0 → 0 |
| Cleared by other aircraft movement |          1 → 1 |              0 → 0 |     0 → 0 |           0 → 0 |
| No route                           |          0 → 0 |              0 → 0 |     0 → 0 |           0 → 0 |
| No room at the stand               |        35 → 35 |            24 → 24 |     0 → 0 |           0 → 0 |
| Still driving                      |          1 → 0 |              1 → 0 |     0 → 2 |           0 → 6 |
| Arrival not ready for dispatch     |         10 → 0 |             10 → 0 |   15 → 31 |         15 → 31 |
| Unannounced push                   |          0 → 0 |              8 → 8 |     0 → 0 |           0 → 0 |
| Tug had left its position          |          0 → 0 |              2 → 2 |     0 → 0 |           0 → 0 |
| Stand queue                        |          0 → 0 |              0 → 0 |     0 → 0 |           1 → 0 |
| Total                              |      529 → 152 |           179 → 79 |   36 → 66 |       106 → 187 |

The one remaining midnight queue in seed 1 and all three in seed 3 were held by aircraft. More tugs reached the stand after their planned time, so the count of late arrivals rose even though pushes without a tug fell. No route failures were observed on this seed.

### Full-day gates

Zurich used `--daily 730`. Every vehicle day used `--vehicles --checks`. The paired references used `--roads --checks`. Aircraft comparison excludes only wall time and vehicle fields. Overlaps are vehicle-aircraft / vehicle-vehicle, sampled each simulated second. Midnight queued is the existing count stopped for more than ten minutes. Zurich seed 2 and every task-branch day ended with none.

**Frozen main, old vehicles → final TASK-361 vehicles**

| Airport seed  | Aircraft identical | Overlaps | Pushes without tug |    Served share | Midnight queued | Gate |
| ------------- | ------------------ | -------: | -----------------: | --------------: | --------------: | ---- |
| Zurich 1      | Yes                |      0/0 |   179/441 → 79/441 | 60.62% → 87.45% |          29 → 1 | Pass |
| Zurich 2      | Yes                |      0/0 |   145/447 → 70/447 | 70.42% → 87.94% |          73 → 0 | Pass |
| Zurich 3      | Yes                |      0/0 |   171/452 → 84/452 | 64.88% → 87.27% |          63 → 3 | Pass |
| London City 1 | Yes                |      0/0 |        3/99 → 3/99 | 91.99% → 93.59% |           0 → 0 | Pass |
| London City 2 | Yes                |      0/0 |        3/96 → 3/96 | 95.08% → 95.08% |           0 → 0 | Pass |
| London City 3 | Yes                |      0/0 |        9/94 → 9/94 | 91.10% → 92.12% |           0 → 0 | Pass |

**Task branch, final vehicles**. London City arrows use the TASK-353 base with the old vehicles.

| Airport seed  | Aircraft identical to branch roads | Aircraft identical to pre-353 main roads | Overlaps | Pushes without tug |    Served share | Midnight queued | Gate |
| ------------- | ---------------------------------- | ---------------------------------------- | -------: | -----------------: | --------------: | --------------: | ---- |
| Zurich 1      | Yes                                | No                                       |      0/0 |             77/428 |          86.48% |               0 | Pass |
| Zurich 2      | Yes                                | No                                       |      0/0 |             83/425 |          86.53% |               0 | Pass |
| Zurich 3      | Yes                                | No                                       |      0/0 |             77/429 |          87.06% |               0 | Pass |
| London City 1 | Yes                                | No                                       |      0/0 |        4/98 → 4/98 | 91.35% → 93.27% |           0 → 0 | Pass |
| London City 2 | Yes                                | No                                       |      0/0 |        6/96 → 6/96 | 94.14% → 94.46% |           0 → 0 | Pass |
| London City 3 | Yes                                | No                                       |      0/0 |        7/94 → 7/94 | 93.86% → 94.54% |           0 → 0 | Pass |

### Test tiers

| Tier                         | Status | Final lines                                                                                               |
| ---------------------------- | ------ | --------------------------------------------------------------------------------------------------------- |
| `npm run check`              | Pass   | `Test Files 304 passed \| 1 skipped (305)` · `Tests 2177 passed \| 3 skipped (2180)` · `✓ built in 2.10s` |
| `npm run test:city`          | Pass   | `Test Files 77 passed (77)` · `Tests 291 passed \| 1 skipped (292)`                                       |
| `npm run test:traffic:light` | Pass   | `Test Files 2 passed (2)` · `Tests 5 passed \| 1 expected fail (6)`                                       |
| `npm run test:e2e:light`     | Pass   | `63 passed (6.2m)`                                                                                        |

Playwright used port 5398 (5394 and 5395 were occupied). The run used the repository's existing timeout and worker overrides for this shared machine. Logs and JSON are under `D:\cityflows-wt\330-pilot\R\t361`.

Implementation commit `d07a2689e72669752f921d626d1b60f0dc2cc763`. No dependencies added. No push or merge.
