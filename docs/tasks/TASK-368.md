# TASK-368 — Inner roads without stub lane blocks (TASK-348 rule 1) without the Freiburg gridlock

Status: started 2026-11-26 (owner defaults; city work merges under the traffic merge rule and the audit tolerance).
Owner: Codex (gpt-6.2-sol, high). Base: main `8c8bfdb6`.

## Finding (TASK-348)

The 5 m trim floor binds on inner roads of junction groups: 69 of 105 in Munich, 30 of 32 in Sindelfingen and 121 of
151 in Freiburg. Those inner roads keep stub lane blocks, which add lane overlap (J1-hbf 31.12 m², J1-stefan
25.96 m²). TASK-348's rule 1 lifted the floor for inner roads (`INNER_LANE_M_PENDING`, 0.5 m) and chained movements
across the group. Measured on, it gridlocked Freiburg's gate: 16 trips, 62.8 to 74.5 s. It was switched off in
`86b1f702` (`INNER_LANE_M` is `MIN_LANE_M`; its test is skipped). TASK-347 has since drawn one surface per group, and
TASK-364 added continuations.

## Goal

Turn rule 1 on and reproduce the Freiburg gridlock. Find where and why the 16 trips lock: node, inner road, lanes,
movements, compared with main. Fix the cause with a general rule in `src/network`. Then run TASK-348's gates for rule
1.

## Scope

`src/network/compile.ts`, `lanes.ts`, `junctions.ts`, `continuity.ts`; the rule's tests; bundled-city rebuilds and
re-pins. Out of scope: `src/sim/**`, `src/schema`, signal programs, group membership (`split.ts`),
`bench/geometry-audit.ts`, `bench/traffic-baseline.json`, OSM edits, per-id curation.

## Gates

- The skipped rule-1 test runs and passes; one test for the fix that fails without it.
- Census: inner roads shorter than their cuts, 69 / 30 / 121, down to 0.
- J1 lane overlap to about 0; sharp corners not worse (geometry audit against main, audit tolerance).
- The owner's merge rule:
  - Munich 0.15 seeds 1–12, choice off and on, both signal modes, delay within 3%;
  - full demand within 2% on the mean of seeds 1–5, both modes;
  - Freiburg's gate within 5 s, no gridlock; drain criterion;
  - Sindelfingen, T53 and step time.
- Showcase gates; `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

If the first version misses, at most one variant, with both tables.

## Result

**Failed the Freiburg delay gate in both versions. Do not merge.** Measured against `8342af78`.
TASK-362 already removes the historical gridlock on this base. The 0.5 m floor still changes
traffic enough to miss the limit with or without the original movement curves.
The downstream-first candidate and re-pins are in `62bc06e3`.

Both variants passed the census, the Munich 0.15 drain criterion on all 48 runs, and the two
five-seed full-demand delay limits. V1 missed three Munich 0.15 delay limits and V2 missed two.
Both failed the geometry audit and the London City showcase. Sindelfingen and the six other
panel showcases passed their traffic gates. Freiburg passed the showcase drain checks but not
the separate 5 s delay limit. No third variant was attempted.

### Reproduction and diagnosis

The historical scratch checkout at `47f95ee1` reproduced the exact gate result from TASK-348:
1,464 completed, 16 gridlocked, 74.51 s mean delay, state hash `2951071857`. Re-importing with
only its floor changed back to 5 m gave 1,534 completed, zero gridlocked, 62.11 s. TASK-348's
reported main was 1,531 completed, zero gridlocked, 62.80 s. The floor-only comparison holds the
other TASK-348 changes fixed.

| Node / lane or movement | Historical 0.5 m run | Main `8342af78` vs raw floor on |
| --- | --- | --- |
| `n:18`, `r:1348#0`, `r:1348#0>r:1337#0` | Head 1290 stood from 07:50:53. The stop line is shared by the local signal and a tram crossing held by `n:39`. The actuated controls alternated without enough shared green. | This road and movement are outside the group and their lengths and lane map do not change. TASK-362 serves the held head. |
| `n:39`, `r:1059#1>r:1057#1`, inner `r:1057#1` and `r:1429` | Head 1444 stood from 07:50:50. The opposing queue spilled back through `n:44`'s `r:1285#1>r:1059#1`, then through `r:1284#1`, `r:668#1` and `r:666#1`. | `r:1057#1` 5.00 → 0.50 m and `r:1429` road block 5.00 → 0.50 m. `r:1059#1>r:1057#1` 6.75 → 9.00 m. Its lane map and conflict partners stay the same. |
| Upstream of `n:18`, including `n:204` | The `r:1348#0` queue propagated through `r:1333#0>r:1343#0` and back onto `r:897`. | The raw floor run on main had no gridlock at seed 1. |
| `n:1531`, `r:1548#0/#1>r:1533#0/#1` | Not the lock site. | Biggest extra stopped time at a single node in the raw floor run, +1,456 vehicle-seconds. The lane block on inner `r:1533` goes 5.00 → 0.50 m and the two entry curves grow from about 6.35 m to 7.69 m. Downstream at `n:1532` the raw refit adds a conflict between `r:1533#1>r:1708#1` and `r:2167#1>r:1826#0`. |

