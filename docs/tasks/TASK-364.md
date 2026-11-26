# TASK-364 — One-way to two-way continuations without the Munich full-demand loss (TASK-348 rule 3)

Status: started 2026-11-26 (owner defaults; bounded, Codex). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-348, 2026-11-26)

The owner decided that nodes where a one-way road becomes two-way are laid out as continuations, amending
`docs/architecture.md` §5.1. TASK-348 implemented this as rule 3:
- `08f5e139`: same lanes only;
- `a3db7964`: room for a 15 m taper.

The rule is switched off in `f65d75ff` because it failed the owner's merge rule. With rule 3, Munich's results were:

| Run | Without rule 3 | With rule 3 |
|---|---|---|
| Full demand, fixed time, mean of seeds 1–5 | 1,797.4 s, 3,291 completed | 1,891.8 s (+5.3%), 3,180 completed |
| 0.15 morning, actuated, mode choice on, seeds 1–5 | 87.6 s | 91.6 s (+4.6%) |

Rule 3 is the only change to Munich's network: Munich's signalised crossings are group members. The nodes it lays
out in Munich are, among others, `n:347`, `n:40`, `n:705`, `n:452` and `n:670`.

## Goal

1. Turn rule 3 on and find where the loss comes from. Compare per node, main against rule 3:
   - delay;
   - queue;
   - movements;
   - lane connections.

   A continuation may change:
   - which lanes connect;
   - the merge or taper length;
   - whether a node still holds vehicles;
   - turning movements that a junction layout allowed and a continuation drops.
2. Fix the cause with a general rule in the continuation layout. Examples:
   - keep the lane connections the junction layout gave;
   - lay out only nodes without turning movements;
   - a taper length by speed.
3. Measure the fixed rule under the owner's merge rule. If it misses, at most one variant, with both tables.

## Scope

The rule 3 code in `src/network` (`compile.ts`, `lanes.ts`, `junctions.ts`, as TASK-348 touched), its tests, the
Freiburg rebuild and pins, re-pins.

## Out of scope

`src/sim/**`, `src/schema`, the audit, `bench/traffic-baseline.json`, OSM edits, per-id curation.

## Gates

- Owner's merge rule against main:
  - Munich 0.15, seeds 1–12, both signal modes, choice off and on, delay within 3%;
  - full demand, mean of seeds 1–5, both modes, within 2%;
  - Freiburg gate within 5 s;
  - drain criterion;
  - all panel showcase gates.
- Geometry audit within the lead's tolerance (< 1 cm, < 1 m², one non-sharp corner).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result

### Reproduction and cause

Base `26f4d81a`. Re-enabled the original `ONE_WAY_CONTINUATIONS` switch with no other rule changes.
Imported with the matching compiler on each side. Live-compiling a main-cached import under the
rule is a different experiment, because import uses the compiled geometry for parking and place
connectors. Repeated the preliminary rule-on seed 1 runs with a fresh import. They match TASK-348's
state hashes, as do the other paired reproductions.

| Seed | Full demand, fixed, choice off, delay (s) | Completed | 0.15, actuated, choice on, delay (s) | Completed |
|---:|---:|---:|---:|---:|
| 1 | 1704.73 → 1824.93 | 3502 → 3275 | 96.11 → 94.33 | 2567 → 2570 |
| 2 | 1765.02 → 1868.82 | 3340 → 2981 | 75.26 → 79.98 | 2531 → 2529 |
| 3 | 1853.16 → 1797.86 | 3282 → 3149 | 91.61 → 89.34 | 2546 → 2543 |
| 4 | 1830.06 → 2004.49 | 3064 → 3412 | 88.05 → 94.32 | 2551 → 2555 |
| 5 | 1833.81 → 1962.82 | 3266 → 3085 | 86.98 → 100.20 | 2551 → 2544 |
| Mean | 1797.35 → 1891.78 (+5.25%) | 3290.8 → 3180.4 | 87.60 → 91.63 (+4.60%) | 2549.2 → 2548.2 |

