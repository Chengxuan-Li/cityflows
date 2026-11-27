# TASK-378 — London City: mean road delay nearly doubled with TASK-279

Status: parked 2026-11-27 (branch `task/378-lcy-delay` at `8920c953`): London City 385.7 to 249.4 s, but the merge rule fails (Munich 0.15 actuated choice off +5.5%, fixed off +3.9%; full demand fixed +6.9%). Started by the lead in the 10 h unsupervised run; city work merges under the traffic merge rule and the audit
tolerance). Owner: Codex (gpt-6.2-sol, high). Base: main `8aa8063e`.

## Finding (TASK-279, TASK-372)

TASK-279 (unmarked crossings: walkers yield except to drivers turning into the arm) raised London City's showcase
mean delay from 210.2 to 385.7 s. The worst visit moved from 801.5 s on `r:2253` to 822.3 s on `r:274`, close to the
900 s limit. Fewer walker priorities should not slow vehicles this much. TASK-372's UK turn-out yield then gridlocked
one trip (worst visit 1,472.7 s on `r:6`).

## Goal

1. Find where the extra delay comes from: per road and node, main before TASK-279 (`cf907113^1`) against main, the
   vehicle seconds lost by cause (walker yields, signal, conflict, queue spill-back, parking search). Name the top
   five places, with what holds the vehicles there.
2. Fix the largest cause by an app rule that holds for every city (OSM rule: no per-id curation, no OSM edits). If the
   cause is a defect in TASK-279's gap or turn-into rule, fix it there. Report whether the UK turn-out yield of
   TASK-372 (branch `task/372-walker-country`, `ec1ebd5d`) would then pass, as a measurement only.

## Scope

`src/sim/walkers.ts`, `src/sim/**` where the cause lies, `src/network/walk.ts`, tests, re-pins.

Out of scope: gate floors, `bench/traffic-baseline.json`, OSM edits, per-id curation, signal programs unless the cause
is one (then stop and report).

## Gates

- The owner's merge rule: Munich 0.15 seeds 1–12, four configurations, within 3%; full demand within 2% on the mean of
  seeds 1–5, both modes; Freiburg within 5 s; drain; Sindelfingen; all showcases pass.
- London City mean delay and worst visit against main (target: well under 900 s, mean toward 210 s).
- If the compiled network changes: the geometry audit within tolerance.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result

**The London City fix works, but V2 fails the owner's merge rule. Keep it out of main.**
Full-demand fixed-time Munich averages 1,919.8 s against 1,796.3 s on main (+6.88%, limit
+2%). At 0.15 demand, both Munich configurations with mode choice off also miss the +3%
delay limit. V1 failed London City, and no third variant was tried.

### Diagnosis

The London City replay uses seed 1, demand 0.15, mode choice on and bundled controls from 07:00 to
10:00. The contract's `cf907113^1` is `9e3ad793`, the rerun's merge commit, which already contains
TASK-279. Its traced output and state hash matched pinned main `c9fd35ef` byte for byte. The merged
main parent, `8342af78`, is the actual before case and reproduces TASK-279's 210.2 s result.

A scratch-only trace samples the binding obstacle at each simulated second, weighting by
`max(0, 1 − speed / desired speed)`. Each observation counts once. A following vehicle counts
as queue or spillback, not as another direct signal, conflict, walker or parking stop. A movement
is attributed to its approach road. These vehicle seconds describe slow and stopped road traffic,
not the exact trip-delay metric, which also includes the route driven and compares completed
trips to their free-flow times. The separate parking-search clock can overlap traffic delay.

| Binding cause, whole city | Before TASK-279 (vehicle-s) | Main (vehicle-s) |
| --- | ---: | ---: |
| Following queue or spillback | 293,803 | 616,906 |
| Red/amber signal refusal | 9,070 | 14,231 |
| Movement, gap, merge or occupied-zone conflict | 4,125 | 7,722 |
| Parking entrance, manoeuvre or crossing | 3,072 | 3,020 |
| Direct walker yield (exact step counter) | 1,528 | 1,515 |
| Other junction stop, no matched refusal | 22,036 | 23,137 |
| Parking search (elapsed, not additive) | 5,423 | 9,646 |

The top-five roads below are ranked by increase in attributed loss across all causes. The node
is the downstream junction. Of the sampled increase, about 97% was following queues or
spillback. The five greatest node increases were `n:174` (+51,699), `n:327` (+34,512),
`n:167` (+26,625), `n:258` (+18,681), and `n:268` (+13,308).
At `n:268`, the queued Albert Road exit `r:2253` holds both `r:2259` and Woolwich Manor Way
`r:274`, which has main's worst single visit.