Historical failures by last road: `r:1333` 3, `r:1348` 2, `r:897` 3, `r:1059` 2,
`r:1512` 1, `r:1285` 2, `r:666` 1 and `r:1143` 2. The floor changed when vehicles
reached the coupled controls. It did not create a new circular lane connection. See
[TASK-362](TASK-362.md) for the controlled reproduction and the existing coordination fix.

On the current code the raw switch still raised Freiburg from 62.17 to 74.14 s at seed 1 with
zero gridlocks on either side. It had no gridlock or stalled heads at seeds 2–6 either. The raw
switch changed conflict partners for 165 movements without
adding or removing a movement. Two-second samples of speed loss and stops found changes across
multiple groups in addition to `n:1531`, not another instance of the historical lock. A fresh
import was required on each side because connectors use lane-relative positions. The old Freiburg
archive compiled against the raw switch reports invalid connector positions, including on `r:835`.

### Rule tested

Fit the curves, legal movements and original conflict zones before cutting the remaining stub.
Then move each covered slice of an inner lane into the adjacent movement and its pavement into
the member outline. The route through the group follows the same centreline, with a 0.5 m seam
when there is no exposed lane block. Rebase conflict offsets on the extended path and end merge
zones at the new shared-lane entry. V1 allocates the removed span proportionally to the two
remaining cuts. V2 takes the downstream cut first, keeping the original handoff from the incoming
movement where the downstream member can cover the stub. Neither changes signal programs,
group membership, turn permission, or simulation code.

The unskipped test and the new path-preservation test pass on V2. The latter compares a two-movement
group chain with the same fixture without the group. It checks the fitted curves, both shared
endpoints and the total path length, so the original 5 m lane and the raw movement refit cannot
pass it. The raw switch shortened the test chain by 1.93 m and refit both curves. Each candidate
preserved the chain length to floating-point precision.

### Census and geometry

Counted a retained stub when the compiled station span exceeded the part left by the two cuts
or the 0.5 m seam, whichever is greater, by over 0.05 m. The census passes in both versions.

| City | Inner roads | Main retained stubs | V1 | V2 | Seams at or under 0.55 m, V1 / V2 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Munich | 105 | 69 | 0 | 0 | 21 / 21 |
| Sindelfingen | 32 | 30 | 0 | 0 | 11 / 11 |
| Freiburg | 151 | 121 | 0 | 0 | 80 / 80 |

| Unmodified geometry audit | Main | V1 | V2 |
| --- | ---: | ---: | ---: |
| J1-hbf lane overlap (m²) | 31.12 | 6.06 | 6.44 |
| J1-stefan lane overlap (m²) | 25.96 | 25.96 | 25.96 |
| Freiburg lane overlap (m²) | 200.97 | 132.63 | 130.37 |
| Munich lane overlap (m²) | 192.26 | 192.26 | 192.26 |
| Sindelfingen lane overlap (m²) | 640.41 | 640.41 | 640.41 |
| Sharp corners, Freiburg / Munich / Sindelfingen | 60 / 15 / 25 | 59 / 15 / 26 | 60 / 15 / 26 |
| Through alignment worst far deviation, Freiburg (m) | 1.778 | 12.000 | 10.498 |
| Through alignment worst far deviation, Munich (m) | 4.116 | 7.020 | 10.501 |
| Through alignment worst far deviation, Sindelfingen (m) | 3.056 | 6.010 | 6.010 |