Main → original rule below. Each cell under a demand setting gives **time loss / stopped vehicle-seconds
/ peak stopped vehicles**. Time loss is a two-second sample of `max(0, 1 − speed / lane speed limit)`
integrated over inbound lanes and their movements, excluding parking maneuvers. A stop is under
0.1 m/s. The first two entries are totals per run averaged over five seeds. Peak is the maximum
sample across the five runs. This is an approach measure, not the trip-delay gate.

| Munich node | Full fixed, choice off | 0.15 actuated, choice on | Lane connections (unchanged) | Movement length (m) |
|---|---:|---:|---|---:|
| `n:347` | 133 → 115 / 0 → 0 / 0 → 0 | 11.2 → 11.1 / 0 → 0 / 0 → 0 | `r:1082#0>r:349#0` | 4.95 → 0 |
| `n:40` | 48,159 → 46,319 / 44,288 → 42,550 / 6 → 6 | 11.2 → 10.0 / 0 → 0 / 0 → 0 | `r:1269#0>r:41#0` | 5.00 → 0 |
| `n:452` | 175,445 → 187,251 / 154,724 → 169,001 / 19 → 20 | 997.4 → 952.2 / 102.0 → 101.6 / 6 → 6 | `r:453#0>r:469#0` | 4.36 → 0 |
| `n:670` | 53,953 → 44,836 / 34,799 → 29,026 / 7 → 6 | 189.5 → 146.7 / 14.0 → 7.6 / 3 → 3 | `r:1300>r:671`, 0→0 and 1→1 | 9.83/9.74 → 0.004/0.012 |
| `n:705` | 181,306 → 182,729 / 118,435 → 118,129 / 22 → 22 | 490.4 → 488.7 / 0.8 → 0 / 1 → 0 | `r:706>r:1300`, 0→0 and 1→1 | 0/0 → 0/0 |

The original rule removes the cuts and outlines at exactly four Munich nodes. `n:705` was
already a continuation. The jog from `n:670` reaches across it onto `r:706`; the one-way arm
`r:1300` is only 16.92 m at 60 km/h, too short to contain a full 24 m taper. No lane connections,
turn types or conflicts are lost or added, including elsewhere in the compiled network.

The clearest local full-demand regression is `n:452`, an entry of junction group 23. It still
requires a group grant when the rule removes its movement length. The first movement plus inner
lane shrinks from 9.36 to 6.52 m even as `r:469#0` grows from 5.00 to 6.52 m. Group admission
uses those lengths to predict when the next vehicle will find room in the chain. The mean
exit-full refusals rise from 122,545 to 134,621 and box refusals from 1,622 to 4,008
(per-step attempts, not distinct vehicles). The short ramp shows redistribution between its
two seams, not a local queue increase at `n:670`. The sampled nodes alone do not explain the
entire network-level delay, particularly at 0.15 demand.

The one-factor ablations below are diagnostic only. Each retains the other original rule changes
and uses fixed-time full demand, seed 1. Preserving group cuts restores the local admission
behavior, but does not by itself restore the citywide mean. Protecting the short taper alone
leaves the group-entry congestion intact. The network-wide effect is not additive.

| Seed 1 diagnostic | Munich mean delay (s) | Completed | `n:452` stopped vehicle-s | `n:452` box refusals | `n:670` stopped vehicle-s |
|---|---:|---:|---:|---:|---:|
| Main | 1704.73 | 3502 | 151,734 | 2,063 | 34,772 |
| Original rule | 1824.93 | 3275 | 169,210 | 4,092 | 29,404 |
| Original, retaining group cuts | 1961.68 | 3428 | 154,470 | 1,500 | 29,160 |
| Original, requiring full taper room | 1782.72 | 3176 | 166,838 | 4,373 | 37,096 |

At `n:40`, the lanes already have TASK-093's step. Taking the cuts off nevertheless moves two
place connector positions and adds three roadside spaces on the incident roads. The first
candidate still does this after excluding `n:452` and `n:670`. Munich's fresh bundle manifest
fails the unchanged archive check. No other bundled archive was edited.

