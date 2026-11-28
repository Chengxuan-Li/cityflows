# TASK-386 — TASK-215's lane markings without the doubled-crossing rule, and solid lines before signals (M7)

Status: done 2026-11-28 (first version passes the merge rule; not merged). Started by the lead in the 9 h autonomous run (owner 2026-11-28: "Take all suggestions"). Owner: Claude subagent (Opus 5.5). Base: main; carries
`archive/task/215-markings` (`3e5e33f7`).

## Finding (TASK-215)

TASK-215's M1 to M6 fix marking defects (arrows through groups, lane lines in short inner lanes, default crossings on
trunk roads, doubled crossings, stepped crossing bands, stop lines in pieces). Its cost, Munich mean delay +4.0%
actuated and +5.3% fixed, sits in M4's doubled-crossing rule (crossings less than 7.5 m apart on one road keep one),
which moves walk links; without it fixed was 125.2 s against 124.8 s.

## Goal

The owner accepted (2026-11-28):
1. TASK-215 without M4's doubled-crossing rule (M4's keep-clear and arrow clearances stay if they do not move walk
   links).
2. M7: solid lane lines, not dashes, on the approach to a signal stop line (German practice, RMS-1 /
   StVO Anlage 2 Zeichen 295 as a Fahrstreifenbegrenzung; the solid length is the lead's default 30 m on urban roads
   unless the data says otherwise; cite the source by name and section).
3. Bring it onto current main, rebuild Freiburg and the other bundled cities as the importer change needs, re-pin.

## Scope

`src/render/road-paint.ts`, `marking-geometry.ts`, `render3d/markings.ts`, `crossings.ts` defaults, and what
TASK-215 touched (`walk.ts`, `inspector/node.tsx`), tests and re-pins, bundled-city rebuilds. Out of scope: OSM
edits, per-id curation, gate floors, `bench/traffic-baseline.json`.

## Gates

- Traffic merge rule against main (Munich within 3% on 12 seeds and four configurations as in TASK-215, full demand
  within 2% on the mean of seeds 1–5, Freiburg within 5 s, drain, every showcase passes).
- TASK-215's marking counts before and after (M1 to M7), the geometry audit within tolerance.
- Close-up screenshots (2D and 3D) of a group entry, a signal approach with M7 and a crossing pair, in the app.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result

**Pass on the traffic merge rule, first version (no variant).** Branch `task/386-markings`, merged with main `7322c8da`
(TASK-385) before the final Freiburg and showcase measurements, bundled cities rebuilt with `bench/bundled-cities.ts`.

### What main already had, and what this task added

TASK-217 (merged 2026-11-19 as its paint-only variant) had already brought TASK-215's M1, M2, M4's keep-clear and arrow
clearances and M6 onto main, and M7 at every stop line. What `archive/task/215-markings` still held that main did not:
M3, M5 and M4's doubled-crossing rule. The doubled-crossing rule is not taken (owner, 2026-11-28); main keeps
TASK-217's paint rule for close pairs (both kept, painted only at signals).