Both fail the audit tolerance. Hbf's `r:1185/r:973` overlap falls from 21.34 m² to 0.28 / 0.26,
but `r:405/r:460` still contributes 5.60 m². Stefan's two pairs (`r:1177/r:6` and `r:1177/r:745`)
are unchanged. At Sindelfingen the audit reports `r:592>r:397` and `r:1155>r:971` as sharp
where it did not on main, and drops `r:399>r:593`. The through-deviation regressions exceed 1 cm.

### Rebuilds and pins

Ran `bench/bundled-cities.ts` across all nine buildable cities for V2. Freiburg, Sindelfingen,
Philadelphia, Lübeck, York, Heathrow and Zurich changed bytes. Munich and London City rebuilt
byte-identically. Boston's held-out archive was not rebuilt. Re-pinned the Freiburg manifest,
morning state, rail endpoints and timetable hash, plus the Heathrow and Zurich archive SHA-256s.
All four airport compiled-graph and 600-step state pins moved, including Boston. No initial
state or flight-board pin changed. No OSM data, baseline, audit, simulation, signal program or
schema was edited.

### Traffic reference

Munich's canonical city and the entire compiled graph, including walk, were byte-equal between
`8342af78` and the already-measured TASK-364 variant in both forced signal modes. Neither has
airside traffic. Fresh seed-1 fixed and actuated full-demand runs matched the prior state hashes,
delay, completions and stalled heads exactly (`195989537` and `1395572477`). The other Munich
reference rows reuse that deterministic measurement. Both TASK-368 candidates run the same
07:00–10:00 workloads against this reference. Six main showcase rows come from the TASK-279 re-run
on the same clean `8342af78` checkout. London City, Freiburg and the separate Sindelfingen
full-demand reference were measured here.

### Verification

| Command | Result | Final lines |
| --- | --- | --- |
| Focused junction-lane tests | Pass | 1 file, 7 tests passed |
| `npm run check` | Fail | 18 files failed, 287 passed, 1 skipped. 22 tests failed, 2,174 passed, 1 skipped. 764.39 s. Typecheck, lint and format check passed before unit failures. |
| Standalone `npm run build` | Pass | `✓ built in 1.75s` |
| `npm run test:traffic:light` | Pass | 2 files passed. 5 tests passed, 1 expected fail. 301.52 s. T53: 1,934 / 1,852 completions, 0 / 0 gridlocked. |
| Airport-load pins | Pass | 1 file, 4 tests passed. 81.00 s. |
| `npm run test:e2e:light` | Pass | 63 passed (4.8m), using ports 5388/5389. |
| `npm run test:city` | Fail | 19 files failed, 58 passed. 26 tests failed, 265 passed, 1 skipped. 2,212.38 s. |

The check's unit failures include T38 junction surfaces and storage, T42 corner sharpness,
Sindelfingen routing, and existing geometry, marking and importer comparisons. These gates were
not loosened to accept either variant. The city tier found corresponding failures for Munich
and Freiburg, plus the London City showcase drain failure. The rebuilt archive freshness tests
and Freiburg's re-pinned gate assertions passed. The separate Freiburg delay limit is still red.

### Traffic merge rule

Cells give mean delay (seconds) / completed / gridlocked / stalled heads, plus drain for Munich 0.15.
Choice off for full demand, 07:00-10:00 throughout. Baseline is 8342af78.

**Munich 0.15, fixed, choice off**

