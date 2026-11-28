# TASK-379 — Boston Logan landside: 53 gridlocks in the morning probe

Status: parked 2026-11-27 (diagnosis `7be89357`; no variant kept): 40 of 54 gridlocks are spillback where a crossing's queue reserve wastes room before it; V1 (pocket after 10 s) 53 gridlocks but worse delay, V2 57 and fails London City. Started by the lead in the 10 h unsupervised run; city work merges under the traffic merge rule and the audit
tolerance). Owner: Codex (gpt-6.2-sol, high). Base: main `2fca81f1`.

## Finding (TASK-372, TASK-374)

Boston Logan is held out of the showcase panel. With TASK-374's crash fix, its morning probe (seed 1, demand 0.15,
07:00–10:00, landside and airside) runs to 10:00: 5,342 trips completed, mean delay 1,755.9 s, worst visit 3,503.3 s on
`r:458`, **53 gridlocked trips**. The landside-only probe gives the same counts, so the airport is not the cause.

## Goal

1. Find the gridlocks: for each, the cycle of vehicles and lanes (or the deadlock pattern), the place (roads, nodes,
   terminal kerbs, garage ramps, the Ted Williams / Sumner tunnels, the airport loop), and the rule that let it form.
   Group them by pattern and table the groups with counts.
2. Fix the largest pattern by an app rule that holds for every city (OSM rule: no per-id curation, no OSM edits).
   At most two variants.
3. Report the Boston probe after the fix. Bringing Boston into the panel is not required.

## Scope

`src/sim/**` where the cause lies, `src/network/**` if a compiled-network rule is the cause, tests, re-pins.

Out of scope: gate floors, `bench/traffic-baseline.json`, OSM edits, per-id curation, the showcase panel.

## Gates

- The owner's merge rule: Munich 0.15 seeds 1–12, four configurations, within 3%; full demand within 2% on the mean of
  seeds 1–5, both modes; Freiburg within 5 s; drain; Sindelfingen; all showcases pass.
- If the compiled network changes: the geometry audit within tolerance.
- Airside identical (Heathrow peak seed 1, Boston day seed 1) unless explained.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result

**Fail.** The diagnosis reproduces both baselines. Neither app-rule variant passes the
screen, so the simulation change is not retained. Boston remains out of the showcase.

### Reproduction and diagnosis

The task's 53 gridlocked trips are the pre-TASK-373 Boston result. The task base
`2fca81f1` has US priority at unmarked junction crossings. With that priority in place,
the baseline landside probe completes 5,558 trips with 1,734.6 s mean delay, a 3,216.0 s
worst road visit (`r:458`), and **54 gridlocked trips**. All comparisons below keep US
priority. They use seed 1, demand 0.15, mode choice on and the bundled controls, from 07:00
to 10:00. A scratch replay clearing only the compiled US priority flag reproduces the
historical 5,342 completions, 1,755.9 s mean delay, 3,503.3 s worst visit and 53 failures.
It is a diagnostic control, not a fix or a gate run.

The trace follows the binding leader, refused exit's tail or occupied conflict zone.
It records the dependency chain just before each removal and at ten-second intervals
once the head has stood 120 s. A reported gridlock is a trip that reaches its fourth
recovery event, not necessarily a closed cycle of vehicles. The table groups trips by
the predominant pattern in the last minute of their final hold. Spillback is split by
whether one or more downstream refusals counted a crossing on an exit that had enough
room before it.

