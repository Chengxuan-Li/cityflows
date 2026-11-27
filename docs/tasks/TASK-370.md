# TASK-370 — Boston: overlapping aircraft bodies on full days

Status: started 2026-11-27 (owner defaults; airside: merge on gates). Owner: Codex (gpt-6.2-sol, high). Base: main
`3602dbd7`.

## Finding

Main's Boston full days have overlapping aircraft bodies: seeds 1 / 2 / 3 have 22 / 0 / 11 overlap samples
(`overlapCount` in `D:\cityflows-wt\330-pilot\R\t360\irm-bos-d1..2.json` and `t353\fo-bos-d3.json`). Heathrow, Zurich
and London City days have 0.

## Goal

Find each overlap: time, the aircraft, where (taxiway, stand, runway, holding point), and what each was doing. Fix the
cause with a general rule in `src/sim/aircraft.ts` (or `flight-operations.ts`), with a test that fails without it.
Overlaps are a correctness defect: two bodies never share space.

## Gates (owner ladder)

1. Boston full days seeds 1–3: overlaps 0; completed not worse; go-arounds not worse in sum; `runwayConflictsReal` 0.
2. Heathrow peaks seeds 1–5, Heathrow days 1–3, Zurich days 1–3 (`--daily 730`) and the London City day: identical to
   main, or not worse in completed and go-arounds with 0 overlaps.
3. `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`; re-pin
   `tests/traffic/bundled-airport-load.test.ts` if it changes. City hashes identical.

Main references: Boston `t360\irm-bos-d1..2`, `t353\fo-bos-d3` (unchanged by TASK-363); Heathrow `t363\m-p1..p5`,
`m-d1..3`; Zurich `t360\irm-zrh-d1..3`; London City `t360\irm-lcy-d1`.

## Result

**Main's four incidents.** Times are scenario clock times, inclusive at the bench's one-second sample rate. All four
are off the runway, and seed 2 has none. `baseline-clip1.log` and `baseline-trace3.log` in the scratch folder record
the exact physical poses.

| Boston seed | Time | Samples | Where | Aircraft and activity |
| --- | --- | ---: | --- | --- |
| 1 | 00:13:47–58 | 12 | E14B lead-in (`ae:24788`) | SF34 N110IW pushing out under tow from E14B to E11, PC24 N128UG newly spawned parked at E14B |
| 1 | 00:26:37–46 | 10 | C7 lead-in (`ae:24705`) | E175 N102ZY pushing out under tow from C7 to E3, PC24 N130FB newly spawned parked at C7 |
| 3 | 00:01:13–22 | 10 | C6 lead-in (`ae:24706`) | A21N N101WZ pushing out under tow from C6 to E3, PC24 N125EG newly spawned parked at C6 |
| 3 | 08:48:02 | 1 | A5 lead-in (`ae:24673`) beside taxilane `ae:24209` | B738 N267RP taxiing in from 22L turned onto A5. Its wing hit the fuselage of B738 N245OP, a 22R departure from A21 stopped in the taxilane under an active wait. |

**Rules and source.** The first three incidents share one cause. `startOnce` releases the stand slot at the start of
pushback, but the old `spawnParked` only checked the slot. A carry-in can appear in place, unlike an arrival that
taxis to the stand. It now checks its parked body against the existing TASK-312 pushback reservation and the
actual bodies on the surface via `sweepClear`. No change to stand assignment or runway separation rules.

At A5 the nominal TASK-312 wait was active and being obeyed. The 6 m sweep skipped a heading on a turn with a radius
of about 4.35 m, so its stop at 121.19 m left the departure in the arriving wing's way. The first candidate sampled
each short chord on tight turns in the ordinary sweep. The variant retains the original sweep and uses those chord
headings only to check the planned stop for a crossing wait. If the stopped body is in the way, the wait moves back
to a clear pose before the order is granted. This follows the simulator's own chord headings (`aircraft-motion.ts`)
and body rectangles, extending the TASK-312/TASK-342 geometric clearance rule, not adopting a new operational
separation standard. Neither rule is keyed by airport, aircraft type, or stand.

The two regressions in `tests/sim/aircraft.test.ts` exercise a carry-in whose free stand is in a live tow's pushback
sweep, and replay the two A5 movements on the unchanged Boston graph. Both failed on the original behavior and pass
with either correction. `--checks` now saves every overlap pair and time and logs both poses and nearby airside
features.