| Place | What holds the vehicles | Before TASK-279 (vehicle-s) | Main (vehicle-s) |
| --- | --- | ---: | ---: |
| Albert Road `r:6` → `n:174` | Filled short exit `r:2259` toward Woolwich Manor Way and Milk Street `r:176` | 65,211 | 115,365 |
| Rymill Street `r:330` → `n:327` | Group 20's Pier Road exit backs up into the approach. The chain reaches Woodman Street `r:166` | 4,401 | 38,894 |
| Albert Road `r:1552` → `n:167` | Full Pier Road `r:169` and Albert Road `r:2261` exits | 8,731 | 28,435 |
| Woodman Street `r:843` → `n:258` | Full Albert Road `r:2412` exit, with queues extending back from `n:810` | 32,983 | 49,902 |
| Brixham Street `r:475` → `n:365` | Queue spills back from Dockland Street `r:366` waiting for Rymill Street `r:330` | 49 | 12,900 |

The heaviest chain from `r:330` reaches the Pier Road admission into `r:166`. There,
the stop-line head could fit its whole body and gap, but the static rule demanded extra
room past an unmarked band. The same refusal held entries into `r:330` at the next
junction upstream. Across the city, the sampled loss at heads refused solely for crossing
storage grew from 10,475 to 30,065 vehicle seconds, before counting their followers. The static reservation
was present before TASK-279, but the change in traffic timings made its spillback much worse.
Albert Road also queues behind normal red and storage holds at `n:810`. There is no
evidence that the signal program itself or a single walker stop is defective.

### Rule and London City gate

An ordinary unmarked crossing does not reserve a permanent gap in a vehicle queue. V1
applied this to admission only. It still made vehicles stop short of the unmarked span
once admitted, so admission and queue storage disagreed. V2 applies one predicate to
admission and the keep-clear zones. Marked crossings, signal crossings, US junction
crossings with zebra-like priority and parking-mouth zones keep their protection. A car
still needs room for its whole body and gap. Walkers' gap, turn-in, occupancy and active
hold checks are unchanged.

| London City | Completed | Mean delay (s) | Worst visit (s) | Gridlocks / stalled | Gate |
| --- | ---: | ---: | --- | ---: | --- |
| Before TASK-279 | 1,998 | 210.2 | 801.5 (`r:2253`) | 0 / 0 | Pass |
| Pinned main | 1,993 | 385.7 | 822.3 (`r:274`) | 0 / 0 | Pass |
| V1, admission only | 1,992 | 420.0 | 1,026.6 (`r:6`) | 0 / 0 | Fail |
| V2, consistent queue rule | 1,999 | 249.4 | 721.5 (`r:843`) | 0 / 0 | Pass |
| Main + TASK-372 H2 | 1,988 | 705.6 | 1,472.7 (`r:6`) | 1 / 0 | Fail |
| V2 + TASK-372 H2 | 1,999 | 257.9 | 1,043.5 (`r:843`) | 0 / 0 | Fail |

V2 recovers about 78% of the excess mean delay. Sampled queue loss drops from 616,906 to
363,520 vehicle seconds, including 38,894 to 2,682 seconds of all attributed loss on
Rymill Street and 12,900 to 24 seconds on Brixham Street. The two unmarked crossing
storage refusals traced above disappear, while actual lack of body room still refuses
entry at Pier Road. Parking-search time drops from 9,646 to 5,216 vehicle seconds.
Freiburg's 61.0 s gate becomes 60.3 s in V1 and 62.7 s in V2, with 1,527 completions
and no failures or stalled heads in each. V2's Freiburg worst visit is 186.5 s on `r:1348`.

Only V2 was eligible for the full merge-rule comparison. H2 was replayed with the gap-gated
turn-out rule from `ec1ebd5d`, scratch only. It no longer gridlocks on V2 but still misses
the strict 900 s limit. It is not part of the fix.

The common predicate needs `src/network/keep-clear.ts`, which supplies the derived queue
zones and does not alter the compiled graph or rendered markings. No geometry audit
was required. No OSM, fixtures, signal programs, thresholds, traffic baseline or
dependencies changed.

### Owner's merge rule

The comparison is pinned main `c9fd35ef` versus V2. All 96 light runs meet the
TASK-154 drain checks (ring under 300 s, watched visit at most 900 s, no inner over-box
at 10:00 and no stalled head). The full-demand gate compares the unweighted means of
seeds 1–5, by signal mode. Freiburg is within +5 s, Sindelfingen passes and all seven
official bundled showcases pass. Heathrow is advisory.

#### Munich at 0.15, 07:00–10:00

