# TASK-375 — Audit lane overlap leaves out the group surface

Status: merged 2026-11-27 (`d45b208d`): measure 9 Munich 192.26 to 170.34 m², Freiburg 200.97 to 92.35 m², Sindelfingen unchanged; 22 pairs dropped, all under group surfaces; drawn-stub census 0 / 0 / 0; every other measure identical. Owner said "Change the audit measure" after TASK-371. Owner: Codex (gpt-6.2-sol, high).
Base: main `211bbd18`.

## Finding (TASK-371)

The inner roads of junction groups keep lane blocks under the 5 m trim floor (69 / 30 / 121 in Munich, Sindelfingen
and Freiburg). The app draws none of them:
- TASK-131/215 draw an inner road under 15 m with no lines;
- TASK-347's group surface covers it.

They exist only in measure 9 of `bench/geometry-audit.ts` (lane overlap, `overlapPieces`). It leaves out overlap
under a node's `outline` of the same grade, but not under the group surface (`groupSurface` in
`src/render/layers/nodes.ts`, already imported by the audit).

TASK-371 grew the member outlines to cover the stubs, a change to compiled data with no visible effect, and missed
two gates. The owner chose to change the measure instead: overlap the app draws as one group surface is not a lane
overlap.

## Goal

Measure 9 leaves out overlap under a group's surface, at the group's grade, as it does under node outlines (the
`outsideOutlines` path). The by-road-end variant (B55, outlines included on purpose) stays as it is.

## Scope

`bench/geometry-audit.ts` and its tests. No change to `src/`; the compiled city and traffic stay identical.

Out of scope: `src/**`, `bench/traffic-baseline.json`, gate floors, other audit measures.

## Gates

- Every other audit measure identical to main on the Munich, Sindelfingen and Freiburg audits (state the totals).
- Measure 9 before and after per city, and for J1-hbf, J1-stefan and J2. List each road pair that drops and confirm
  that it lies under a group surface; no pair outside a group surface changes.
- The drawn-stub census (TASK-371's script in `D:\cityflows-wt\330-pilot\R\t371\`) read against the group surface:
  report it per city.
- A test that fails without the change: an inner-road overlap under a group surface is not counted; the same overlap
  outside any group surface still is.
- `npm run check`, `test:city`, `test:traffic:light`. No e2e needed (no app change); say so if a pin needs it.

## Result

Measure 9 now clips out the rendered `groupSurface` at the grade of the group's first member,
in addition to the existing node outlines. The scan uses the outer rings and holes together,
so the group mask does not cover holes or other grades. B55 (by road end) still
includes overlap under both kinds of surface. No app, compiled geometry or traffic changed.

### Measure 9

The fresh pre-change audit on `4c8c76bd` is byte-identical to TASK-371's archived
`audit-main.json`. City and case totals use the same inputs and filters before and after.

| City or case | Area before → after (m²) | Pairs before → after | Corridor area before → after (m²) | Corridor pairs before → after |
| --- | ---: | ---: | ---: | ---: |
| Munich | 192.26 → 170.34 | 26 → 23 | 71.41 → 71.40 | 3 → 2 |
| Sindelfingen | 640.41 → 640.41 | 65 → 65 | 22.75 → 22.75 | 2 → 2 |
| Freiburg | 200.97 → 92.35 | 44 → 25 | 0 → 0 | 0 → 0 |
| Grid and town (each) | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| J1-hbf | 31.12 → 5.60 | 4 → 1 | 0 → 0 | 0 → 0 |
| J1-stefan | 25.96 → 0 | 2 → 0 | 0 → 0 | 0 → 0 |
| J2 | 12.14 → 0 | 2 → 0 | 0 → 0 | 0 → 0 |

An independent check split all 3,002 baseline overlap row pieces at the same-grade group
boundaries and tested each resulting midpoint against the rendered rings. Every removed piece
is inside a group surface, and every exterior piece is unchanged. The 22 dropped pairs had all
of their counted overlap under the groups below (IDs from the compiled audit input).

| City | Group | Dropped road pairs (before, m²) |
| --- | --- | --- |
| Munich | `jg:10773` | `r:1264/r:1265` (0.01) |
| Munich | `jg:10798` | `r:1355/r:728` (13.20), `r:1356/r:728` (8.71) |
| Freiburg | `jg:13262` (J1-stefan) | `r:1177/r:6` (25.72), `r:1177/r:745` (0.24) |
| Freiburg | `jg:13264` | `r:1057/r:1337` (2.86) |
| Freiburg | `jg:13272` | `r:1558/r:2246` (1.21) |
| Freiburg | `jg:13273` | `r:396/r:718` (0.01), `r:396/r:838` (1.71) |
| Freiburg | `jg:13276` | `r:1563/r:2230` (2.69) |
| Freiburg | `jg:13278` | `r:2251/r:2253` (0.02) |
| Freiburg | `jg:13280` | `r:1574/r:1772` (0.21), `r:1706/r:1821` (11.94, J2), `r:1771/r:1821` (0.20, J2), `r:1783/r:1820` (10.46) |
| Freiburg | `jg:13281` | `r:800/r:802` (5.77) |
| Freiburg | `jg:13282` | `r:2226/r:814` (5.98) |
| Freiburg | `jg:13292` (J1-hbf) | `r:1185/r:973` (21.34), `r:261/r:973` (2.79), `r:974/r:976` (1.39) |
| Freiburg | `jg:13303` | `r:1372/r:450` (8.64) |
| Freiburg | `jg:13307` | `r:1708/r:1826` (5.05) |

No pair drops in Sindelfingen. J1-hbf's `r:405/r:460` remains at 5.60 m². The only surviving
pair with a reported change is Freiburg's `r:1055/r:1337` (5.56 → 5.17 m², clipped by
`jg:13264`). Two more Freiburg pairs lost less than 0.002 m² each and round to their old values:
`r:1054/r:19` under `jg:13264` and `r:1424/r:1425` under `jg:13287`.

