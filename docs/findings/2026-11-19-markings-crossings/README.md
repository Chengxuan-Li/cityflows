# TASK-217 markings and crossings (2026-11-19, main b3bcde6)

TASK-215's marking rules (held on `task/215-markings` at `3e5e33f`) brought onto main after
TASK-214, with TASK-216's D1 (crossings where OSM maps them) and M7 (solid lane lines before stop
lines, owner-approved German practice). Close-ups are of the bundled Freiburg project, before
(main) and after (branch), at the same camera: 2D at the zoom in the table (px/m), 3D at pitch 55.
`aerial-*` are TASK-216's overlays (`bench/aerial-overlay.ts`) on LGL-BW DOP20: drawn carriageway
cyan, lines yellow, stop lines red, crossing paint magenta. Orthophoto: LGL-BW (2026) Datenlizenz
Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de; roads and paint: OpenStreetMap
contributors, ODbL.

## Rules

| Case | Rule (where) | Close-ups |
| --- | --- | --- |
| M1 | A junction group's entry lane shows its turns through the group (TASK-215, `marking-geometry.ts` `groupTurns`) | `freiburg-m1-n768`, `-n1349` (3D n768) |
| M2 | No lane lines on a group's inner lanes under 15 m (TASK-215) | `freiburg-m2-n828`, `freiburg-m2-m6-hbf-n970` (3D) |
| M3 | No default crossing over a trunk road or (TASK-217) a ramp unless a mapped crossing way crosses its end within 12 m (`crossings.ts` `crossingDefault`) | `freiburg-m3-n446` (3D) |
| M4 | Keep-clear boxes stop 0.5 m short of crossings; arrows clear the crossing at their lane's start (TASK-215). The doubled-crossing rule (one of two crossings under 7.5 m apart) is dropped: its doubled stripes were default zebras, which no longer paint, and its removed walk crossings cost Munich 4 to 5% | `freiburg-m4-n1462` (3D), `-n464` |
| M5 | A crossing that steps over 0.25 m across its arm is one straight band (TASK-215) | `freiburg-m5-n11` (3D), `-n18` |
| M6 | One stop line across an approach, through every lane's stop position (TASK-215) | `freiburg-m6-n1147` (3D), `-n1132` |
| D1 | Paint by what OSM maps (`crossingStyle`): broken lines (Fußgängerfurt, 0.15 m, 0.5 m dashes, 0.2 m gaps, inside the stripes' near and far edges) at a signalized node or for a mapped crossing within 12 m of one; zebra stripes where a mapped crossing leads the arm; nothing at a default crossing of an imported road where nothing is mapped (it keeps its place, span, stop line and walk link). A mapped crossing way within 12 m of an unsignalised road end moves the end's band to it (`mappedAt`, all ends of the arm, from the lane cuts, no move-out); a mapped crossing no road end stands for (midblock, or at an end without a crossing) paints where it crosses the lanes. Importer: `path=crossing` ways are crossings; a marked crossing mapped only as a road node (`crossing` zebra, marked, uncontrolled or traffic_signals, or `crossing_ref=zebra`, or any `crossing:markings` but `no`) becomes a crossing link across the road at the node | `freiburg-d1-n211-n1139` (3D), `-n403-hbf`, `-n1-signal` (3D), `-n398-slip-zebra`, `-n229-zebra`; `aerial-D1-crossings-n211-n1139`, `aerial-D1b-hbf-n403`, `aerial-D1c-n229` |
| M7 | A lane line is solid over the last 30 m before a stop line (half the stop position on a shorter road), from the end of an adjacent lane gain's taper at the latest, never beside a lane that ends in a taper (`solidBeforeStop`); all marking themes | `freiburg-m7-n1147-approach` (3D), `-n970-approach` |

TASK-214's gain fan (S2) is unchanged: the hatch per added lane is real paint where several lanes
taper in from one node; drawing it as one area belongs with tapers carried across short roads.

## Figures

Counts by tree (`crossings with stripes`: road ends with a crossing that has room for stripes):

| | Freiburg main | branch | Munich main | branch | Sindelfingen main | branch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| crossings with stripes | 463 | 453 | 704 | 698 | 697 | 697 |
| painted zebra / signal lines / unmarked | 463 / 0 / 0 | 13 / 93 / 347 | 704 / 0 / 0 | 101 / 58 / 539 | 697 / 0 / 0 | 1 / 14 / 682 |
| M1 group-entry lanes with arrows | 44 | 55 | 104 | 111 | 2 | 2 |
| M2 lane shapes on inner lanes under 15 m | 231 | 0 | 40 | 0 | 2 | 0 |
| M3 trunk road ends with stripes | 10 | 0 | 6 | 0 | 0 | 0 |
| M5 arms whose stripes step over 1 m | 9 | 3 | 7 | 2 | 21 | 6 |
| M6 multi-lane approaches with stop lines in pieces | 59 | 0 | 24 | 0 | 0 | 0 |
| M7 solid lane lines before stop lines | 0 | 35 | 0 | 40 | 0 | 0 |

The M5 steps left: Freiburg n:552 and n:94 (TASK-215's: a band would cost an end stripes) and
n:403 (r:460, which TASK-215's dropped doubled-crossing rule had removed; unmarked now).

D1 against the mapped crossings (crossing nodes on roads and crossing ways' road nodes, with
their `crossing` tags), TASK-216's Hauptbahnhof box (x -630 to 230, y -690 to -90):

| | main | branch |
| --- | ---: | ---: |
| road ends painted | 170 (all zebra) | 61 (18 zebra, 43 signal lines) |
| painted over 4 m from any mapped crossing | 158 | 23 (all signal lines at signal arms without a mapped crossing) |
| mapped zebras (13) with a zebra within 4 m | 0 | 6 (incl. 2479358348 at n:211 and 9118444286 at n:1139) |
| mapped signalised crossings (32) with paint within 4 m | 12 (zebra) | 19 (16 signal lines, 3 zebra) |
| mapped unmarked crossings (18) with paint within 4 m | 0 | 0 |

Munich: painted ends 704 to 172, over 4 m from a mapped crossing 614 to 40; but 47 of its 105
mapped unmarked crossings get zebras (main 35), because they are mapped as `footway=crossing` ways
whose `crossing=unmarked` the walk schema cannot carry (below). Sindelfingen: 697 to 22 painted.

Geometry audit (`bench/geometry-audit.ts`, all five cities): every city total equal except
`lineOutsideM` and `markingOutsideM`, the painted metres outside junctions, which grow with the
solid lines (Freiburg 14,857 to 14,871 m, Munich 34,881 to 35,072, town 79,218 to 80,456, grid
8,010 to 8,094) and shrink with M2 (Sindelfingen 44,555 to 44,508); they are amounts of paint,
not distances. Named cases: marking offset J4 0.013 to 0.002 m, J1-stefan 0.004 to 0, J3 0.001
to 0.003 m (the solid line keeps the lane edge's vertices that dashes interpolated past; 2 mm).

## Not done, and why

- The marking of a mapped crossing way (`crossing=unmarked`, `crossing:markings=no`) cannot reach
  the compiled city: walk links carry only their kind. Unmarked crossing ways therefore paint as
  zebras where they lead an arm (Munich 47). A `WalkLink` field for the marking (schema, lead's
  decision) would fix it; the importer already reads the tags for crossing nodes.
- Mapped signalised crossings whose signal the importer moved to a junction more than 12 m away
  (TASK-216's D4, `controlTransferred`) paint as zebras (3 in the box): the crossing node is
  uncontrolled in the compiled city, and the walk graph treats them as zebras too. TASK-218's D4.
- A zebra at a junction mouth keeps its stripes clear of the junction outline, so n:211's paints
  3 of its stripes; a crossing on a lane too short for stripes (n:1139's east arm) is painted by
  the mapped-crossing paint instead of the arm's band.
- Crossings mapped on paths not tagged as crossings (31456088, the sidepath over Rosastraße) and
  unmarked or untagged crossing nodes stay unpainted.