| Seed | Main | V1 | V2 |
|---:|---:|---:|---:|
| 1 | 828.52 / 5301 / 0 / 0 / PASS | 728.94 / 5304 / 1 / 0 / PASS | 859.58 / 5298 / 1 / 0 / PASS |
| 2 | 777.77 / 5309 / 0 / 0 / PASS | 791.56 / 5311 / 0 / 0 / PASS | 820.08 / 5305 / 2 / 0 / PASS |
| 3 | 777.81 / 5309 / 1 / 0 / PASS | 835.14 / 5304 / 0 / 0 / PASS | 918.72 / 5311 / 0 / 0 / PASS |
| 4 | 802.98 / 5309 / 0 / 0 / PASS | 833.97 / 5303 / 1 / 0 / PASS | 700.56 / 5313 / 0 / 0 / PASS |
| 5 | 798.33 / 5302 / 0 / 0 / PASS | 814.36 / 5313 / 0 / 0 / PASS | 834.75 / 5309 / 0 / 0 / PASS |
| 6 | 984.73 / 5285 / 3 / 0 / PASS | 813.56 / 5301 / 0 / 0 / PASS | 877.65 / 5301 / 1 / 0 / PASS |
| 7 | 823.80 / 5309 / 1 / 0 / PASS | 788.83 / 5302 / 1 / 0 / PASS | 859.09 / 5303 / 2 / 0 / PASS |
| 8 | 778.46 / 5304 / 1 / 0 / PASS | 820.10 / 5309 / 0 / 0 / PASS | 830.00 / 5310 / 0 / 0 / PASS |
| 9 | 834.75 / 5306 / 0 / 0 / PASS | 891.20 / 5261 / 1 / 0 / PASS | 895.04 / 5293 / 0 / 0 / PASS |
| 10 | 873.04 / 5307 / 1 / 0 / PASS | 799.32 / 5302 / 0 / 0 / PASS | 846.21 / 5300 / 0 / 0 / PASS |
| 11 | 782.47 / 5308 / 1 / 0 / PASS | 899.08 / 5303 / 0 / 0 / PASS | 878.98 / 5305 / 0 / 0 / PASS |
| 12 | 775.40 / 5307 / 0 / 0 / PASS | 887.02 / 5304 / 1 / 0 / PASS | 794.87 / 5310 / 0 / 0 / PASS |
| Mean delay (s) | 819.84 | 825.26 | 842.96 |
| Change vs main | - | +0.66% | +2.82% |
| Drain passes | 12/12 | 12/12 | 12/12 |

State hash matches vs main, V1 / V2: 0/12 / 0/12

**Munich 0.15, fixed, choice on**

| Seed | Main | V1 | V2 |
|---:|---:|---:|---:|
| 1 | 128.96 / 2545 / 0 / 0 / PASS | 131.93 / 2539 / 0 / 0 / PASS | 129.06 / 2542 / 0 / 0 / PASS |
| 2 | 118.83 / 2500 / 0 / 0 / PASS | 122.02 / 2493 / 0 / 0 / PASS | 123.33 / 2490 / 0 / 0 / PASS |
| 3 | 121.26 / 2530 / 0 / 0 / PASS | 131.35 / 2522 / 0 / 0 / PASS | 129.53 / 2526 / 0 / 0 / PASS |
| 4 | 125.97 / 2539 / 0 / 0 / PASS | 127.58 / 2531 / 0 / 0 / PASS | 122.77 / 2532 / 0 / 0 / PASS |
| 5 | 126.49 / 2533 / 0 / 0 / PASS | 140.79 / 2518 / 0 / 0 / PASS | 135.99 / 2523 / 0 / 0 / PASS |
| 6 | 118.90 / 2582 / 0 / 0 / PASS | 131.85 / 2578 / 0 / 0 / PASS | 132.69 / 2579 / 0 / 0 / PASS |
| 7 | 120.37 / 2525 / 0 / 0 / PASS | 122.18 / 2516 / 0 / 0 / PASS | 126.71 / 2516 / 0 / 0 / PASS |
| 8 | 129.14 / 2512 / 0 / 0 / PASS | 145.58 / 2511 / 0 / 0 / PASS | 132.79 / 2514 / 0 / 0 / PASS |
| 9 | 139.31 / 2457 / 0 / 0 / PASS | 137.58 / 2458 / 0 / 0 / PASS | 133.98 / 2462 / 0 / 0 / PASS |
| 10 | 127.53 / 2494 / 0 / 0 / PASS | 126.91 / 2490 / 0 / 0 / PASS | 129.40 / 2489 / 0 / 0 / PASS |
| 11 | 114.49 / 2578 / 0 / 0 / PASS | 116.83 / 2565 / 0 / 0 / PASS | 116.93 / 2568 / 0 / 0 / PASS |
| 12 | 130.61 / 2538 / 0 / 0 / PASS | 126.95 / 2533 / 0 / 0 / PASS | 129.73 / 2531 / 0 / 0 / PASS |
| Mean delay (s) | 125.15 | 130.13 | 128.58 |
| Change vs main | - | +3.97% | +2.73% |
| Drain passes | 12/12 | 12/12 | 12/12 |

