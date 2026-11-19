# TASK-217 markings and crossings (2026-11-19, main b3bcde6)

TASK-215's marking rules (held on `task/215-markings` at `3e5e33f`) brought onto main after
TASK-214, with TASK-216's D1 (crossings where OSM maps them) and M7 (solid lane lines before stop
lines, owner-approved German practice). Two versions, because the first missed the owner's merge
rule:

- **Full** (`67f1d38`): every rule below, including the ones that move crossings and walk links.
  Munich mean delay +3.7% and +4.6% in fixed time, Freiburg's gate +11 s: misses the merge rule.
- **Paint only** (the branch tip): the rules that change paint and nothing else. Crossing places,
  stop positions, walk links, the importer and the Freiburg project are main's; every traffic
  hash is main's.

Close-ups are of the bundled Freiburg project at the same camera: `-before` (main), `-after`
(the tip, paint only), `-full` (the full version, where it differs: D1, M3, M5); 2D at the zoom in
the file list below (px/m), `-3d` at pitch 55. `aerial-*` are TASK-216's overlays
(`bench/aerial-overlay.ts`) on LGL-BW DOP20: drawn carriageway cyan, lines yellow, stop lines red,
crossing paint magenta. Orthophoto: LGL-BW (2026) Datenlizenz Deutschland - Namensnennung -
Version 2.0, www.lgl-bw.de; roads and paint: OpenStreetMap contributors, ODbL.

## Rules