### Gate 1, Boston full days

First candidate (`v1-bos-d*`), main → candidate. **Fail** on the sum of go-arounds. Per seed, overlaps and real runway
conflicts are zero and completed is not worse.

| Seed | Completed | Go-arounds | Overlap samples | Real runway conflicts |
| --- | ---: | ---: | ---: | ---: |
| 1 | 992 → 993 | 17 → 25 | 22 → 0 | 0 → 0 |
| 2 | 968 → 976 | 35 → 33 | 0 → 0 | 0 → 0 |
| 3 | 996 → 997 | 49 → 44 | 11 → 0 | 0 → 0 |
| Sum | 2,956 → 2,966 | 101 → 102 | 33 → 0 | 0 → 0 |

One variant (`v2-bos-d*`), main → variant. **Pass.** Completed and go-arounds match main on each seed, the
33 overlap samples are gone, and real runway conflicts remain at zero.

| Seed | Completed | Go-arounds | Overlap samples | Real runway conflicts |
| --- | ---: | ---: | ---: | ---: |
| 1 | 992 → 992 | 17 → 17 | 22 → 0 | 0 → 0 |
| 2 | 968 → 968 | 35 → 35 | 0 → 0 | 0 → 0 |
| 3 | 996 → 996 | 49 → 49 | 11 → 0 | 0 → 0 |
| Sum | 2,956 → 2,956 | 101 → 101 | 33 → 0 | 0 → 0 |

### Gate 2, other airports

Main → variant below. Heathrow peaks are 06:00–08:00 with drain to 09:00. Heathrow peak JSON matches main
apart from wall time and `overlapSamples`.

| Run | Completed | Go-arounds | Overlap samples | Real runway conflicts |
| --- | ---: | ---: | ---: | ---: |
| Heathrow peak 1 | 145 → 145 | 4 → 4 | 0 → 0 | 0 → 0 |
| Heathrow peak 2 | 130 → 130 | 2 → 2 | 0 → 0 | 0 → 0 |
| Heathrow peak 3 | 133 → 133 | 0 → 0 | 0 → 0 | 0 → 0 |
| Heathrow peak 4 | 135 → 135 | 4 → 4 | 0 → 0 | 0 → 0 |
| Heathrow peak 5 | 146 → 146 | 8 → 8 | 0 → 0 | 0 → 0 |
| Heathrow day 1 | 871 → 871 | 21 → 21 | 0 → 0 | 0 → 0 |
| Heathrow day 2 | 869 → 869 | 22 → 22 | 0 → 0 | 0 → 0 |
| Heathrow day 3 | 827 → 827 | 28 → 28 | 0 → 0 | 0 → 0 |
| Zurich day 1 (`--daily 730`) | 729 → 729 | 7 → 7 | 0 → 0 | 0 → 0 |
| Zurich day 2 (`--daily 730`) | 727 → 727 | 7 → 7 | 0 → 0 | 0 → 0 |
| Zurich day 3 (`--daily 730`) | 746 → 746 | 8 → 8 | 0 → 0 | 0 → 0 |
| London City day 1 | 150 → 150 | 0 → 0 | 0 → 0 | 0 → 0 |

**Pass.** All twelve runs match main on the gate metrics. The raw outputs are `v2-lhr-*`, `v2-zrh-*` and
`v2-lcy-*` in `D:\cityflows-wt\330-pilot\R\t370\`.

### Gate 3, repository tiers

| Command | Final evidence |
| --- | --- |
| `npm run check` | `307 passed \| 1 skipped` files, `2205 passed \| 2 skipped` tests, `built in 1.42s`, exit 0 |
| `npm run test:city` | `77 passed` files, `291 passed \| 1 skipped` tests, `1321.83s`, exit 0 |
| `npm run test:traffic:light` | `2 passed` files, `5 passed \| 1 expected fail`, exit 0 |
| `npm run test:e2e:light` | `63 passed (4.1m)` on port 5393, exit 0 |
| `npm run test:traffic -- tests/traffic/bundled-airport-load.test.ts` | `1 passed` file, `4 passed` tests, exit 0 |

**Pass.** No airport-load re-pins. All four compiled-airport, startup-state and flight-board pins pass unchanged.
All four bundled airport `city` payload hashes match `41666d39`, and the project fixtures, schema and network code
are unchanged. No dependencies or copied code. See `tier-*.log` in the scratch folder for the full output.