State hash matches vs main, V1 / V2: 0/12 / 0/12

**Munich 0.15, actuated, choice off**

| Seed | Main | V1 | V2 |
|---:|---:|---:|---:|
| 1 | 602.33 / 5311 / 1 / 0 / PASS | 662.02 / 5312 / 0 / 0 / PASS | 693.20 / 5312 / 0 / 0 / PASS |
| 2 | 584.28 / 5311 / 0 / 0 / PASS | 644.11 / 5311 / 0 / 0 / PASS | 665.69 / 5311 / 0 / 0 / PASS |
| 3 | 654.39 / 5312 / 0 / 0 / PASS | 644.90 / 5312 / 0 / 0 / PASS | 707.73 / 5311 / 1 / 0 / PASS |
| 4 | 615.83 / 5312 / 1 / 0 / PASS | 607.61 / 5313 / 0 / 0 / PASS | 617.10 / 5313 / 0 / 0 / PASS |
| 5 | 582.33 / 5313 / 0 / 0 / PASS | 673.11 / 5313 / 0 / 0 / PASS | 709.45 / 5313 / 0 / 0 / PASS |
| 6 | 715.09 / 5313 / 0 / 0 / PASS | 673.69 / 5295 / 0 / 0 / PASS | 689.05 / 5312 / 1 / 0 / PASS |
| 7 | 611.22 / 5313 / 0 / 0 / PASS | 671.27 / 5313 / 0 / 0 / PASS | 690.03 / 5313 / 0 / 0 / PASS |
| 8 | 644.88 / 5312 / 0 / 0 / PASS | 691.91 / 5311 / 1 / 0 / PASS | 685.37 / 5312 / 0 / 0 / PASS |
| 9 | 682.46 / 5313 / 0 / 0 / PASS | 692.90 / 5312 / 1 / 0 / PASS | 726.61 / 5313 / 0 / 0 / PASS |
| 10 | 631.56 / 5312 / 0 / 0 / PASS | 639.21 / 5311 / 1 / 0 / PASS | 688.01 / 5312 / 0 / 0 / PASS |
| 11 | 606.56 / 5312 / 1 / 0 / PASS | 625.46 / 5313 / 0 / 0 / PASS | 730.18 / 5313 / 0 / 0 / PASS |
| 12 | 607.23 / 5313 / 0 / 0 / PASS | 667.21 / 5313 / 0 / 0 / PASS | 678.23 / 5313 / 0 / 0 / PASS |
| Mean delay (s) | 628.18 | 657.78 | 690.05 |
| Change vs main | - | +4.71% | +9.85% |
| Drain passes | 12/12 | 12/12 | 12/12 |

State hash matches vs main, V1 / V2: 0/12 / 0/12

**Munich 0.15, actuated, choice on**