### First candidate

Keep junction-group members and uncontrolled seams with incomplete or non-order-preserving lane
maps in their existing layout. Only take a straight, full-lane, one-way seam if the full
TASK-080 speed-based taper fits in half the one-way road's length after the far cut. That keeps
both the group entry at `n:452` and the ramp at `n:670` as on main. It still converts two seams in
Munich, two in Sindelfingen and one in Freiburg. All five already have a TASK-093 lane step and
draw as a strip under TASK-347 on main.

The candidate clears the traffic thresholds. At `n:452`, full fixed-time mean stopped
vehicle-seconds fall from 169,001 with the original rule to 155,670 (main 154,724), and mean box
refusals fall from 4,008 to 1,514 (main 1,622). The full fixed-time trip-delay mean falls from
1,891.78 to 1,785.01 s (main 1,797.35 s).

The first candidate fails the archive check and the geometry tolerance. Across the audit cities,
no lane-overlap area, end-overlap area, maximum marking excursion, or sharp-corner count changes.
All named cases are unchanged. Outside marking length grows 35,324 → 35,334 m in Munich,
44,576 → 44,586 m in Sindelfingen and 15,029 → 15,034 m in Freiburg.

### One variant

In addition to the group, lane-map and taper-room guards, leave a seam alone where TASK-093
already moved the one-way lane block into alignment. In these cases TASK-347 draws the road
through the existing cuts, so there is no reason to repartition the movement or shift the
parking and access stations. The rule is not a blanket switch-off. A straight unstepped seam
still widens and aligns the same lanes in the synthetic test, and in the committed Zurich
project it converts two such seams. No production decision uses a node or road ID.

The variant's audit JSON is byte-identical to main for all cities and named cases
(SHA-256 `60fdd15f4c324d486fcbcab945e32672e8f757dc6ed0264d865e42c851d38915`).
The Freiburg rebuild is byte-identical as well. The in-memory fresh builds now match the
committed Munich and Lübeck archives, but York and Zurich still have different `city.json`
hashes. Neither archive is in scope for rebuild. No re-pin can make a stale archive current.

### Panel showcase gates

Both candidates passed all seven 0.15 morning traffic checks on the committed projects. The
fresh-build check is separate. All variant showcase runs had zero gridlocked trips, stalled heads,
or unroutable trips. York and Zurich had 25 and 6 parking failures respectively, within their
existing caps. Freiburg is reported with its own gate. Heathrow is exempt from the morning gate
by TASK-354, and Boston is held out of the panel.

| Project | v1 morning / fresh build | v2 morning / fresh build | v2 completed | v2 mean delay (s) | v2 worst visit (s) |
|---|---|---|---:|---:|---:|
| Munich | pass / fail | pass / pass | 2567 | 96.11 | 307.0 |
| Sindelfingen | pass / pass | pass / pass | 444 | 17.17 | 90.3 |
| Philadelphia | pass / pass | pass / pass | 4681 | 167.60 | 576.4 |
| Lübeck | pass / fail | pass / pass | 2484 | 126.18 | 553.8 |
| York | pass / fail | pass / fail | 1799 | 86.74 | 227.2 |
| London City Airport | pass / pass | pass / pass | 1998 | 210.15 | 801.5 |
| Zurich Airport | pass / fail | pass / fail | 4278 | 114.92 | 249.4 |

### Merge-rule measurements

Both candidates were run against `26f4d81a` to 10:00. Main is the same measured reference in both comparisons. The 0.15 drain uses TASK-154: no ring of 300 s or more, no loop visit over 900 s, no inner head over box-wait at 10:00, and no stalled head. Gridlocked trips are reported separately. Full demand uses mode choice off in both signal modes.

**Munich 0.15, all 12 paired seeds in each configuration.**