| Pattern | Pinned base (54) | Historical (53) | Where and why |
| --- | ---: | ---: | --- |
| Spillback with usable space before a crossing | 40 | 40 | The largest cluster backs out of Service Road (`r:3742`, `n:1803`) through `r:1804` and `r:1802` into the west-side service and parking-aisle grid (`n:4378`, `n:5620`, `n:5630`). Also Central Parking Access Road (`r:3440`, `n:3179`) and the Lexington, Neptune, Bremen, Porter and Chelsea Street queues. The keep-box-clear test measures from the far edge of the crossing even when a car can wait entirely short of it. |
| Other spillback | 13 | 11 | East Boston streets including Maverick/Everett, Castle Court, Brooks/White and Princeton, the Airport Road approach (`r:4352#0>r:4353#0`) and the Mass Pike airport approach (`r:4335#1`, `n:4177`). Full exit tails, turning conflicts and signals propagate queues back to the failing head. No common, isolated obstruction inside a tunnel or at a terminal kerb was found. |
| Predominantly a closed cycle | 1 | 1 | A Shelby Street head at `n:460` waits on the Lexington/East Eagle loop. Storage at `r:462#0`, `r:2504#0` and `r:617#0`, and a conflicting occupant at `n:616`, close the wait chain. The historical Lexington Street failure fed into the same ring. |
| Following and keep-clear without a dominant exit refusal | 0 | 1 | Cottage Street (`r:1032`, `n:1034`) backs up behind `r:1036` near Economy Parking. A vehicle already on the intervening movement waits on the stopped lane tail, leaving the failed head short of the keep-clear band. |

At `n:1803`, car 4211 has 13.89 m of exit rear clearance at the final refusal into
`r:3742#0`. Its 6.50 m body-plus-gap fits before the 8.57 m near edge, but the rule
requires 17.57 m by adding the far edge of the band. Farther upstream, car 5627 cannot
enter `r:5623#0` with just 0.37 m of clearance. The trace reaches the same Service Road
queue through `r:4379#0`, `r:1802#0` and `r:1804#0`, so changing only where 5627 waits
does not create room.

Two final-removal snapshots show a closed loop. The Shelby Street loop is
`11057/r:462#0 → 8676/r:2504#0 → 2432/r:2504#0 → 1502/r:617#0 → 7148/r:617#0 → 8900/r:617#0>r:2819#0 → 4966/r:3530#0 → 11057`.
The other is a late service-aisle loop during a wait otherwise dominated by spillback
`4665/r:5621#0 → 8441/r:5637#0 → 9392/r:5637#0 → 8102/r:5637#0 → 6487/r:5646#0 → 10981/r:5646#0 → 9720/r:5621#0 → 4665`.
These are backpressure through short road and movement sections, not failures in the
airport fleet or the parking manoeuvre controller. Across all 216 recovery events for
the failing trips, the immediate reasons are 128 physical storage refusals, 69
crossing-reserve-only refusals, 13 movement/approach conflicts and 6 other holds.

The per-trip and per-attempt tables in `D:/cityflows-wt/330-pilot/R/t379` give the four
attempts for each trip with vehicle IDs, lanes and nodes, the traced root and any cycle.
See `history-failures.csv` and `history-failed-trip-attempts.csv` on the base, and the
`legacy-` equivalents for the historical replay. The JSONL contains the underlying
positions, gaps, signal decisions and times.

### Rules tried and Boston result

- **V1, staging after a wait.** A crossing no longer excludes usable storage before its near
  edge after a 10 s junction wait. This requires the whole vehicle and gap to fit before the
  first keep-clear band and behind the queue's actual rear, not a forecast. The wait survives
  grant-to-entry rechecking. Existing signal, conflict and walker checks still apply. A
  synthetic T53 extension failed on main and passed on V1: its third car could stop in the
  pocket without blocking either the movement or the stripes. Boston had one fewer failure,
  but completed ten fewer trips and had 43.3 s more mean delay and 569.8 s more worst
  road wait. This was not a passing Boston improvement.
- **V2, immediate staging on ordinary junctions.** Count a pocket when the whole body can
  stand short of the first band and there is an actual following gap. Look for that stand from
  the movement as well as the lane, allowing the driver to brake before reaching the seam.
  Junction-group admission stays on the original rule. Boston completed 325 more trips, but
  had three more gridlocks, 27.0 s more mean delay and 625.1 s more worst road wait. London
  City also regressed. No third variant was tried.