| Seed | Main | V1 | V2 |
|---:|---:|---:|---:|
| 1 | 96.11 / 2567 / 0 / 0 / PASS | 102.13 / 2567 / 0 / 0 / PASS | 98.22 / 2570 / 0 / 0 / PASS |
| 2 | 75.26 / 2531 / 0 / 0 / PASS | 80.27 / 2521 / 0 / 0 / PASS | 80.09 / 2522 / 0 / 0 / PASS |
| 3 | 91.61 / 2546 / 0 / 0 / PASS | 96.87 / 2536 / 0 / 0 / PASS | 90.42 / 2540 / 0 / 0 / PASS |
| 4 | 88.05 / 2551 / 0 / 0 / PASS | 90.66 / 2549 / 0 / 0 / PASS | 95.56 / 2543 / 0 / 0 / PASS |
| 5 | 86.98 / 2551 / 0 / 0 / PASS | 88.46 / 2542 / 0 / 0 / PASS | 93.29 / 2544 / 0 / 0 / PASS |
| 6 | 90.70 / 2605 / 0 / 0 / PASS | 90.50 / 2608 / 0 / 0 / PASS | 91.25 / 2608 / 0 / 0 / PASS |
| 7 | 86.50 / 2552 / 0 / 0 / PASS | 92.93 / 2543 / 0 / 0 / PASS | 88.52 / 2549 / 0 / 0 / PASS |
| 8 | 88.50 / 2550 / 0 / 0 / PASS | 92.49 / 2541 / 0 / 0 / PASS | 94.28 / 2543 / 0 / 0 / PASS |
| 9 | 89.49 / 2482 / 0 / 0 / PASS | 96.61 / 2480 / 0 / 0 / PASS | 105.89 / 2476 / 0 / 0 / PASS |
| 10 | 93.04 / 2510 / 0 / 0 / PASS | 96.75 / 2508 / 0 / 0 / PASS | 89.73 / 2507 / 0 / 0 / PASS |
| 11 | 81.55 / 2603 / 0 / 0 / PASS | 79.90 / 2597 / 0 / 0 / PASS | 83.61 / 2597 / 0 / 0 / PASS |
| 12 | 95.02 / 2553 / 0 / 0 / PASS | 89.77 / 2550 / 0 / 0 / PASS | 96.35 / 2547 / 0 / 0 / PASS |
| Mean delay (s) | 88.57 | 91.44 | 92.27 |
| Change vs main | - | +3.25% | +4.18% |
| Drain passes | 12/12 | 12/12 | 12/12 |

State hash matches vs main, V1 / V2: 0/12 / 0/12

**Munich full demand, fixed**

| Seed | Main | V1 | V2 |
|---:|---:|---:|---:|
| 1 | 1704.73 / 3502 / 147 / 1 | 1729.02 / 3360 / 153 / 1 | 1681.06 / 3406 / 166 / 2 |
| 2 | 1765.02 / 3340 / 172 / 1 | 1759.67 / 3063 / 170 / 2 | 1759.98 / 3199 / 162 / 3 |
| 3 | 1853.16 / 3282 / 157 / 2 | 1887.31 / 2926 / 170 / 0 | 1874.22 / 2774 / 182 / 2 |
| 4 | 1830.06 / 3064 / 165 / 1 | 1945.36 / 3281 / 175 / 1 | 1827.13 / 3122 / 170 / 0 |
| 5 | 1833.81 / 3266 / 163 / 4 | 1742.92 / 3013 / 162 / 0 | 1890.72 / 3338 / 144 / 1 |
| Mean delay (s) | 1797.35 | 1812.86 | 1806.62 |
| Change vs main | - | +0.86% | +0.52% |

State hash matches vs main, V1 / V2: 0/5 / 0/5

**Munich full demand, actuated**

| Seed | Main | V1 | V2 |
|---:|---:|---:|---:|
| 1 | 1865.23 / 3555 / 180 / 0 | 1783.89 / 3176 / 175 / 0 | 1677.01 / 3449 / 153 / 1 |
| 2 | 1723.83 / 3471 / 176 / 1 | 1765.29 / 3238 / 164 / 2 | 1781.33 / 3549 / 165 / 2 |
| 3 | 1749.42 / 3149 / 175 / 1 | 1791.25 / 3334 / 172 / 3 | 1828.47 / 3278 / 159 / 3 |
| 4 | 1704.41 / 3191 / 169 / 1 | 1748.87 / 3137 / 158 / 1 | 1735.42 / 3176 / 162 / 2 |
| 5 | 1723.61 / 3840 / 179 / 1 | 1751.66 / 3523 / 157 / 2 | 1627.16 / 3180 / 182 / 3 |
| Mean delay (s) | 1753.30 | 1768.19 | 1729.88 |
| Change vs main | - | +0.85% | -1.34% |

State hash matches vs main, V1 / V2: 0/5 / 0/5

**Freiburg 0.15, bundled signal defaults and choice on. Seed 1 is the gate.**