| Configuration | Main mean (s) | v1 mean (s) | v2 mean (s) | v1 change | v2 change | v1 drain | v2 drain |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed time, choice off | 819.84 | 808.05 | 819.84 | -1.44% | +0.00% | 12/12 | 12/12 |
| Fixed time, choice on | 125.15 | 125.09 | 125.15 | -0.05% | +0.00% | 12/12 | 12/12 |
| Actuated, choice off | 628.18 | 614.33 | 628.18 | -2.21% | +0.00% | 12/12 | 12/12 |
| Actuated, choice on | 88.57 | 89.40 | 88.57 | +0.94% | +0.00% | 12/12 | 12/12 |

Main drain: 48/48. Seed cells give **delay in seconds / completed / gridlocked / stalled heads / drain**.

**Fixed time, choice off.** State hashes equal to main in 0/12 v1 and 12/12 v2 runs.

| Seed | Main | v1 | v2 |
|---:|---:|---:|---:|
| 1 | 828.52 / 5301 / 0 / 0 / PASS | 778.08 / 5302 / 0 / 0 / PASS | 828.52 / 5301 / 0 / 0 / PASS |
| 2 | 777.77 / 5309 / 0 / 0 / PASS | 810.27 / 5307 / 1 / 0 / PASS | 777.77 / 5309 / 0 / 0 / PASS |
| 3 | 777.81 / 5309 / 1 / 0 / PASS | 823.49 / 5303 / 1 / 0 / PASS | 777.81 / 5309 / 1 / 0 / PASS |
| 4 | 802.98 / 5309 / 0 / 0 / PASS | 760.61 / 5310 / 0 / 0 / PASS | 802.98 / 5309 / 0 / 0 / PASS |
| 5 | 798.33 / 5302 / 0 / 0 / PASS | 806.57 / 5310 / 0 / 0 / PASS | 798.33 / 5302 / 0 / 0 / PASS |
| 6 | 984.73 / 5285 / 3 / 0 / PASS | 891.06 / 5304 / 2 / 0 / PASS | 984.73 / 5285 / 3 / 0 / PASS |
| 7 | 823.80 / 5309 / 1 / 0 / PASS | 816.29 / 5313 / 0 / 0 / PASS | 823.80 / 5309 / 1 / 0 / PASS |
| 8 | 778.46 / 5304 / 1 / 0 / PASS | 754.13 / 5310 / 1 / 0 / PASS | 778.46 / 5304 / 1 / 0 / PASS |
| 9 | 834.75 / 5306 / 0 / 0 / PASS | 879.13 / 5304 / 1 / 0 / PASS | 834.75 / 5306 / 0 / 0 / PASS |
| 10 | 873.04 / 5307 / 1 / 0 / PASS | 805.31 / 5305 / 0 / 0 / PASS | 873.04 / 5307 / 1 / 0 / PASS |
| 11 | 782.47 / 5308 / 1 / 0 / PASS | 745.74 / 5301 / 0 / 0 / PASS | 782.47 / 5308 / 1 / 0 / PASS |
| 12 | 775.40 / 5307 / 0 / 0 / PASS | 825.87 / 5300 / 0 / 0 / PASS | 775.40 / 5307 / 0 / 0 / PASS |

**Fixed time, choice on.** State hashes equal to main in 0/12 v1 and 12/12 v2 runs.