| Boston morning, 07:00–10:00 | Completed | Gridlocked | Mean delay (s) | Worst visit (s) | Landside state hash |
| --- | ---: | ---: | ---: | ---: | ---: |
| TASK-374 historical replay | 5,342 | 53 | 1,755.9 | 3,503.3 (`r:458`) | `4069965362` |
| Pinned base | 5,558 | 54 | 1,734.6 | 3,216.0 (`r:458`) | `769927346` |
| V1 | 5,548 | 53 | 1,777.8 | 3,785.8 (`r:458`) | `3353623034` |
| V2 | 5,883 | 57 | 1,761.6 | 3,841.1 (`r:458`) | `2445226648` |

All four runs had zero stalled heads and no other failures. Running the pinned base
and V1 with the airport enabled reproduced their road outcomes exactly (combined
state hashes `755501464` and `1291589504`). V2 was screened road-only in Boston.
These results show that using the pocket can let an individual car clear the
intersection, but does not relieve the larger queue enough to pass the gates.

### Owner's merge rule

| Required screen | Pinned base | V1 | V2 |
| --- | --- | --- | --- |
| Boston probe improvement | 54 gridlocks, 1,734.6 s mean, 3,216.0 s worst | Fail, 53 / 1,777.8 / 3,785.8 | Fail, 57 / 1,761.6 / 3,841.1 |
| London City, 0.15 | 1,993 completed, 385.7 s mean, 822.3 s worst, 0 gridlocks | Pass, 1,996 / 383.5 / 672.9 / 0 | Fail, 1,988 / 625.3 / 902.7 / 2 |
| Freiburg, seed 1 | 1,527 completed, 61.0 s mean, 199.5 s worst, 0 gridlocks | Pass, identical (`55277987`) | Pass, 1,526 / 62.4 / 199.5 / 0 (`197947251`) |

| Full merge-rule check | Result |
| --- | --- |
| Munich at 0.15, four configurations and twelve seeds | Not run. Neither variant passed the screen. |
| Munich full demand, both modes and five seeds | Not run. Neither variant passed the screen. |
| Munich drain, Sindelfingen and the remaining showcase mornings | Not run for either variant. |
| Geometry audit | Not applicable. Neither variant changed the compiled network. |

The rejected V1 and V2 patches and the V2 probe loader are in scratch.
No OSM, per-id curation, threshold, re-pin, dependency, traffic baseline or panel
changes are retained.

### Verification on the unchanged simulator

Fresh seed 1 aircraft reports from `bench/airside-delay.ts --checks` match the base in
every field except wall-clock time. The aircraft-only bench is separate from the
combined Boston morning above.

| Airside case | Completed / scheduled | Mean / worst delay (s) | Diverted / cancelled | Overlaps / real runway conflicts | Comparison |
| --- | ---: | ---: | ---: | ---: | --- |
| Heathrow peak, 06:00–08:00 with drain | 145 / 188 | 1,726.5 / 6,103.5 | 0 / 0 | 0 / 0 | Identical |
| Boston day | 992 / 1,000 | 489.4 / 6,181.5 | 3 / 1 | 0 / 0 | Identical |

| Command | Final lines |
| --- | --- |
| `npm run check` | `Test Files 307 passed \| 1 skipped (308)` · `Tests 2213 passed \| 2 skipped (2215)` · `✓ built in 3.62s` |
| `npm run test:city` | `Test Files 77 passed (77)` · `Tests 292 passed \| 1 skipped (293)` · `Duration 2236.02s` |
| `npm run test:traffic:light` | `Test Files 2 passed (2)` · `Tests 5 passed \| 1 expected fail (6)` · `Duration 320.45s` |
| `npm run test:e2e:light` | `63 passed (4.8m)` on port 5393 |

The logs and JSON reports are in `D:/cityflows-wt/330-pilot/R/t379/out`.