| Signals | Choice | Pairs | Mean delay (s) | Δ | Mean completed | Drain passing | Gridlocked trips | Gate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Actuated | off | 12/12 | 607.5 → 640.7 | +5.47% | 5,312.5 → 5,312.1 | 12 → 12 | 0 → 5 | FAIL |
| Actuated | on | 12/12 | 86.7 → 88.6 | +2.18% | 2,552.2 → 2,552.5 | 12 → 12 | 0 → 0 | PASS |
| Fixed | off | 12/12 | 788.9 → 819.4 | +3.87% | 5,305.2 → 5,304.8 | 12 → 12 | 7 → 6 | FAIL |
| Fixed | on | 12/12 | 124.2 → 124.5 | +0.24% | 2,529.9 → 2,530.2 | 12 → 12 | 0 → 0 | PASS |

#### Munich at full demand, choice off

| Signals | Pairs | Mean delay (s) | Δ | Mean completed | Mean failed | Mean stalled heads | Gate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Actuated | 5/5 | 1,758.0 → 1,775.7 | +1.01% | 3,572.6 → 3,465.6 | 160.4 → 163.2 | 1.8 → 1.6 | PASS |
| Fixed | 5/5 | 1,796.3 → 1,919.8 | +6.88% | 3,222.4 → 3,395.8 | 168.6 → 153.4 | 2.4 → 3.2 | FAIL |

#### Freiburg and Sindelfingen

Each cell is mean delay in seconds / completions / failures / stalled heads / state hash.

| City and seed | Main | V2 |
| --- | --- | --- |
| Freiburg 1 | 61.0 / 1527 / 0 / 0 / `55277987` | 62.7 / 1527 / 0 / 0 / `3849074831` |
| Freiburg 2 | 57.3 / 1503 / 0 / 0 / `82669502` | 58.1 / 1503 / 0 / 0 / `170835066` |
| Freiburg 3 | 59.1 / 1527 / 0 / 0 / `1930469067` | 60.5 / 1526 / 0 / 0 / `3958054599` |
| Sindelfingen 1 | 17.1 / 444 / 0 / 0 / `3304791903` | 17.3 / 444 / 0 / 0 / `2710469689` |

#### Bundled showcase mornings

| Showcase | Completed | Mean delay (s) | Worst visit (s) | Failed / stalled | Gate |
| --- | ---: | ---: | --- | --- | --- |
| Munich Donnersbergerbrücke | 2581 → 2575 | 84.0 → 92.1 | 562.0 (`r:2104`) → 389.7 (`r:1358`) | 0/0 → 0/0 | PASS |
| Sindelfingen A81 | 444 → 444 | 17.1 → 17.3 | 90.3 (`r:977`) → 89.5 (`r:977`) | 0/0 → 0/0 | PASS |
| Philadelphia Center City | 4679 → 4683 | 153.8 → 153.4 | 579.6 (`r:255`) → 564.9 (`r:255`) | 0/0 → 0/0 | PASS |
| Lübeck Altstadt | 2488 → 2488 | 119.5 → 122.7 | 78.9 (`r:1288`) → 101.0 (`r:1069`) | 0/0 → 0/0 | PASS |
| York city centre | 1801 → 1800 | 84.7 → 86.8 | 156.4 (`r:3109`) → 159.0 (`r:3109`) | 25/0 → 25/0 | PASS |
| London City Airport | 1993 → 1999 | 385.7 → 249.4 | 822.3 (`r:274`) → 721.5 (`r:843`) | 0/0 → 0/0 | PASS |
| Zurich Airport | 4277 → 4277 | 111.8 → 103.4 | 246.9 (`r:3407`) → 246.1 (`r:3407`) | 6/0 → 6/0 | PASS |
| London Heathrow Airport | 4033 → 4055 | 205.4 → 225.1 | 896.1 (`r:10331`) → 1127.3 (`r:10331`) | 36/0 → 36/0 | FAIL (advisory) |

### Verification

Re-pinned Freiburg's 10:00 state and the first minute at London City, Zurich and Heathrow.
All four airport compiled hashes, loaded states and flight boards match main.

| Command | Final lines |
| --- | --- |
| `npm run check` | `Test Files  307 passed \| 1 skipped (308)` · `Tests  2216 passed \| 2 skipped (2218)` · `✓ built in 1.96s` |
| `npm run test:city` | `Test Files  77 passed (77)` · `Tests  292 passed \| 1 skipped (293)` · `Duration  2453.65s` |
| `npm run test:traffic:light` | `Test Files  2 passed (2)` · `Tests  5 passed \| 1 expected fail (6)` · `Duration  367.68s` |
| `npm run test:e2e:light` | `63 passed (5.2m)` on port 5393 |
| Munich gate and mode-share guard | `Test Files  2 passed (2)` · `Tests  7 passed \| 1 expected fail (8)` |
| Airport startup pins | `Test Files  1 passed (1)` · `Tests  4 passed (4)` |

Raw output is in `D:/cityflows-wt/330-pilot/R/t378/out`, including road and node vehicle-second
CSV tables, the H2 replay, and the logs for the verification tiers.