| Seed | Main | v1 | v2 |
|---:|---:|---:|---:|
| 1 | 128.96 / 2545 / 0 / 0 / PASS | 130.25 / 2543 / 0 / 0 / PASS | 128.96 / 2545 / 0 / 0 / PASS |
| 2 | 118.83 / 2500 / 0 / 0 / PASS | 119.29 / 2498 / 0 / 0 / PASS | 118.83 / 2500 / 0 / 0 / PASS |
| 3 | 121.26 / 2530 / 0 / 0 / PASS | 122.81 / 2531 / 0 / 0 / PASS | 121.26 / 2530 / 0 / 0 / PASS |
| 4 | 125.97 / 2539 / 0 / 0 / PASS | 123.24 / 2536 / 0 / 0 / PASS | 125.97 / 2539 / 0 / 0 / PASS |
| 5 | 126.49 / 2533 / 0 / 0 / PASS | 132.51 / 2528 / 0 / 0 / PASS | 126.49 / 2533 / 0 / 0 / PASS |
| 6 | 118.90 / 2582 / 0 / 0 / PASS | 122.17 / 2584 / 0 / 0 / PASS | 118.90 / 2582 / 0 / 0 / PASS |
| 7 | 120.37 / 2525 / 0 / 0 / PASS | 122.15 / 2522 / 0 / 0 / PASS | 120.37 / 2525 / 0 / 0 / PASS |
| 8 | 129.14 / 2512 / 0 / 0 / PASS | 130.59 / 2519 / 0 / 0 / PASS | 129.14 / 2512 / 0 / 0 / PASS |
| 9 | 139.31 / 2457 / 0 / 0 / PASS | 133.24 / 2465 / 0 / 0 / PASS | 139.31 / 2457 / 0 / 0 / PASS |
| 10 | 127.53 / 2494 / 0 / 0 / PASS | 129.70 / 2493 / 0 / 0 / PASS | 127.53 / 2494 / 0 / 0 / PASS |
| 11 | 114.49 / 2578 / 0 / 0 / PASS | 112.95 / 2575 / 0 / 0 / PASS | 114.49 / 2578 / 0 / 0 / PASS |
| 12 | 130.61 / 2538 / 0 / 0 / PASS | 122.23 / 2538 / 0 / 0 / PASS | 130.61 / 2538 / 0 / 0 / PASS |

**Actuated, choice off.** State hashes equal to main in 0/12 v1 and 12/12 v2 runs.

| Seed | Main | v1 | v2 |
|---:|---:|---:|---:|
| 1 | 602.33 / 5311 / 1 / 0 / PASS | 596.96 / 5312 / 0 / 0 / PASS | 602.33 / 5311 / 1 / 0 / PASS |
| 2 | 584.28 / 5311 / 0 / 0 / PASS | 628.12 / 5311 / 0 / 0 / PASS | 584.28 / 5311 / 0 / 0 / PASS |
| 3 | 654.39 / 5312 / 0 / 0 / PASS | 639.91 / 5312 / 0 / 0 / PASS | 654.39 / 5312 / 0 / 0 / PASS |
| 4 | 615.83 / 5312 / 1 / 0 / PASS | 556.56 / 5313 / 0 / 0 / PASS | 615.83 / 5312 / 1 / 0 / PASS |
| 5 | 582.33 / 5313 / 0 / 0 / PASS | 606.38 / 5313 / 0 / 0 / PASS | 582.33 / 5313 / 0 / 0 / PASS |
| 6 | 715.09 / 5313 / 0 / 0 / PASS | 641.66 / 5298 / 0 / 0 / PASS | 715.09 / 5313 / 0 / 0 / PASS |
| 7 | 611.22 / 5313 / 0 / 0 / PASS | 596.18 / 5313 / 0 / 0 / PASS | 611.22 / 5313 / 0 / 0 / PASS |
| 8 | 644.88 / 5312 / 0 / 0 / PASS | 646.43 / 5312 / 0 / 0 / PASS | 644.88 / 5312 / 0 / 0 / PASS |
| 9 | 682.46 / 5313 / 0 / 0 / PASS | 654.57 / 5313 / 0 / 0 / PASS | 682.46 / 5313 / 0 / 0 / PASS |
| 10 | 631.56 / 5312 / 0 / 0 / PASS | 602.78 / 5312 / 0 / 0 / PASS | 631.56 / 5312 / 0 / 0 / PASS |
| 11 | 606.56 / 5312 / 1 / 0 / PASS | 606.12 / 5313 / 0 / 0 / PASS | 606.56 / 5312 / 1 / 0 / PASS |
| 12 | 607.23 / 5313 / 0 / 0 / PASS | 596.27 / 5313 / 0 / 0 / PASS | 607.23 / 5313 / 0 / 0 / PASS |