| Seed | Main | V1 | V2 | V1 change | V2 change |
|---:|---:|---:|---:|---:|---:|
| 1 | 62.17 / 1526 / 0 / 0 | 76.68 / 1519 / 0 / 0 | 75.61 / 1519 / 0 / 0 | +14.51 s | +13.43 s |
| 2 | 58.18 / 1503 / 0 / 0 | 72.16 / 1498 / 0 / 0 | 71.20 / 1501 / 0 / 0 | +13.98 s | +13.02 s |
| 3 | 61.45 / 1526 / 0 / 0 | 82.07 / 1509 / 0 / 0 | 77.86 / 1511 / 0 / 0 | +20.61 s | +16.41 s |

**Bundled showcase demand, seed 1.** Cells add parking failures, worst visit (seconds, road) and
the showcase verdict. Freiburg's separate 5 s delay limit is assessed above. Heathrow has an owner
exemption for the landside gate (TASK-354).

| City | Main | V1 | V2 |
|---|---:|---:|---:|
| freiburg | 62.17 / 1526 / 0 / 0 / 0 / 200 (r:1348) / PASS | 76.68 / 1519 / 0 / 0 / 0 / 248 (r:1348) / PASS | 75.61 / 1519 / 0 / 0 / 0 / 264 (r:1348) / PASS |
| munich-bundle | 96.11 / 2567 / 0 / 0 / 0 / 307 (r:2103) / PASS | 102.13 / 2567 / 0 / 0 / 0 / 488 (r:1358) / PASS | 98.22 / 2570 / 0 / 0 / 0 / 364 (r:978) / PASS |
| sindelfingen | 17.17 / 444 / 0 / 0 / 0 / 90 (r:977) / PASS | 17.45 / 444 / 0 / 0 / 0 / 90 (r:977) / PASS | 17.45 / 444 / 0 / 0 / 0 / 90 (r:977) / PASS |
| philadelphia | 160.74 / 4665 / 0 / 0 / 0 / 467 (r:61) / PASS | 162.99 / 4650 / 0 / 0 / 0 / 513 (r:61) / PASS | 159.78 / 4648 / 0 / 0 / 0 / 495 (r:1223) / PASS |
| luebeck | 126.18 / 2484 / 0 / 0 / 0 / 554 (r:400) / PASS | 119.87 / 2477 / 0 / 0 / 0 / 67 (r:1136) / PASS | 121.77 / 2480 / 0 / 0 / 0 / 148 (r:1069) / PASS |
| york | 87.18 / 1801 / 0 / 0 / 25 / 214 (r:3332) / PASS | 90.32 / 1795 / 0 / 0 / 25 / 161 (r:2994) / PASS | 89.71 / 1782 / 0 / 0 / 25 / 129 (r:3109) / PASS |
| london-city-airport | 210.15 / 1998 / 0 / 0 / 0 / 802 (r:2253) / PASS | 1153.57 / 1971 / 2 / 0 / 0 / 1111 (r:290) / FAIL | 1029.64 / 1978 / 0 / 0 / 0 / 1407 (r:6) / FAIL |
| zurich-airport | 110.79 / 4278 / 0 / 0 / 6 / 249 (r:3407) / PASS | 119.93 / 4274 / 0 / 0 / 6 / 387 (r:3407) / PASS | 118.13 / 4274 / 0 / 0 / 6 / 388 (r:3407) / PASS |

**Sindelfingen full demand, seed 1, choice off, default signals.**

| Metric | Main | V1 | V2 |
|---|---:|---:|---:|
| Delay / completed / gridlocked / stalled | 18.49 / 2965 / 0 / 0 | 18.85 / 2965 / 0 / 0 | 18.89 / 2965 / 0 / 0 |
| Wall ms per 0.1 s step (shared host) | 0.029 | 0.033 | 0.029 |

**Munich full demand step time, seed 1.** Measured wall time per simulation step on the shared host.

| Signal mode | Main (ms) | V1 (ms) | V2 (ms) |
|---|---:|---:|---:|
| fixed | 7.483 | 7.793 | 7.721 |
| actuated | 7.966 | 8.427 | 7.493 |
