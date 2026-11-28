# TASK-381 — Queue reserves at unmarked crossings: why Munich needs them, and a rule that serves all three cities

Status: parked 2026-11-27 (diagnosis and screens `606381fd`; simulator unchanged): V2 (reserve on approaches, released on exits with room before the crossing) London City 385.7 to 209.7 s, Boston gridlocks 54 to 39, Munich fixed −6.6%, but Munich actuated +7.9% (seeds 1–3). Started by the lead in the 10 h unsupervised run; city work merges under the traffic merge rule and the audit
tolerance). Owner: Codex (gpt-6.2-sol, high). Base: main.

## Finding (TASK-378, TASK-379)

Two diagnoses point at the same rule: the keep-clear queue reserve at ordinary unmarked crossings (TASK-169 zones,
`src/network/keep-clear.ts`, `src/sim/keep-clear.ts`, engine admission and queue stops).

- **London City (TASK-378):** 97% of TASK-279's added delay is queue spillback. Without the reserve at ordinary
  unmarked crossings (branch `task/378-lcy-delay`, `8920c953`), London City goes 385.7 → 249.4 s, worst visit 722 s.
- **Munich, same change:**
  - 0.15 actuated, choice off: +5.5%;
  - 0.15 fixed, choice off: +3.9%;
  - full demand, fixed: +6.9%.
- **Boston (TASK-379, `7be89357`):** 40 of 54 gridlocks are spillback where the reserve beyond a crossing wastes room
  before it. Its pocket variants failed: one had worse delay, the other made London City fail.

Nobody has looked at where Munich loses without the reserve.

## Goal

1. On Munich (0.15 seeds 1–3, actuated and fixed, choice off; full demand seed 1, fixed), compare main with TASK-378 V2:
   - where the added delay forms (roads, nodes, crossings);
   - what holds the vehicles (a car stopped on a crossing blocking a junction exit, walkers held, a turning
     movement blocked, spill into a junction box);
   - which crossings matter. Table the top places.