| Rule | As landed |
| --- | --- |
| M1 | Main's (TASK-215 via TASK-217, TASK-229 N2): a group entry lane's arrow shows its turns through the group. |
| M2 | Main's: no lane lines on inner lanes under 15 m (TASK-229 N1 keeps carriageway lines). |
| M3 | **New** (`crossingDefault`): no default crossing on a trunk road end unless a mapped crossing way leads its arm (TASK-217's `mappedArm`: crosses a lane of the arm within 12 m of the cut, in the half nearer the node). Generated walk links already left trunk arms out, so this removes stripes, the stop line's set-back and the street strips' gap at crossings no walk link uses. |
| M4 | Keep-clear boxes 0.5 m clear of crossings and arrows clear of the start crossing (main's), now also clear of an oblique band's stripes on the lane (Munich r:601). Doubled-crossing rule dropped. Neither clearance moves walk links (render only). |
| M5 | **New** (`placeArm`, `bandFrame`): where one arm's crossings step by more than 0.25 m along it, one straight band square to the arm's axis, at the same place for every end, unless that costs an end stripes; arms centred on a mapped crossing node (TASK-265) or at a node without outline (TASK-348) keep their placement. Each lane has its own span (`Placement.lanes`); the stop position, the walk link (`crossingCentres`, `crossingLine` per lane) and the street strips follow it. |
| M6 | Main's: one stop line across the approach. |
| M7 | Main's TASK-217 rule, now **only at a signal's stop line** (a stop sign's approach keeps its dashes), with the source in the code: StVO Anlage 2 (zu § 41 Abs. 1), Abschnitt 9, Zeichen 295 Fahrstreifenbegrenzung; RMS-1 (FGSV, Richtlinien für die Markierung von Straßen, Teil 1) for the lane division of a junction approach. 30 m (the lead's urban default), half the stop distance on short approaches, not across a lane gain or beside a lane ending in a taper. OSM gives no marking length (the importer reads no `change:lanes`), so every road takes the default. |

Main's other rules are kept: TASK-381 V2 crossing reserves (sim, untouched), TASK-348 junction lanes and plain signal
crossings (no band there), TASK-375's audit measure 9 (bench untouched), TASK-373's country field (untouched).

### Traffic merge rule

Main `d3b493e3` for Munich (its inputs are identical on `7322c8da`, coordinator), `7322c8da` for Freiburg and the
showcases. Munich 0.15 to 10:00, `bench/seed-report.ts --worker` (seed-report's drain criteria); main seeds 1–3 choice
off and full demand are the TASK-381 merge runs (source identical to `d3b493e3`), the rest run here.

| Munich 0.15, seeds 1–12 | main mean delay (s) | branch (s) | change | completed main / branch | gridlocked main / branch | drain met main / branch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| actuated, choice off | 633.1 | 640.7 | +1.21% | 63,747 / 63,749 | 3 / 1 | 12 / 12 |
| actuated, choice on | 88.2 | 85.6 | −2.96% | 30,634 / 30,622 | 0 / 0 | 12 / 12 |
| fixed, choice off | 813.0 | 825.0 | +1.48% | 63,626 / 63,643 | 10 / 8 | 12 / 12 |
| fixed, choice on | 125.3 | 124.5 | −0.69% | 30,366 / 30,348 | 0 / 0 | 12 / 12 |

Single choice-off seeds swing ±15% (fixed seed 1: 674.6 to 837.0 s; actuated seed 2: 706.4 to 601.2 s); the 12-seed
means are within 3% in every configuration.

Full demand, fixed time, choice off (completed / mean delay s / worst visit s / gridlocked / stalled heads):

| seed | main | branch |
| ---: | --- | --- |
| 1 | 3,265 / 1,763.9 / 10,489.1 / 166 / 5 | 3,356 / 1,824.3 / 9,746.8 / 146 / 6 |
| 2 | 3,200 / 2,021.1 / 10,200.2 / 160 / 2 | 3,161 / 1,902.9 / 10,186.3 / 152 / 1 |
| 3 | 3,147 / 1,968.1 / 10,452.5 / 164 / 3 | 3,119 / 2,033.7 / 10,422.7 / 159 / 4 |
| 4 | 3,134 / 1,896.2 / 10,232.6 / 136 / 7 | 3,021 / 1,931.0 / 10,562.1 / 158 / 2 |
| 5 | 3,468 / 2,006.3 / 10,215.6 / 152 / 4 | 3,187 / 1,996.9 / 10,023.3 / 184 / 5 |
| mean | 1,931.1 s | 1,937.8 s (+0.34%) |

Full demand, actuated (all programs actuated), choice off, main and branch both run here:

| seed | main | branch |
| ---: | --- | --- |
| 1 | 3,544 / 1,704.6 / 10,118.7 / 150 / 3 | 3,679 / 1,778.8 / 9,539.7 / 168 / 3 |
| 2 | 3,641 / 1,943.2 / 10,342.1 / 140 / 1 | 3,885 / 1,708.3 / 10,227.6 / 142 / 3 |
| 3 | 3,358 / 1,998.1 / 10,244.3 / 176 / 1 | 3,380 / 1,956.3 / 10,046.7 / 167 / 1 |
| 4 | 3,151 / 1,761.6 / 10,386.4 / 160 / 1 | 3,413 / 1,879.0 / 10,375.9 / 161 / 1 |
| 5 | 3,834 / 1,840.2 / 10,416.2 / 172 / 0 | 3,558 / 1,817.6 / 10,322.6 / 163 / 2 |
| mean | 1,849.5 s | 1,828.0 s (−1.16%) |

Showcases at 0.15, seed 1, choice on (completed / mean delay s / worst visit s / gridlocked); Freiburg, Sindelfingen,
Lübeck and York on main `7322c8da` against the merged branch with rebuilt archives, the others' archives unchanged by
TASK-385:

| City | Main | Branch | Gate |
| --- | --- | --- | --- |
| Freiburg | 1,529 / 60.6 / 143.1 / 0 | 1,530 / 59.2 / 143.7 / 0 | pass (−1.4 s, band 5 s) |
| Munich Donnersbergerbrücke | 2,573 / 97.6 / 370.1 / 0 | 2,574 / 92.4 / 277.0 / 0 | pass |
| Sindelfingen A81 | 444 / 17.2 / 90.3 / 0 | 444 / 17.1 / 90.3 / 0 | pass |
| York | 1,799 / 85.3 / 175.2 / 0 | 1,801 / 83.3 / 146.9 / 0 | pass |
| London City Airport | 1,998 / 209.7 / 712.2 / 0 | 1,998 / 162.2 / 827.0 / 0 | pass (visit under 900 s) |
| Lübeck Altstadt | 2,487 / 127.0 / 121.2 / 0 | 2,486 / 125.2 / 85.9 / 0 | pass |
| Philadelphia Center City | 4,695 / 149.3 / 374.5 / 0 | 4,685 / 155.6 / 566.7 / 0 | pass |
| Zurich Airport | 4,278 / 112.2 / 246.9 / 0 | 4,278 / 114.0 / 286.9 / 0 | pass |
| Heathrow | 4,048 / 213.7 / 861.5 / 0 | 4,020 / 218.6 / 675.6 / 0 | pass |
| Boston Logan (landside, record only) | 5,526 / 1,728.8 / 4,508.3 / 39 | not run (stopped to free a slot) | — |

### Marking counts (TASK-215's measures; main `7322c8da` to the merged branch)

| measure | Freiburg | Munich | Sindelfingen |
| --- | ---: | ---: | ---: |
| M1 lanes with arrows on group entries | 63 → 63 | 111 → 111 | 2 → 2 |
| M2 lane-line shapes on inner roads with a lane under 15 m (groups) | 52 (8) → 52 (8) | 6 (1) → 6 (1) | 0 → 0 |
| M3 trunk road ends with stripes | 10 → 0 | 6 → 0 | 0 → 0 |
| M4 roads with two crossings within 9 m / both painted | 16 / 0 → 15 / 0 | 22 / 0 → 22 / 0 | 31 / 0 → 31 / 0 |
| M4 keep-clear boxes on stripes / arrows on a crossing | 0 / 0 → 0 / 0 | 0 / 0 → 0 / 0 | 0 / 0 → 0 / 0 |
| M5 nodes whose crossings step more than 1 m (0.3 m) along an arm | 10 (23) → 3 (13) | 6 (19) → 3 (10) | 17 (31) → 5 (20) |
| M6 multi-lane approaches with the stop line in pieces (of) | 0 (58) → 0 (58) | 0 (24) → 0 (24) | 0 → 0 |
| M7 signal approaches with solid lines / stop-sign approaches with solid lines | 27 / 0 → 27 / 0 | 23 / 0 → 23 / 0 | 0 → 0 |
| M7 solid metres | 681 → 681 | 867 → 867 | 0 → 0 |
| road ends with a crossing / with stripes / painted | 778 / 461 / 100 → 763 / 451 / 100 | 889 / 704 / 82 → 877 / 698 / 82 | 963 / 697 / 15 → 963 / 697 / 15 |
| crossing walk links | 325 → 325 | 247 → 247 | 349 → 347 |

Left stepped in Freiburg: n:403 (r:460's band would reach the signal n:461's crossing; TASK-215 removed one of the two
with the declined doubled-crossing rule), n:552 (r:1448 too short for a band clear of the far curb) and n:94, where a band
costs an end stripes. M7 on Freiburg: the 31 signal approaches counted without a solid line are all shorter than 13 m to the
stop line, where the solid line is half the stop distance (under 6.5 m, which the count does not tell from a dash), as on
main. In Sindelfingen the generated crossing links drop from 349 to 347 (not traced).

### Geometry audit (`bench/geometry-audit.ts`, main `7322c8da` against the merged branch)

Every distance, area, corner, overlap (TASK-375's measure 9) and void measure is identical in all cities and all named
cases (J1–J6, B38, B39, G1, G2, R3, Mars). Only painted line metres outside node outlines move: Freiburg 14,517 →
14,524 m, Munich 35,081 → 35,091 m, Sindelfingen 43,943 → 43,902 m, town 80,486 → 80,456 m (paint length, not a
defect measure: lane lines run on where a trunk end lost its crossing).

### Re-pins (old → new, first 12 characters)

- `tests/city/freiburg.city.test.ts`: Freiburg 10:00 state hash 3918479990 → 2977102306; `city.json` digest
  0bd5bef9a731 → a7371d1392cc.
- `tests/city/bundled-cities.city.test.ts` archive bytes: London City 2c0b4f9c2aa1 → 9822ff33c7d4, Zurich 95a573d64408 →
  23f765ad47d4, Heathrow 7ef57ec8a755 → 0e7f6e28989c (Boston unchanged).
- `tests/render/V217-markings.city.test.ts` (TASK-257 dash counts): without the field 1,960 → 1,961, with it 2,044 →
  2,045.
- Compiled or canonical network hashes of Munich, Sindelfingen and the town fixture: T44 (a2e06370cf98 → 82dc815d243d,
  f70841fe1adc → 7316b3aa912c, 0a1823624c13 → f2ae860eddd4, bbd681b2c1d6 → d80157a116a9), T49 (0a8d7ac7b16f →
  c33a4c884430), T55 (0d954613c6e4 → c1d6c03d0f1a), T61 (907938549cb0 → 29df4f56dc18, 741cf5660bbb → 5fbe6831ef1c,
  65cdef2fec6f → c3bcc9ed5d6b), T50 (78e8401f3bd3 → 0ae24706e6aa, a65a08527e39 → 988530d5d216), T62 (c639821c5e85 →
  6f58292ecd02, 20a7843c3993 → 72b58659d02b), T75 (6fcdf8254276 → 635ca9da7b13, 2a1177263f24 → 94db0a66d4f7,
  4c0f40e93de1 → 019e840c5a27, b1db199e1159 → d81a6fedc341), V106 (f70841fe1adc → 7316b3aa912c, bbd681b2c1d6 →
  d80157a116a9), V107 (3595116920f0 → 1b11017975d9, 4e5020e454f3 → cd66fdb4dc4d, 8a0ceca11132 → d0575b21965a), V108
  (22ed3b87ddab → 41395f496ab0, 97941451fe25 → e03d179f808a, 78c0c2119009 → cc0680611569), V114 (d44e26265478 →
  16d38e8985a1, 1b9957c0e242 → b214ab20974c), V117 (compile, lamps, curbs and paint of town, Sindelfingen and Munich:
  14 hashes), walk-height (Freiburg 1d78a8eea2fb → 0a58d2342425, Munich 85a9cdda5d90 → 752715a27656, Sindelfingen
  69505d309e36 → 92ab9d0d1b3b).
- Town simulations: T46 hash 1073880220 → 2840132711 (completed 207 unchanged, mean delay 45.3406 → 45.3401 s), T67
  hashes 4260632795 / 558769496 / 1478634736 → 1063110051 / 2088598016 / 2022296578.
- Archives rebuilt with `bench/bundled-cities.ts`: Freiburg, Munich, Sindelfingen, Lübeck, York, London City, Heathrow,
  Zurich (Philadelphia and Boston byte-identical). No `bench/traffic-baseline.json`, gate floor, OSM or per-id change.

### Close-ups (in the app, preview tooling, `docs/findings/2026-11-28-markings/`)

- `group-entry-n768-2d.jpg`, `group-entry-n768-3d.jpg`: the signalised group entry at n:768, arrows of the turns through
  the group, solid lane lines over the last metres before the stop line, the signalised crossing's broken lines.
- `signal-approach-m7-band-n18-2d.jpg`, `signal-approach-m7-n18-3d.jpg`: n:18, the south approach's solid line between
  the through and right lanes up to the stop line (M7).
- `band-n18-north-main-2d.jpg` against `band-n18-north-branch-2d.jpg`: n:18's north arm, main's crossing stepped 2.0 m
  between the two directions, the branch's one straight band (M5).
- `crossing-pair-r1143-n1142-n664-2d.jpg`, `-3d.jpg`: Kronenbrücke r:1143, the signal crossing at n:1142 and the
  crossing at n:664 7 m on, both kept (the doubled-crossing rule not taken; n:664's is a default crossing OSM does not
  map, unpainted as on main).

### Verification

| Command | Final lines |
| --- | --- |
| `npm run check` | Test Files 310 passed, 1 skipped (311); Tests 2,253 passed, 2 skipped (2,255); built in 1.55 s; exit 0 |
| `npm run test:city` (2 workers) | Test Files 77 passed (77); Tests 296 passed, 1 skipped (297); 1,121.6 s; exit 0 |
| `npm run test:traffic:light` (1 worker) | Test Files 2 passed (2); Tests 5 passed, 1 expected fail (6); 196.8 s; exit 0 |
| `npm run test:e2e:light` (`CITYFLOWS_TEST_PORT=5396`) | 63 passed (4.0 m); exit 0 |

Files outside the listed scope: `src/network/walk.ts` and `src/ui/inspector/node.tsx` (as TASK-215: per-lane walk-link
centres; the inspector's default with the source), `docs/architecture.md` (one bullet in section 11 describing M3 and
M5), `docs/findings/2026-11-28-markings/` (close-ups), tests and re-pins, the rebuilt archives.

Not done: M7 stays theme-agnostic (main applies it in the UK and US themes too; German practice would limit it to the
`de` theme, a render-only follow-up). The RMS-1 section number is not cited: the text was not available offline (no
downloads), so the code names the guideline and the StVO sign. Process notes: the city tier ran with two workers while
the last full-demand run finished (three heavy processes for about 10 minutes); the record-only Boston showcase was
stopped (own PID) to free a slot for the rebuild after the TASK-385 merge; `D:\cityflows\.claude\launch.json` carried
two extra preview entries (branch and main worktrees) during the close-ups and was restored.