| Case | Rule (where) | Tip | Full | Close-ups (zoom) |
| --- | --- | --- | --- | --- |
| M1 | A junction group's entry lane shows its turns through the group (TASK-215, `marking-geometry.ts` `groupTurns`) | yes | yes | `m1-n768` (9, 3D), `m1-n1349` (9) |
| M2 | No lane lines on a group's inner lanes under 15 m (TASK-215) | yes | yes | `m2-n828` (9), `m2-m6-hbf-n970` (6, 3D) |
| M3 | No crossing over a trunk road or (full) a ramp unless a mapped crossing way crosses its end within 12 m (TASK-215, `crossingDefault`). In the tip the trunk crossings stay where main has them, unpainted by D1 (0 painted in Freiburg and Munich) | paint only | yes | `m3-n446` (6, 3D) |
| M4 | Keep-clear boxes stop 0.5 m short of crossings; arrows clear the crossing at their lane's start (TASK-215). The doubled-crossing rule (one of two crossings under 7.5 m apart) is dropped in both: its doubled stripes were default zebras, which D1 no longer paints, and its removed walk crossings cost Munich 4 to 5% | yes | yes | `m4-n1462` (10, 3D), `m4-n464` (10) |
| M5 | A crossing that steps over 0.25 m across its arm is one straight band (TASK-215) | no | yes | `m5-n11` (10, 3D), `m5-n18` (10) |
| M6 | One stop line across an approach, through every lane's stop position (TASK-215) | yes | yes | `m6-n1147` (8, 3D), `m6-n1132` (9) |
| D1 paint | `crossingStyle`: the broken lines of a signalised crossing (Fußgängerfurt: 0.15 m, 0.5 m dashes, 0.2 m gaps, inside the stripes' near and far edges) at a signalized node, or for a mapped crossing within 12 m of one; zebra stripes where a mapped crossing way crosses the arm within 12 m of the cut; nothing at a default crossing of an imported road where nothing is mapped (it keeps its place, span, stop line and walk link). A mapped crossing that no road end stands for (midblock, or at an end without a crossing) paints where it crosses the lanes | yes | yes | `d1-n211-n1139` (8, 3D), `d1-n403-hbf` (6), `d1-n1-signal` (8, 3D), `d1-n398-slip-zebra` (10), `d1-n229-zebra` (9); `aerial-D1-crossings-n211-n1139`, `aerial-D1b-hbf-n403`, `aerial-D1c-n229` |
| D1 place | A mapped crossing within 12 m of an unsignalised road end moves the arm's band to it (from 0.25 m beyond the lane cuts, no move-out) | no | yes | as above, `-full` |
| D1 import | `path=crossing` ways are crossings (Freiburg's 31 sidepath crossings); a marked crossing mapped only as a road node (`crossing` zebra, marked, uncontrolled or traffic_signals, `crossing_ref=zebra`, any `crossing:markings` but `no`) becomes a crossing link across the road at the node, so the zebras at n:211 (2479358348) and n:1139 (9118444286) paint where they are | no | yes | `d1-n211-n1139-full`, `aerial-D1-crossings-n211-n1139-full` |
| M7 | A lane line is solid over the last 30 m before a stop line (half the stop position on a shorter road), from the end of an adjacent lane gain's taper at the latest, never beside a lane that ends in a taper (`solidBeforeStop`); all marking themes | yes | yes | `m7-n1147-approach` (5, 3D at 6), `m7-n970-approach` (6) |

TASK-214's gain fan (S2) is unchanged: the hatch per added lane is real paint where several lanes
taper in from one node; drawing it as one area belongs with tapers carried across short roads.

## Figures

Counts by tree (`crossings with stripes`: road ends with a crossing that has room for stripes):

| | Freiburg main | tip | full | Munich main | tip | full | Sindelfingen main | tip | full |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| crossings with stripes | 463 | 463 | 453 | 704 | 704 | 698 | 697 | 697 | 697 |
| painted zebra / signal lines / unmarked | 463 / 0 / 0 | 6 / 93 / 364 | 13 / 93 / 347 | 704 / 0 / 0 | 99 / 58 / 547 | 101 / 58 / 539 | 697 / 0 / 0 | 1 / 14 / 682 | 1 / 14 / 682 |
| M1 group-entry lanes with arrows | 44 | 55 | 55 | 104 | 111 | 111 | 2 | 2 | 2 |
| M2 lane shapes on inner lanes under 15 m | 231 | 0 | 0 | 40 | 0 | 0 | 2 | 0 | 0 |
| M3 trunk ends with stripes (painted) | 10 (10) | 10 (0) | 0 | 6 (6) | 6 (0) | 0 | 0 | 0 | 0 |
| M5 arms whose stripes step over 1 m | 9 | 9 | 3 | 7 | 7 | 2 | 21 | 21 | 6 |
| M6 multi-lane approaches with stop lines in pieces | 59 | 0 | 0 | 24 | 0 | 0 | 0 | 0 | 0 |
| M7 solid lane lines before stop lines | 0 | 35 | 35 | 0 | 40 | 40 | 0 | 0 | 0 |

D1 against the mapped crossings (crossing nodes on roads and crossing ways' road nodes, with
their `crossing` tags; scratch script), TASK-216's Hauptbahnhof box (x -630 to 230, y -690 to
-90):

| | main | tip | full |
| --- | ---: | ---: | ---: |
| road ends painted | 170 (all zebra) | 42 (6 zebra, 36 signal lines) | 61 (18 zebra, 43 signal lines) |
| painted over 4 m from any mapped crossing | 158 | 22 | 23 |
| mapped zebras (13) with a zebra within 4 m | 0 | 2 (21875560, 334498547) | 6 (adds 2479358348 at n:211, 9118444286 at n:1139) |
| mapped signalised crossings (32) with paint within 4 m | 12 (zebra) | 13 (12 signal lines) | 19 (16 signal lines) |
| mapped unmarked crossings (18) with paint within 4 m | 0 | 0 | 0 |

The painted ends over 4 m from a mapped crossing are signal lines at signalised arms without a
mapped crossing. Munich, whole extract: painted 704 to 170 (tip) or 172 (full); over 4 m from a
mapped crossing 614 to 94 (tip) or 40 (full); 24 (tip) or 47 (full) of its 105 mapped unmarked
crossings get zebras (main 35), because they are mapped as `footway=crossing` ways whose
`crossing=unmarked` the walk schema cannot carry. Sindelfingen: painted 697 to 22.

Geometry audit (`bench/geometry-audit.ts`, five cities, against main): every city total equal in
both versions except `lineOutsideM` and `markingOutsideM`, the painted metres outside junctions,
which grow with the solid lines and shrink with M2 (tip: Freiburg 14,857 to 14,865 m, Munich
34,881 to 35,062, town 79,218 to 80,486, grid 8,010 to 8,094, Sindelfingen 44,555 to 44,549; full:
14,871, 35,072, 80,456, 8,094, 44,508); they are amounts of paint, not distances. Named cases, both
versions: marking offset J4 0.013 to 0.002 m, J1-stefan 0.004 to 0, J3 0.001 to 0.003 m (the
solid line keeps the lane edge's vertices that dashes interpolated past; 2 mm).

## Traffic

Full version (`d5e6092`; `67f1d38` only adds paint), Munich 0.15 to 10:00, seeds 1 to 12 (means):

| | main | full |
| --- | --- | --- |
| actuated, choice off | 5,310.5 completed, 4 gridlocked in 3 runs, 630.6 s, worst visit 274 s | 5,310.2, 4 in 3, 644.4 s (+2.2%), 342 s |
| actuated, choice on | 2,550.7, 0, 90.8 s, 219 s | 2,550.6, 0, 91.5 s (+0.8%), 180 s |
| fixed, choice off | 5,303.8, 4 in 3, 789.0 s, 275 s | 5,299.6, 0, 817.9 s (+3.7%), 334 s |
| fixed, choice on | 2,529.8, 0, 125.0 s, 173 s | 2,525.3, 0, 130.8 s (+4.6%), 215 s |

Drain criterion met on all 48 runs. Full demand: actuated 3,759 / 143, 1,678 s to 3,347 / 167,
1,694 s (+1.0%); fixed 3,501 / 168, 1,727 s to 3,387 / 165, 1,693 s (-2.0%). Freiburg gate 1,462 /
0, 76 s to 1,459 / 0, 87 s (+11 s). Sindelfingen 155 / 0, 27.1 s both.

Probes on the full version (Freiburg gate; Munich fixed time seeds 1 to 4, mean delay choice off
/ on, main 742.2 / 124.5 s, full 805.9 / 134.5 s): without the band move 834.4 / 135.5 s and
Freiburg 93 s; without the ramp rule identical to the full version; without `path=crossing` and
with crossing-node links allocated after every other id 869.0 / 132.0 s and Freiburg 79 s (main's
timetable; any walk id added before the rail import renumbers the trams and moves their
departure offsets). No single part explains Munich's fixed-time rise; per-seed delays swing by
up to 15% between trees that differ in a few crossings, so the paint-only version is the variant.

Paint only (tip): state hashes identical to main on Munich seeds 1 to 3 in all four
configurations (actuated off 599167940, 187323141, 1769668491; on 647224768, 4137063479,
243488400; fixed off 5860114, 3135126470, 1029796786; on 125757433, 274055063, 612908735), full
demand (actuated 3,759 / 143, 4028429784; fixed 3,501 / 168, 2888500527), Freiburg's gate (1,462
/ 0, 76 s, 1730700508) and Sindelfingen (155 / 0, 27.1 s, 3472231659); the importer and the
Freiburg project are main's byte for byte.

## Not done, and why

- The marking of a mapped crossing way (`crossing=unmarked`, `crossing:markings=no`) cannot reach
  the compiled city: walk links carry only their kind. Unmarked crossing ways therefore paint as
  zebras where they lead an arm (Munich 24 in the tip). A `WalkLink` field for the marking
  (schema, lead's decision) would fix it.
- In the tip, crossings mapped only as nodes (n:211's and n:1139's zebras) are not drawn: they
  need walk links (the full version's importer rule), which move traffic.
- Mapped signalised crossings whose signal the importer moved to a junction more than 12 m away
  (TASK-216's D4, `controlTransferred`) paint as zebras (1 in the box): the crossing node is
  uncontrolled in the compiled city, and the walk graph treats them as zebras too. TASK-218's D4.
- Crossings mapped on paths not tagged as crossings (31456088, the sidepath over Rosastraße) and
  unmarked or untagged crossing nodes stay unpainted.