**Actuated, choice on.** State hashes equal to main in 0/12 v1 and 12/12 v2 runs.

| Seed | Main | v1 | v2 |
|---:|---:|---:|---:|
| 1 | 96.11 / 2567 / 0 / 0 / PASS | 101.38 / 2573 / 0 / 0 / PASS | 96.11 / 2567 / 0 / 0 / PASS |
| 2 | 75.26 / 2531 / 0 / 0 / PASS | 78.79 / 2527 / 0 / 0 / PASS | 75.26 / 2531 / 0 / 0 / PASS |
| 3 | 91.61 / 2546 / 0 / 0 / PASS | 89.38 / 2546 / 0 / 0 / PASS | 91.61 / 2546 / 0 / 0 / PASS |
| 4 | 88.05 / 2551 / 0 / 0 / PASS | 81.20 / 2553 / 0 / 0 / PASS | 88.05 / 2551 / 0 / 0 / PASS |
| 5 | 86.98 / 2551 / 0 / 0 / PASS | 86.49 / 2547 / 0 / 0 / PASS | 86.98 / 2551 / 0 / 0 / PASS |
| 6 | 90.70 / 2605 / 0 / 0 / PASS | 84.67 / 2618 / 0 / 0 / PASS | 90.70 / 2605 / 0 / 0 / PASS |
| 7 | 86.50 / 2552 / 0 / 0 / PASS | 76.79 / 2555 / 0 / 0 / PASS | 86.50 / 2552 / 0 / 0 / PASS |
| 8 | 88.50 / 2550 / 0 / 0 / PASS | 96.86 / 2544 / 0 / 0 / PASS | 88.50 / 2550 / 0 / 0 / PASS |
| 9 | 89.49 / 2482 / 0 / 0 / PASS | 100.09 / 2481 / 0 / 0 / PASS | 89.49 / 2482 / 0 / 0 / PASS |
| 10 | 93.04 / 2510 / 0 / 0 / PASS | 88.80 / 2515 / 0 / 0 / PASS | 93.04 / 2510 / 0 / 0 / PASS |
| 11 | 81.55 / 2603 / 0 / 0 / PASS | 96.40 / 2599 / 0 / 0 / PASS | 81.55 / 2603 / 0 / 0 / PASS |
| 12 | 95.02 / 2553 / 0 / 0 / PASS | 91.94 / 2551 / 0 / 0 / PASS | 95.02 / 2553 / 0 / 0 / PASS |

**Munich full demand, five paired seeds per mode.**

| Configuration | Main mean (s) | v1 mean (s) | v2 mean (s) | v1 change | v2 change | v1 drain | v2 drain |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fixed time | 1797.35 | 1785.01 | 1797.35 | -0.69% | +0.00% | — | — |
| Actuated | 1753.30 | 1783.70 | 1753.30 | +1.73% | +0.00% | — | — |

Seed cells give **delay in seconds / completed / gridlocked / stalled heads**.

**Fixed time.** State hashes equal to main in 0/5 v1 and 5/5 v2 runs.

| Seed | Main | v1 | v2 |
|---:|---:|---:|---:|
| 1 | 1704.73 / 3502 / 147 / 1 | 1777.52 / 3342 / 184 / 4 | 1704.73 / 3502 / 147 / 1 |
| 2 | 1765.02 / 3340 / 172 / 1 | 1881.94 / 3260 / 160 / 2 | 1765.02 / 3340 / 172 / 1 |
| 3 | 1853.16 / 3282 / 157 / 2 | 1770.41 / 3200 / 167 / 3 | 1853.16 / 3282 / 157 / 2 |
| 4 | 1830.06 / 3064 / 165 / 1 | 1839.21 / 3192 / 169 / 1 | 1830.06 / 3064 / 165 / 1 |
| 5 | 1833.81 / 3266 / 163 / 4 | 1655.96 / 3277 / 177 / 0 | 1833.81 / 3266 / 163 / 4 |
| Mean | 1797.35 / 3290.8 / 160.8 / 1.8 | 1785.01 / 3254.2 / 171.4 / 2.0 | 1797.35 / 3290.8 / 160.8 / 1.8 |