2. Design one rule from that: for example, keep the reserve only where a car standing on the crossing would block a
   junction (the crossing is within one car length of a junction's conflict area), or only while a walker waits or
   approaches. Then apply it to London City, Boston and Munich. Ground it in a traffic rule where one exists (StVO §11(3)
   / §12, Highway Code rules 151 and 191, UVC). At most two variants.

## Scope

`src/sim/**` (engine admission, `keep-clear.ts`, `walkers.ts`), `src/network/keep-clear.ts`, tests, re-pins.

Out of scope: gate floors, `bench/traffic-baseline.json`, OSM edits, per-id curation, signal programs.

## Gates

- The owner's merge rule:
  - Munich 0.15, seeds 1–12, four configurations, within 3%;
  - full demand within 2% on the mean of seeds 1–5, both modes;
  - Freiburg within 5 s; drain; Sindelfingen; all showcases pass.
- Report London City (mean delay, worst visit) and the Boston morning probe (completed, gridlocks, mean delay).
- If the compiled network changes: the geometry audit within tolerance.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result

**Fail the screen. Park both variants.** V2 improves London City and cuts Boston gridlocks from
54 to 39, but Munich actuated mean delay rises 7.86% across the three screen seeds. No
simulation change is retained, and no candidate enters the full merge-rule matrix.

### Munich diagnosis

Paired 07:00–10:00 runs, choice off, compare `377da7cc` with TASK-378 V2 `8920c953`.
The `c9fd35ef` baseline artifacts from TASK-378 are directly comparable: the source,
benchmarks, fixtures, and tests at `377da7cc` are byte-identical. A scratch loader samples
the binding road obstacle at 1 s intervals, weighting each sample by `max(0, 1 − speed /
desiredSpeed)`. It follows the queue through the leader, refused exit's tail, or conflicting
movement occupant and records whether that blocker is slow (at most 0.5 m/s) and on an
unmarked span, and whether its rear is still on the movement. A chain may traverse several
crossings, so crossing-linked exposures are not additive or equivalent to trip delay.

TASK-378 V2 filters the shared keep-clear zone list, including the unmarked spans the
TASK-289 lot-arrival interlock reads. The historical comparison is therefore not an
isolated test of exit admission alone. Both TASK-381 candidates leave that interlock's
zone list unchanged.

Fixed seed 3 on main initially diverged under the 1 s instrumentation (`3370025531`);
plain direct and standard drain reruns both reproduced `3515920097`. Replaying both
sides at 2 s matched their historical hashes and is used below. All other light traces
matched their historical hashes on the first pass.

| Munich demand and signals | Seeds | Main → TASK-378 V2 mean delay (s), per seed | Mean change |
| --- | --- | --- | ---: |
| 0.15 actuated | 1–3 | 615.7 → 647.8 / 580.7 → 638.8 / 610.7 → 669.5 | +8.25% |
| 0.15 fixed | 1–3 | 704.8 → 812.4 / 831.7 → 799.9 / 840.9 → 790.9 | +1.09% |
| 1.00 fixed | 1 | 1,725.0 → 1,814.6 | +5.19% |

| Location | Main → V2, demand 0.15 actuated / fixed (vehicle-s per seed) | What the chain holds on |
| --- | --- | --- |
| Schrenkstraße, `n:180` exit to `r:762#0`, 4.66–7.16 m past the cut | 35 → 181,000 / 311 → 219,107 | The Schrenkstraße queue stops over the crossing and blocks exit admission. Farther down, the red and tram hold at `n:197` is the root. Turning entries from `r:181` and `r:183` queue back into Westendstraße and Ligsalzstraße. |
| Westendstraße, `n:189` exit to `r:191#0`, 6.27–8.77 m past the cut | 0 → 127,300 / 0 → 92,307 | An occupied exit holds Bergmannstraße's left turn (`r:1251#0`) and Westendstraße's through movement (`r:193#0`). The strongest chain ends at lot-mouth keep-clear stops on service road `r:765`, beyond `n:186`. |
| Ligsalzstraße, `r:760#0` at `n:178`, 46.31–48.81 m along the 54.77 m approach | 1,223 → 125,409 / 1,630 → 114,050 | A stopped leader covers the entry span. Ligsalzstraße's left into `r:181` waits for a queued exit. In the reverse direction of the chain, `r:759` and Schwanthalerstraße `r:60` cannot enter `r:760`. |
| Tulbeckstraße, `n:79` exit to `r:83#0`, 6.38–8.88 m past the cut | 109 → 100,660 / 431 → 105,895 | A full `r:83` holds the left turn from Ganghoferstraße `r:227`. The queue follows the through route to a lot-mouth keep-clear stop on Tulbeckstraße `r:86`. |

The location rows count exposure along the dependency chain, not only the first car's
stop. Direct sampled losses on Arnulfstraße `r:680` → `n:1303` increase by roughly 29,000
vehicle-s in each mode, almost all following a queue, not a crossing on that road. With
actuated control, Tulbeckstraße `r:90` → `n:85` rises by 20,831 and Ligsalzstraße `r:758`
→ `n:76` by 16,518. The node `n:76` receives queues from several arms. The actuated
box/exit-full refusals rise by about 54,000 vehicle-s and following loss by 279,000, while
the keep-clear stop category drops by 102,000. The fixed-time changes are +51,000,
+83,000 and −135,000 respectively. An admission refusal labelled `box` is not itself a
vehicle physically in the box. The principal exit witnesses above had their rears fully in
the exit lane. Their positions explain the storage refusal, but not a direct geometric
conflict with the crossing turn. Static reserve removal shifted where the queues form
and which approaches are metered.

Walkers were affected, but direct vehicle yields were not the main delay. Mean waiting
at unmarked crossings rose from about 1.6 to 5.5 s in the actuated light runs. At the
Fäustlestraße entry `r:761#0` (`n:55`), a walker often had to wait for a car standing on the
crossing. Direct sampled walker-related vehicle loss rose by about 1,300 vehicle-s in
the actuated runs and 1,000 in fixed time, far smaller than the storage and queue changes.

At full demand, V2 completes 3,388 trips instead of 3,178 while gridlocks drop from 173 to
139, so the delay averages also describe different completed cohorts. Direct following
loss rises by 790,663 vehicle-s, admission refusals labelled `box` or `exit-full` rise by
408,633, and direct walker-related loss rises by 35,044. Unmarked walker waits increase from
11.3 to 56.4 s. In all three V2 configurations, less than 1% of crossing-linked vehicle-s
show a slow blocker's rear still on a movement. The full-demand rear-on-movement exposure
nevertheless triples, from 63,034 to 184,607 vehicle-s, and is not safe to ignore.

| Munich full fixed location | Main → V2 (vehicle-s) | What holds traffic |
| --- | ---: | --- |
| `r:772` → `n:771` | 112 → 99,567 | Mostly following vehicle delay. The chain usually ends at another keep-clear stop on `r:1198`. |
| Landsberger Straße `r:1358` → `n:1365` | 135,766 → 229,756 | Following a queue down `r:1366` toward the `r:961` signal at `n:362`. |
| Landsberger Straße `r:644` → `n:1307` | 206,815 → 291,937 | Followers dominate, often ending at the `r:1308` keep-clear stop. |
| Trappentreustraße `r:255#0` on approach to `n:185` | 2,980 → 1,003,450 (chain exposure) | Standing queue covers the entry span. The turn from `r:209#0` is held mostly on box/storage refusals. |
| Luise-Ullrich-Straße `r:127#0`, exit from `n:125` | 76 → 647,813 (chain exposure) | Queued vehicles cover the span 6.02–8.52 m past the cut. This is a refused exit, not a vehicle across the conflicting movement. |
| Barthstraße `r:1182#0`, exit from `n:120` | 0 → 562,594 (chain exposure) | A stopped tail on the span 5.92–8.42 m past the cut blocks storage for traffic turning from `r:1179#0`. |

The most frequent full-demand walker obstruction is a stopped car on the Ligsalzstraße
approach to `n:369`, on `r:757#0`. This is consistent with using separate policies for a
junction approach and an exit where the body can fit before the crossing.

### Rules screened

Both variants keep the whole-body-plus-gap admission check. Marked and signal crossings,
parking-mouth zones and the separate parking-arrival interlock keep their existing protection.
Pedestrian gap acceptance, turn-in yields, active holds and US walker priority are unchanged.
The same queue policy governs exit admission and the queued stopping position.

- **V1, junction distance.** Keep the reserve on junction-group inner roads and where an
  unmarked span comes within 6.5 m of a lane cut with conflicting movements. The distance
  represents a 4.5 m design car and its 2 m standing gap.
- **V2, approach protection and an exit pocket.** Keep the static reserve on an unmarked
  approach span anchored to a conflicting junction and on group inner roads. On a junction
  exit keep it only when the span starts less than 5.0 m past the cut: a design car cannot fit
  there and stop 0.5 m before the span. The asymmetry keeps the upstream walker gap found
  in Munich and stops requiring empty space beyond Boston and London's set-back exits.

The keep-box-clear objective comes from Germany's **Straßenverkehrs-Ordnung §11(1)**.
The UK **Highway Code rules 151 and 192** give the pedestrian-clearance objective in slow
or queuing traffic. Neither specifies the simulator's storage distance or says that releasing
the static reserve is equivalent to keeping every unmarked crossing clear. **Uniform Vehicle
Code §§11-502–503** are the separate walker-priority rules used for TASK-373, not a basis for
changing that priority here.

### Screen

London City, Freiburg and Boston use demand 0.15, seed 1, choice on and bundled control
settings. Boston is the same landside-only morning as TASK-379. Munich uses choice off.
Each city cell is **completed / mean delay (s) / worst visit (s) / gridlocked**.

| City or configuration | Main | V1 | V2 |
| --- | --- | --- | --- |
| London City | 1,993 / 385.7 / 822.3 / 0 | 1,990 / 508.7 / 897.4 / 0 | 1,998 / 209.7 / 712.2 / 0 |
| Freiburg | 1,527 / 61.0 / 199.5 / 0 | 1,529 / 60.7 / 141.5 / 0 | 1,528 / 59.6 / 140.0 / 0 |
| Boston landside | 5,558 / 1,734.6 / 3,216.0 / 54 | 5,493 / 1,787.5 / 4,728.2 / 57 | 5,526 / 1,728.8 / 4,508.3 / 39 |
| Munich actuated, average delay of seeds 1–3 | 602.4 s | 630.3 s (+4.63%) | 649.7 s (+7.86%) |
| Munich fixed, average delay of seeds 1–3 | 792.4 s | 859.1 s (+8.41%) | 740.4 s (−6.57%) |

| Munich 0.15, choice off | Main mean delay (s) | V1 (s) | V2 (s) |
| --- | ---: | ---: | ---: |
| Actuated 1 | 615.7 | 582.7 | 590.2 |
| Actuated 2 | 580.7 | 623.6 | 706.4 |
| Actuated 3 | 610.7 | 684.5 | 652.6 |
| Fixed 1 | 704.8 | 842.6 | 674.6 |
| Fixed 2 | 831.7 | 792.8 | 799.4 |
| Fixed 3 | 840.9 | 941.8 | 747.1 |

All twelve candidate Munich screen runs meet the drain criteria. The gridlock totals are
0 / 0 / 1 in actuated mode and 4 / 3 / 5 in fixed mode (main / V1 / V2). Both variants
pass the Freiburg band and the London City visit limit, though V1 worsens London mean delay.
V2 reduces Boston's gridlocks but lengthens its worst visit by 1,292.3 s and completes 32
fewer trips. It does not make Boston a viable showcase.

The follow-up trace on TASK-381 V2's worst actuated Munich screen (seed 2) matches the
screen hash `573493359`. It still has 78,939 more vehicle-s of chain exposure at the
Tulbeckstraße exit `r:83#0` (`n:79`) and 41,395 more at the Ligsalzstraße exit `r:759#0`
(`n:76`). Neither is within the 5 m exit reserve. Following loss rises citywide by
555,787 vehicle-s. The narrower rule changes where the queues form but does not eliminate
the spillback observed in TASK-378 V2.

No candidate went through the 12-seed/four-configuration or five-seed/full-demand merge
tables, or the remaining showcase run. No compiled network changed, so the geometry audit
does not apply. No OSM, per-ID curation, signal programs, gate floors, traffic baseline,
fixtures, re-pins or dependencies changed. Both patches and the traces are under
`D:/cityflows-wt/330-pilot/R/t381`. The detached comparison worktree was removed after
unlinking its junction. The shared dependency target was left in place.

### Verification on the unchanged simulator

| Command | Final lines |
| --- | --- |
| `npm run check` | `Test Files 307 passed \| 1 skipped (308)` · `Tests 2213 passed \| 2 skipped (2215)` · `✓ built in 1.84s` |
| `npm run test:city` | `Test Files 77 passed (77)` · `Tests 292 passed \| 1 skipped (293)` · `Duration 2105.29s` |
| `npm run test:traffic:light` | `Test Files 2 passed (2)` · `Tests 5 passed \| 1 expected fail (6)` · `Duration 290.45s` |
| `npm run test:e2e:light` | `63 passed (4.5m)` on port 5393 |

## Merge (owner accepted V2, 2026-11-28)

V2 is the default on this branch from main `2d7fe75f`. The owner accepted the actuated
Munich delay trade-off for London City and Boston. None of the gate floors changed.

Cells are completed / mean delay (s) / worst visit (s) / gridlocked. City mornings use demand 0.15, seed 1, mode choice on and bundled controls. All measurements end at 10:00.

| Showcase or probe | Main | V2 | Main gate | V2 gate |
| --- | --- | --- | --- | --- |
| London City Airport | 1,993 / 385.7 / 822.3 / 0 | 1,998 / 209.7 / 712.2 / 0 | Pass | Pass |
| Freiburg | 1,527 / 61.0 / 199.5 / 0 | 1,528 / 59.6 / 140.0 / 0 | Pass | Pass |
| Boston Logan landside | 5,558 / 1,734.6 / 3,216.0 / 54 | 5,526 / 1,728.8 / 4,508.3 / 39 | Record only | Record only |
| Heathrow | 4,033 / 205.4 / 896.1 / 0 | 4,048 / 213.7 / 861.5 / 0 | Pass | Pass |
| York | 1,801 / 84.7 / 156.4 / 0 | 1,799 / 85.4 / 175.2 / 0 | Pass | Pass |
| Munich Donnersbergerbrücke | 2,581 / 84.0 / 562.0 / 0 | 2,573 / 97.6 / 370.1 / 0 | Pass | Pass |
| Sindelfingen A81 | 444 / 17.1 / 90.3 / 0 | 444 / 17.1 / 90.3 / 0 | Pass | Pass |
| Philadelphia Center City | 4,679 / 153.8 / 579.6 / 0 | 4,695 / 149.3 / 374.5 / 0 | Pass | Pass |
| Lübeck Altstadt | 2,488 / 119.5 / 78.9 / 0 | 2,487 / 125.5 / 179.6 / 0 | Pass | Pass |
| Zurich Airport | 4,277 / 111.8 / 246.9 / 0 | 4,278 / 112.2 / 246.9 / 0 | Pass | Pass |

Freiburg delay changed by -1.4 s (within the 5 s band).

Munich 0.15, actuated, mode choice off. Worst visit is on the six watched loop roads.

| Seed | Main | V2 | Drain, main → V2 |
| --- | --- | --- | --- |
| 1 | 5,312 / 615.7 / 268.6 / 0 | 5,311 / 590.2 / 176.5 / 1 | Pass → Pass |
| 2 | 5,311 / 580.7 / 247.1 / 0 | 5,311 / 706.4 / 354.9 / 0 | Pass → Pass |
| 3 | 5,312 / 610.7 / 231.9 / 0 | 5,312 / 652.6 / 264.0 / 0 | Pass → Pass |
| Mean completed and delay, max visit, total gridlocks | 5,311.7 / 602.4 / 268.6 / 0 | 5,311.3 / 649.7 / 354.9 / 1 | Delay +7.86% |

Munich 0.15, fixed, mode choice off. Worst visit is on the six watched loop roads.

| Seed | Main | V2 | Drain, main → V2 |
| --- | --- | --- | --- |
| 1 | 5,307 / 704.8 / 175.4 / 2 | 5,302 / 674.6 / 179.3 / 3 | Pass → Pass |
| 2 | 5,304 / 831.7 / 229.4 / 1 | 5,309 / 799.4 / 228.2 / 2 | Pass → Pass |
| 3 | 5,300 / 840.9 / 237.1 / 1 | 5,306 / 747.1 / 255.4 / 0 | Pass → Pass |
| Mean completed and delay, max visit, total gridlocks | 5,303.7 / 792.4 / 237.1 / 4 | 5,305.7 / 740.4 / 255.4 / 5 | Delay -6.57% |

Munich full demand, fixed, mode choice off. Worst visit is citywide.

| Seed | Main | V2 | Stalled heads, main → V2 |
| --- | --- | --- | --- |
| 1 | 3,178 / 1,725.0 / 10,500.1 / 173 | 3,265 / 1,763.9 / 10,489.1 / 166 | 5 → 5 |
| 2 | 3,032 / 1,842.9 / 9,636.7 / 182 | 3,200 / 2,021.1 / 10,200.2 / 160 | 0 → 2 |
| 3 | 3,445 / 1,787.6 / 10,501.2 / 170 | 3,147 / 1,968.1 / 10,452.5 / 164 | 3 → 3 |
| 4 | 3,350 / 1,816.3 / 10,615.8 / 155 | 3,134 / 1,896.2 / 10,232.6 / 136 | 2 → 7 |
| 5 | 3,107 / 1,809.7 / 10,368.0 / 163 | 3,468 / 2,006.3 / 10,215.6 / 152 | 2 → 4 |
| Mean completed and delay, max visit, total gridlocks | 3,222.4 / 1,796.3 / 10,615.8 / 843 | 3,242.8 / 1,931.1 / 10,489.1 / 778 | Delay +7.51% |

All nine showcases pass, including Heathrow and York. London City's 712.2 s visit and
Heathrow's 861.5 s visit are below 900 s. Boston was road-only and remains out of the
showcase. All 12 Munich light runs pass the TASK-154 drain checks: no ring lasting at least
300 s, no watched visit over 900 s, no vehicle stopped over the box wait on an inner
link at 10:00, and no stalled heads. The full-demand matrix is for the record.

### Re-pins

| File | State | Old | New |
| --- | --- | ---: | ---: |
| `tests/city/freiburg.city.test.ts` | Freiburg at 10:00 | `55277987` | `3430388558` |
| `tests/traffic/bundled-airport-load.test.ts` | London City after 60 s | `1229324366` | `483806754` |
| `tests/traffic/bundled-airport-load.test.ts` | Zurich after 60 s | `2094351646` | `2685203968` |
| `tests/traffic/bundled-airport-load.test.ts` | Boston after 60 s | `2047946547` | `2439037447` |
| `tests/traffic/bundled-airport-load.test.ts` | Heathrow after 60 s | `4040218530` | `2497667952` |

Compiled graphs, loaded-state hashes, flight boards and `bench/traffic-baseline.json`
are unchanged. No OSM, curation, signal programs, fixtures, or dependencies changed.

### Verification

| Command | Final lines |
| --- | --- |
| `npm run check` | `Test Files  309 passed \| 1 skipped (310)` · `Tests  2244 passed \| 2 skipped (2246)` · `✓ built in 2.19s` |
| `npm run test:city` | `Test Files  77 passed (77)` · `Tests  292 passed \| 1 skipped (293)` · `Duration  2979.24s (tests 98%, import 1%)` |
| `npm run test:traffic:light` | `Test Files  2 passed (2)` · `Tests  5 passed \| 1 expected fail (6)` · `Duration  387.60s (tests 100%)` |
| `npm run test:e2e:light` | `63 passed (6.1m)` |
| `Airport startup pins (main and V2)` | `Test Files  1 passed (1)` · `Tests  4 passed (4)` |

The Playwright tier used port 5394. Raw probe results and tier logs are in
`D:/cityflows-wt/330-pilot/R/t381m/out`.
