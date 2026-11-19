# TASK-219 and TASK-226: junction-group membership and stop lines (2026-11-19)

TASK-219 wrote this on main b3bcde6 (parked: its tip missed Freiburg's gate, a Siegesdenkmal lock
main had on other seeds). TASK-226 brought the tip's two rules unchanged onto main 2d4dd1f (after
TASK-217, 220, 222, 225 and 227), rounded the one gore the tip left sharp (`n:473`, below) and
re-measured; the audit, traffic and close-ups below are TASK-226's, main 2d4dd1f against the
branch.

TASK-212's J1 (inner roads overlapping inside a group's surface) and TASK-216's D2 (the
Hauptbahnhof group swallowing a median crossover, its stop line 37 m before the painted one).
Group membership changes in `src/importers/osm/split.ts` (`formJunctionGroups`); the group
surface (J1) is not changed: its cause lies in files other tasks own (below). Ids are those of the
bundled Freiburg project (`?city=freiburg`) rebuilt on this branch; group ids moved with the
rebuild (main's `jg:13297` is `jg:13267`).

## D2: the Hauptbahnhof group reaches 38 m along Friedrichstraße

Cause. `jg:13297` took in four nodes along Friedrichstraße that are plain road on the ground:

- `n:1147` and `n:488`, the ends of way 795829487, an untagged `highway=service` crossover
  between the two carriageways (gated: its middle node carries `barrier=lift_gate`,
  `access=private`). The 10.3 m link is short against the five-lane carriageway, so rule (c) of
  TASK-131 made both ends members; the westbound entry `r:1148` then ended at `n:1147` with its
  stop line and a zebra there, and the eastbound carriageway left the group at `n:482` and came
  back into it at `n:488`, with a second stop line.
- `n:473`, where the slip road `r:2153` to Stefan-Meier-Straße leaves Friedrichstraße 8 m before
  the painted stop line, and its end `n:406`: the 18 m `r:1149` and 19 m `r:475` were inner roads.

Rules (both join no link at the node, so neither node is a member):

1. **Median crossover.** A link of at most `junctionGroupMaxM` between the two carriageways of
   one street whose ends carry nothing else: at each end one road of the carriageway in and one
   out, of the same name, the two carriageways antiparallel (headings over 154 degrees apart), the
   link not of that street.
2. **Slip-road diverge.** A node where one named carriageway passes through (one road in, one out
   of the same name and class) and a link (`*_link`, class `ramp`) leaves it, nothing else, when a
   signalised group took in both the diverge and the slip road's end: its stop lines stood across
   the slip road too. The groups are formed again without it. Not in unsignalised groups (no stop
   lines; taking Freiburg's `n:390` and `n:397` out raised the gate morning's mean delay from 76 to
   97 s), nor where the slip road leaves the group (Lessingstraße's `n:768`: its 23 m inner road,
   then a plain road, folded under TASK-214's lane shifts and its curb island vanished, three new
   sharp corners).

Figures (`D2-*` close-ups):

| | main | branch |
| --- | ---: | ---: |
| Hauptbahnhof group: members / inner roads | 11 / 12 | 7 / 7 |
| westbound stop line from the painted one (middle lane) | 38.5 m before | 4.0 m past, 2.3 m aside |
| stop lines on the eastbound carriageway (`n:488`, `n:482`) | 2 | 1 (`n:482`'s signalised cycle crossing) |
| `n:1147`, `n:488` control | group signal | uncontrolled (the crossover yields) |

Since TASK-217 (D1, crossings painted where OSM maps them) nothing is painted across the westbound
lanes at `n:1147`: the zebra TASK-219 left there is gone on 2d4dd1f.

## J1: inner roads overlapping inside the group surface (not changed)

Cause. Members of the tight groups lie closer together than their cuts: at the Hauptbahnhof
`r:973` (13.5 m) has cuts of 9.92 m at `n:1` and 8.00 m at `n:970`, `r:975` (14.2 m) 8.00 and
9.92 m, `r:976` (14.1 m) 8.00 and 8.00 m, and the entry `r:1185` (9.2 m) 9.75 m at `n:970`. The trim
floor keeps 5 m of lane on every road (`lanes.ts` `layoutRoad`, `compile.ts`'s trim scale), so
each keeps a 3 to 5 m lane block inside the members' cut regions, and two wide roads converging on
one member overlap there (`r:1185`/`r:973` 21.3 m2; at Stefan-Meier-Straße `r:1177`/`r:6` 25.7 m2,
the two carriageways parting at `n:4`). The kerb noses at `n:970` and `n:1` (180 degrees) come
from the edges of those blocks. Cars on the overlapping lanes drive through each other's space
before the cuts: the defect is in the lanes, not only in the drawing.

Tried and dropped: a group surface made of the member outlines. Each member's outline took in
the inner roads under 15 m whose lane blocks overlap another road outside the members' polygons,
and the holes narrower than 1.5 m between members. Freiburg's lane overlap fell from 214.8 to
117.2 m2 (46 to 34 pairs), but the drawn union is the same (the inner roads were drawn under the
same colour; the outlines only hid their lane lines, TASK-217's M2), and the audit, which measures
each member's outline as its own junction, read the absorbed roads as bulge (31.5 to 121.4 m2),
three more sharp corners and one self-intersection. Moving the kerbs across members needs a group
outline the renderer and the audit know (a compiled group surface, `architecture.md` section 5).

Measured, not kept (a scratch tree): the floor lowered to 0.5 m for inner roads in `layoutRoad`
and `compile.ts`, Freiburg rebuilt. Lane overlap 214.8 to 139.5 m2 (at groups 170.2 to 94.9 m2;
`r:1185`/`r:973` 21.3 to 0.4 m2, `r:1177`/`r:6` 25.7 to 20.0 m2, the latter an entry's block, which
keeps its floor), but sharp corners at members 58 to 100: with the inner blocks gone the members'
own curbs face each other across the group. Munich and Sindelfingen unchanged.

Needed (for TASK-221 or a contract of its own): an inner road shorter than its members' cuts
carries no lane block of its own (the floor lifted for inner roads, `lanes.ts` and `compile.ts`,
which moves movement lengths and so traffic), with kerbs between the group's arms instead of each
member's (one surface per group, `junctions.ts` and `groups.ts`), and the audit's junction measures
on that surface.

## Every group checked

Census of the junction-group links whose ends carry only one street besides the link (main):
Freiburg 39 groups, 146 members, 112 links, 36 with such an end; Munich 39, 97, 62, 31;
Sindelfingen 15, 32, 17, 9. Almost all are a side street meeting one carriageway of a divided
road and crossing its median (a junction on the ground). With both ends plain, the link of
another street and the carriageways antiparallel: one, way 795829487. Slip-road diverges in
groups: Freiburg `n:473` (signalised group, slip road inside: leaves), `n:768` (signalised, slip
road leaves the group: stays), `n:390`, `n:397` (unsignalised: stay); Munich's three-road members
(`n:28`, `n:266` unnamed ramps; `n:452`, `n:478`, `n:483` without a link) and Sindelfingen's none
match. Munich's and Sindelfingen's imported cities are byte-identical to main's (sha256 of the
city JSON, both Munich imports), so their traffic is too.

## The gore at `n:473` (TASK-226, `src/network/junctions.ts`)

Out of the group, the slip-road diverge `n:473` is a plain fork, and the gore between `r:475` and
the slip road `r:2153` (the island's nose at Stefan-Meier-Straße) is rounded by a fillet. `r:2153`
runs 12.1 m to `n:406`, where `r:408` continues it straight; cut 8 m at `n:473`, its surface is
5 m. The fillet may use an edge to a metre before its end, which left it 1.21 m of tangent: radius
0.75 m, turning 41.8 degrees between samples at a 3 cm back-step (the audit's one new sharp
corner). Rule: on a slip road whose whole edge reaches a far node that cuts nothing off it (a
continuation), the fillet may use the edge to 5 cm before its end. The nose: radius 1.16 m, 24.8
degrees, not sharp. A radius of 1.9 m would need 3.5 m of tangent on `r:2153`, beyond its surface
into `r:408`; inside the 2.2 m left beyond the tip no curve turning the 123 degrees has a radius
over 1.19 m, and a fillet running on along `r:408`'s edge reads, to the audit (which counts only
the node's own roads as cover), as a curb turning back on itself. So `cornersUnder2m` stays one
up. On every road the rule also rounded five other gores and noses (Freiburg `n:200`, `n:413`,
`n:1051`; Sindelfingen `n:915`, `n:554`, one sharp corner fewer) but moved Sindelfingen's
compiled city and its pinned hashes; kept to slip roads, it moves `n:473` only, and Munich's and
Sindelfingen's compiled cities are byte-identical to main's.

## Geometry audit (`bench/geometry-audit.ts`), main 2d4dd1f against the branch

| city | measure | main | TASK-219's rules | with the gore rule (branch) |
| --- | --- | ---: | ---: | ---: |
| Freiburg | cornersSharp | 89 | 90 | 89 |
| Freiburg | cornersUnder2m | 166 | 167 | 167 |
| Freiburg | lineOutsideM (more is better) | 14,865 | 14,889 | 14,889 |
| Freiburg | markingOutsideM (more is better) | 15,307 | 15,312 | 15,312 |
| Munich, Sindelfingen | every measure | | identical | identical |

Every other measure of the three cities and every named case is identical. The painted metres
outside junction outlines grow because the Hauptbahnhof's outline no longer covers
Friedrichstraße from `n:1147` to `n:473` (T27 and T32 hold them at 98% of main or more). J1's
cases are unchanged.

## Traffic (TASK-226, main 2d4dd1f against the branch)

Munich's imported and compiled cities are byte-identical to main's (sha256, both Munich imports),
Sindelfingen's compiled city too, and no simulation file changed: nothing moves there. Main's
hashes are TASK-219's table below, unchanged by TASK-217, 220, 222, 225 and 227 (each merged with
identical Munich hashes); the branch reproduces them.

| run (seed 1 unless named) | completed / gridlocked | mean delay | state hash, main = branch |
| --- | ---: | ---: | --- |
| Munich 0.15 actuated, choice off | 5,312 / 0 | 617.0 s | 599167940 |
| Munich 0.15 actuated, choice on | 2,581 / 0 | 86.6 s | 647224768 |
| Munich 0.15 fixed, choice off | 5,302 / 1 | 778.5 s | 5860114 |
| Munich 0.15 fixed, choice on | 2,546 / 0 | 131.9 s | 125757433 |
| Munich seeds 2 and 3, actuated, choice off | 5,311 / 0; 5,310 / 2 | 646.6; 627.7 s | 187323141; 1769668491 |
| Munich seeds 2 and 3, actuated, choice on | 2,532 / 0; 2,545 / 0 | 81.3; 95.3 s | 4137063479; 243488400 |
| Munich seeds 2 and 3, fixed, choice off | 5,306 / 0; 5,308 / 0 | 799.3; 746.3 s | 3135126470; 1029796786 |
| Munich seeds 2 and 3, fixed, choice on | 2,499 / 0; 2,530 / 0 | 119.4; 126.4 s | 274055063; 612908735 |
| Munich full demand, actuated | 3,759 / 143, 3 stalled | 1,677.6 s | 4028429784 (reference) |
| Munich full demand, fixed | 3,501 / 168, 1 stalled | 1,727.1 s | 2888500527 (reference) |
| Sindelfingen 0.15, choice off and on | 155 / 0 | 27.1 s | 3472231659 |

Drain criterion (TASK-154) on the 12 Munich runs: met on all (no ring through a loop road, worst
loop visit 258 s, no car over 10 s on an inner link at 10:00, no stalled head).

Freiburg moves (0.15, choice on, the committed project rebuilt on each tree; seed 1 is the gate
morning of `freiburg.city.test.ts`):

| demand seed | main 2d4dd1f | branch |
| --- | --- | --- |
| 1 (gate) | 1,462 / 0, 75.7 s, 4038635547 | 1,461 / 0, 73.7 s, 4252036568 |
| 2 | 1,476 / 0, 67.4 s | 1,479 / 0, 65.2 s |
| 3 | 1,486 / 0, 65.2 s | 1,487 / 0, 66.6 s |
| 4 | 1,462 / 0, 68.1 s | 1,460 / 0, 69.8 s |
| 5 | 1,466 / 0, 64.2 s | 1,465 / 0, 64.3 s |
| 6 | 1,477 / 0, 63.4 s | 1,477 / 0, 71.8 s |
| mean delay, seeds 1 to 6 | 67.3 s | 68.6 s |

No run gridlocks and none has a stalled head: TASK-225's rule cleared the Siegesdenkmal lock that
parked TASK-219 (the tip gridlocked 24 trips at seed 1, 11 at seed 3).

Merge rule: Munich 0% in every configuration and full demand 0% (identical hashes); Freiburg's gate
delay -2.0 s, none gridlocked; drain criterion on every run. The audit gate misses by one:
`cornersUnder2m` 166 to 167 (the `n:473` nose, radius 1.16 m; above).

### TASK-219 on main b3bcde6 (history)

Freiburg's gate morning then: main 1,462 / 0, 76.2 s (1730700508); the tip 1,370 / 24 with 4
stalled heads, 73.9 s (2340066052), locked at the Siegesdenkmal box (`jg:13305`, stalled heads on
`r:1789` and `r:1659`); the variant `c96c115` (Lessingstraße's diverge `n:768` too) 1,461 / 0,
75.4 s, but the audit worse at Lessingstraße (its stop line moves 23 m to `n:771`, the curb island
paved over, `r:770`'s surface folding under TASK-214's lane shifts; cornersSharp 89 to 93,
cornersUnder2m 166 to 169; close-ups `variant-n768-lessingstrasse-*`, on b3bcde6). The crossover
rule alone gave 1,371 / 22, 77.4 s; both rules in every group (`n:390`, `n:397` too) 1,462 / 0 but
97.4 s. Seeds 1 to 6 gridlocked: main 0/5/9/21/0/0, tip 24/0/11/0/0/0, variant 0/0/11/0/0/0.

## Close-ups

Before is main 2d4dd1f, after this branch (Freiburg rebuilt), except the lane-block and variant
shots (TASK-219, main b3bcde6). App shots: 760 x 520 px crops of the dev build, basemap, places,
entrances, trees, labels and parked cars off, German markings; 2D at 7, 10, 12 or 24 px/m, 3D
pitched 50 to 55 degrees. Aerial overlays: `bench/aerial-overlay.ts` on TASK-216's imagery (cyan
the drawn carriageway's edge, yellow lines, red stop lines, magenta crossing stripes, white dotted
OSM centrelines); attribution in each caption.

- `D2-aerial-n1147-before.jpg`, `-after.jpg`: TASK-216's D2 frame. Before, the westbound stop line
  and signalised crossing at `n:1147` and a stop line on the eastbound carriageway at `n:488`;
  after, the westbound stop line at the painted one, the default crossing at `n:1147` unpainted
  (TASK-217's D1), and only the cycle crossing's stop line at `n:482` on the eastbound side.
- `D2-aerial-wide-before.jpg`, `-after.jpg`: the junction and Friedrichstraße to `n:1147`.
- `D2-aerial-n473-gore-before.jpg`, `-after.jpg`, `D2-hbf-n473-gore-*` (2D at 24 px/m and 3D): the
  island's nose between Friedrichstraße and the slip road `r:2153`; before a point inside the group,
  after rounded at 1.16 m, close to the kerb on the ground.
- `D2-hbf-friedrichstrasse-before.png`, `-after.png`, `-3d-*`: the signal heads and stop line move
  from `n:1147` to the junction mouth at `n:476`.
- `D2-hbf-n473-n476-*`, `D2-hbf-n1147-crossover-*`: the slip-road diverge and the crossover. After,
  the five lanes' dividers swing over the last 10 m before `n:473` where one lane becomes the slip
  road (TASK-214's split rules, `lanes.ts`).
- `J1-hbf-n1-n970-*`, `J1-stefan-n5-*` (2D and 3D): J1 as it was; the Hauptbahnhof's frame differs
  only east of `n:476`.
- `J1-hbf-lane-blocks.png`, `J1-stefan-lane-blocks.png` (main): the compiled pieces, each road's
  lane block a tinted ring (inner roads dashed), members' polygons grey: the inner blocks crossing
  `r:1185` at `n:970` and `r:1177` crossing `r:6` beyond `n:4`.
- `variant-n768-lessingstrasse-main.png`, `-variant.png`, `-3d-*`: the variant at Lessingstraße
  (`c96c115`): the stop line and heads move from `n:768` to `n:771`, the island between the
  Kronenstraße slip road and the junction is paved over.