### Other audit totals

All non-measure-9 totals, entity records and worst lists matched across all five cities and
23 named cases. A separate comparison of B55 before and after matched all 9 / 34 / 13 raw
road-end records in Munich / Sindelfingen / Freiburg, including zero-area records.

| Total | Munich | Sindelfingen | Freiburg |
| --- | ---: | ---: | ---: |
| widthMaxM | 4.983 | 6.279 | 10.49 |
| widthP95M | 0.033 | 0.051 | 0.104 |
| widthRoadsOver5cm | 280 | 360 | 372 |
| widthExcludedM | 1068.8 | 662.4 | 1794.6 |
| gapMaxM | 0.062 | 0.37 | 0.015 |
| gapPairs | 340 | 372 | 219 |
| gapPairsOver2cm | 4 | 2 | 0 |
| foldBackSteps | 0 | 0 | 4 |
| foldBackStepM | 0 | 0 | 3.47 |
| foldCrossings | 0 | 0 | 2 |
| foldCusps | 0 | 1 | 5 |
| throughFarM | 4.116 | 3.056 | 1.778 |
| throughNearM | 3.655 | 0.697 | 1.499 |
| throughLaneM | 4.057 | 7.483 | 1.744 |
| throughNodes | 169 | 147 | 178 |
| throughNodesOver10cm | 16 | 22 | 28 |
| overlapM2 | 138.28 | 287.49 | 15.50 |
| overlapPairs | 20 | 48 | 10 |
| junctionSelfX | 0 | 0 | 0 |
| bulgeM2 | 17 | 111 | 9.07 |
| outlineBulgeM2 | 17 | 111 | 9.07 |
| bulgeNodes | 7 | 19 | 10 |
| joinGapMaxM | 0.315 | 3 | 1.704 |
| joinsOver5cm | 9 | 16 | 81 |
| markingMaxM | 0.011 | 0.009 | 0.224 |
| markingLinesOver5cm | 0 | 0 | 2 |
| endOverlapM2 | 20.92 | 231.79 | 25.11 |
| endOverlapPairs | 2 | 18 | 2 |
| voidM2 | 15578.45 | 1334.55 | 3515.60 |
| voidPairs | 37 | 6 | 11 |
| cornersSharp | 15 | 25 | 60 |
| cornersUnder2m | 54 | 79 | 123 |
| nosesSquare | 2 | 9 | 26 |
| noses | 63 | 25 | 51 |
| degreeTwoJunctions | 11 | 8 | 4 |
| degreeTwoTwoArmJunctions | 0 | 0 | 2 |
| lineOutsideM | 35081 | 44555 | 14519 |
| markingOutsideM | 35324 | 44576 | 15029 |

### Drawn-stub census

The TASK-371 script keeps its 5 cm lane-centre sampling inside the road surface and the same
cut/seam threshold. Testing those samples against the containing group's rendered rings
(including holes) instead of the two members' outlines leaves zero exposed stubs. The
Freiburg result matches on both the fresh curated import and the bundled audit city.

| City | Under 5 m floor | Stations census (unchanged) | Drawn against node outlines | Drawn against group surface |
| --- | ---: | ---: | ---: | ---: |
| Munich | 69 | 69 | 54 | 0 |
| Sindelfingen | 30 | 30 | 20 | 0 |
| Freiburg | 123 | 121 | 87 | 0 |

### Verification

`tests/bench/T34-geometry-audit.test.ts` reproduces 20.88 m² of overlap on two inner roads
at grade 1 before the fix. With the group mask that overlap is absent. The same 20.88 m² is
still counted when moved outside the group, and B55 still counts it inside the group.

T39.2's Munich corridor residual expectation loses `r:1264/r:1265` (0.01 m²). Its measured
overlap was entirely under `jg:10773`. No compile, traffic or e2e pin changed. E2E was not
needed because the app did not change.

| Command | Final result |
| --- | --- |
| Focused T34 audit tests | `Test Files 1 passed (1)`, `Tests 12 passed (12)` |
| `npm run check` | `Test Files 307 passed \| 1 skipped (308)`, `Tests 2213 passed \| 2 skipped (2215)`, `✓ built in 1.28s` |
| `npm run test:city` | `Test Files 77 passed (77)`, `Tests 292 passed \| 1 skipped (293)`, `Duration 962.32s` |
| `npm run test:traffic:light` | `Test Files 2 passed (2)`, `Tests 5 passed \| 1 expected fail (6)`, `Duration 217.70s` |

All TASK-375 gates passed.