**Actuated.** State hashes equal to main in 0/5 v1 and 5/5 v2 runs.

| Seed | Main | v1 | v2 |
|---:|---:|---:|---:|
| 1 | 1865.23 / 3555 / 180 / 0 | 1844.10 / 3723 / 171 / 1 | 1865.23 / 3555 / 180 / 0 |
| 2 | 1723.83 / 3471 / 176 / 1 | 1769.45 / 3332 / 170 / 4 | 1723.83 / 3471 / 176 / 1 |
| 3 | 1749.42 / 3149 / 175 / 1 | 1686.27 / 3367 / 163 / 0 | 1749.42 / 3149 / 175 / 1 |
| 4 | 1704.41 / 3191 / 169 / 1 | 1855.14 / 3473 / 157 / 0 | 1704.41 / 3191 / 169 / 1 |
| 5 | 1723.61 / 3840 / 179 / 1 | 1763.54 / 3416 / 187 / 4 | 1723.61 / 3840 / 179 / 1 |
| Mean | 1753.30 / 3441.2 / 175.8 / 0.8 | 1783.70 / 3462.2 / 169.6 / 1.8 | 1753.30 / 3441.2 / 175.8 / 0.8 |

**Freiburg 0.15, bundled defaults, choice on.** Seed 1 is the gate. Seeds 2–3 are included as a cross-check.

| Seed | Main | v1 | v2 | v1 delay change | v2 delay change |
|---:|---:|---:|---:|---:|---:|
| 1 | 62.48 / 1528 / 0 / 0 | 62.48 / 1528 / 0 / 0 | 62.48 / 1528 / 0 / 0 | 0.00 s | 0.00 s |
| 2 | 57.46 / 1502 / 0 / 0 | 57.46 / 1502 / 0 / 0 | 57.46 / 1502 / 0 / 0 | 0.00 s | 0.00 s |
| 3 | 61.61 / 1526 / 0 / 0 | 61.61 / 1526 / 0 / 0 | 61.61 / 1526 / 0 / 0 | 0.00 s | 0.00 s |

Freiburg cells give delay / completed / gridlocked / stalled heads. State hashes equal to main in 0/3 v1 and 3/3 v2 runs.

### Tiers and verdict

| Command | First candidate (v1) | Variant (v2) |
|---|---|---|
| `npm run check` | Exit 1. Tests: 14 failed, 2175 passed, 2 skipped. | Exit 0. Tests: 2190 passed, 2 skipped. Vite built in 2.66 s. |
| `npm run test:city` | Exit 1. Tests: 22 failed, 269 passed, 1 skipped. | Exit 1. Tests: 2 failed, 289 passed, 1 skipped. |
| `npm run test:traffic:light` | Exit 0. Tests: 5 passed, 1 expected fail (311.08 s). | Exit 0. Tests: 5 passed, 1 expected fail (193.91 s). |
| `npm run test:e2e:light` | Exit 0. 63 passed (4.9m). | Exit 0. 63 passed (4.0m). |

The variant matched main in every recorded gate field, including the state hash, on all 61 paired
Munich and Freiburg runs. The two variant city-tier failures are the unchanged fresh-build
assertions for York and Zurich. Freiburg's archive, seed-1 state hash (`1766099943`), and test pins
stay unchanged. No tests were re-pinned and no baseline or gate was relaxed.

**Fail, parked.** The first candidate clears the traffic thresholds but misses geometry and
archive freshness. The one variant clears traffic, drain, the seven showcase mornings, and
geometry. Its required city tier remains red on the two stale archives outside this task's scope.
No second variant, push, or merge. Raw runs, audit JSON and tier logs are in
`D:/cityflows-wt/330-pilot/R/t364`.
