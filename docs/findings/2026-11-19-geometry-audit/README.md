# TASK-212 geometry audit (2026-11-18, main 986e807)

Read-only audit of junction shapes, lane splits and merges, and markings, Freiburg first, for the
three fix tasks TASK-213 (junctions), TASK-214 (splits and merges) and TASK-215 (markings). Ids are
those of the bundled Freiburg project (`?city=freiburg`) and of the junction audit's Munich import.
Close-ups are 760 x 520 px crops of the dev build at 8 to 14 px/m (2D) or pitched 3D, with the
basemap, places, entrances and trees off; a dashed red circle marks the named node. 36 PNGs, 2.2 MB,
largest 158 KB.

Method: `bench/geometry-audit.ts` measures on the five cities (a scratch wrapper, because the script
itself crashes, see "Other findings"); 54 overview shots covering every Freiburg signal (100 nodes,
17 signalised groups), every node with a 3-lane arm and 3 or more arms (72), every lane-count change
(159) and every fork or merge (21); then close-ups of what they showed; scratch detectors for arrows
against the turn each lane makes through its junction or group, crossing placement, stop lines and
lane-count changes. Scratch scripts stay outside the repo.

## Audit figures

| measure | Sindelfingen | Munich | Freiburg | last recorded (plan review log) |
| --- | ---: | ---: | ---: | --- |
| lane folds: back-steps / self-crossings / cusps | 0 / 0 / 1 | 3 / 3 / 2 | 17 / 13 / 18 | Munich 0, Sindelfingen 0 (TASK-082) |
| corridor gap max, m (pairs over 2 cm) | 0.37 (2) | 0.693 (5) | 0.144 (1) | 0.008 / 0.012, separated pairs 0.5 by design (TASK-082, 084) |
| continuation join max, m (joins over 5 cm) | 3.0 (17) | 0.315 (10) | 2.298 (124) | Munich max 0.047, Sindelfingen 12 over 5 cm (TASK-082) |
| sharp curb corners (square noses / noses) | 31 (5 / 19) | 22 (2 / 9) | 106 (12 / 21) | Munich 9, Sindelfingen 8; noses Munich 9 of 63 (TASK-092) |
| bulge m2 (nodes) | 105.5 (18) | 22.6 (10) | 36.0 (31) | Munich 36, Sindelfingen 323 (TASK-092, 093) |
| lane overlap outside outlines m2 (pairs) | 640 (64) | 316 (29) | 256 (56) | Munich 647 (TASK-089) |
| same-corridor lane overlap m2 (pairs) | 22.8 (2) | 69.8 (3) | 0.1 (1) | Munich 65 (1, `r:259`/`r:694`), Sindelfingen 0 (TASK-089) |
| unrelated corridor overlap m2 | 287 | 145 | 40 | Munich 115, Sindelfingen 50 (TASK-084, relaxation at 3 m) |
| corridor voids m2 (pairs) | 1 335 (6) | 15 578 (37) | 3 546 (11) | Munich 4 519, Sindelfingen 1 145 (TASK-099) |
| through-road far/near max, m (nodes over 10 cm) | 12 / 3.7 (25) | 4.1 / 3.7 (19) | 5.3 / 1.5 (33) | G2 0 (holds) |
| end overlap within 40 m, m2 | 232 | 117 | 25 | none recorded |
| marking offset max, m (lines over 5 cm) | 0.009 (0) | 0.164 (1) | 0.608 (2) | none recorded |

Regressions against the recorded figures (Munich and Sindelfingen):

- Sharp corners: Munich 9 to 22, Sindelfingen 8 to 31 (most of them 30 to 45 degrees, but Munich
  `n:324` 159, `n:621` 111, `n:549` 93; Sindelfingen `n:87` 175, `n:27` 153, `n:1162` 148, `n:12`
  138).
- Lane folds: Munich 0 to 3 back-steps (`r:589#0` 2.5 m, `r:728#0`), Sindelfingen one cusp
  (`r:1538#0`).
- Continuation joins: Munich max 0.047 to 0.315 m (`n:19`, `n:624`, `n:695` over 0.25 m),
  Sindelfingen 12 to 17 over 5 cm.
- Corridor gap: Munich `r:588`/`r:589` 0.693 m (a two-way pair parting at a node, close-up
  `munich-r588-r589-hatch-crossing.png`).
- Same-corridor lane overlap: Munich 1 to 3 pairs (`r:1030`/`r:687` 2.2 m2 at `n:194` new),
  Sindelfingen 0 to 2 (`r:464`/`r:543` 16.5 m2 at `n:542`, `r:1252`/`r:545` 6.3 m2 at `n:1251`).
- Unrelated overlap and corridor voids grew because TASK-131 turned the relaxation off and removed
  the attach rule (owner's amended B54); not a regression of the rules, but the larger figures now
  stand: Sindelfingen's largest lane overlap is `r:1029`/`r:1178` 212.8 m2 at `n:1028`, Munich's
  `r:29`/`r:958` 87.7 m2 at `n:27`.

Improved: bulge (Sindelfingen 323 to 106), lane overlap outside outlines (Munich 647 to 316).
Freiburg has no earlier figures; against Munich it has 6 times the sharp corners, 12 times the joins
over 5 cm and 6 times the folds.

## Junctions (TASK-213)

Ranked by visibility on the landing view, then by how many places share the pattern.

| # | Case | Ids | What is wrong | Count | Likely code path | Close-up |
| --- | --- | --- | --- | --- | --- | --- |
| J1 | Hauptbahnhof group | `jg:13298` (`n:1`, `n:970`, `n:1147`, `n:461`, `n:476`, `n:488`); Stefan-Meier-Straße `jg:13268` (`n:5`, `n:744`) | Inner roads of a junction group overlap each other inside the one drawn surface; lane blocks of entries cross: `r:1185`/`r:973` 21.3 m2 at `n:260`, `r:1177`/`r:6` 25.7 m2 at `n:5`; nose `n:970` `r:1185>r:973` turns 180 degrees, corner `r:971>r:1185` 175 degrees | 26 of 56 Freiburg lane-overlap pairs (133 of 256 m2) at group members or inner roads; 68 of 118 sharp corners at group members | `groups.ts` (one surface per group) over `junctions.ts` `junctionPolygon`/`cutRegion` per member node; inner roads under 15 m keep full corridor references (`corridor.ts`) | `freiburg-hbf-group-n1-n970.png`, `-3d.png`, `freiburg-n5-n744.png` |
| J2 | Lobed group surface | `jg:13295` `n:651`, `n:652`, `n:916` (Schnewlinstraße, inner `r:653` 4 lanes, 5 m) | Wavy outer edges, the surface bulges round each short inner road's lane block; also the folds of S4 | Bulge 31 Freiburg nodes (19 in groups): `n:828` 8.5, `n:744` 6.3, `n:1142` 6.0 m2 | `junctions.ts` `corner`/`farFillet` per member node, unioned; `continuity.ts` `fitContinuations` on 5 m roads | `freiburg-n652-group-lobes.png`, `-3d.png` |
| J3 | Acute side roads overlapping the main road | `n:430`/`n:289` Greiffeneggbrücke `r:1364`/`r:433` (16.6 degrees, 17.2 m2); `n:889` `r:1322`/`r:891` (16.7 degrees, 7.9 m2) | A street leaving at under 20 degrees is drawn over the main road's lanes past the cut, with both roads' lane lines on it | 30 lane-overlap pairs outside groups (122 m2): also `r:1224`/`r:678` `n:1128` 12.1, `r:1148`/`r:491` `n:1146` 12.1, `r:1706`/`r:1821` `n:1705` 11.9, `r:1381`/`r:2083` `n:900` 11.3 m2 | `junctions.ts` `junctionCuts`/`approachesOf` (acute arm cut square to its own reference); the B55 side-by-side strips (`continuity.ts` `convergingShifts`) only for corridor-like pairs | `freiburg-n430-n289-acute.png`, `freiburg-n1705-kronenbruecke.png` |
| J4 | Curb corners without a radius | `n:44` `r:45>r:1285` 180 degrees (Lessingstraße x Günterstalstraße); `n:128` `r:872>r:130` 166; `n:390` `r:391>r:718` 160; `n:2206` `r:1408>r:2208` 157; `n:660` `r:661>r:719` 152 | Corners turn at a vertex instead of sweeping (B48 again) | 106 sharp curb corners plus 12 noses at 88 Freiburg nodes, 45 over 90 degrees; Munich 22, Sindelfingen 31 (regressions above) | `junctions.ts` `corner`, `nose`, `farFillet` (TASK-092 rules) | `freiburg-n44-corner.png`, `freiburg-n128-corner.png` |
| J5 | Through road bends at a side street | `n:552` Schlossbergring `r:1469>r:556` far 5.25 m; `n:1747` Fahnenbergplatz 3.35; `n:1132` Bismarckallee (signal) 3.33; `n:1462` 2.93; `n:108` lane 1.58 m | The through road's far edge or lanes leave their alignment across the mouth (G2 pattern) | 33 Freiburg nodes over 10 cm, 9 over 1 m; Munich 19, Sindelfingen 25 (`n:436` 12 m) | `junctions.ts` `throughAlignments`, `farThrough` | `freiburg-n1462.png`, `freiburg-n1132.png` |
| J6 | Ramp diverge overlapping its parent (Munich) | Munich `n:27` `r:29`/`r:958` 87.7 m2; Munich `n:194` `r:196`/`r:416` 63.3 m2; Sindelfingen `n:1028` `r:1029`/`r:1178` 212.8 m2 | A ramp leaving a multi-lane road runs on its lanes for tens of metres, drawn as overlapping surfaces with gore spikes on top | 3 hotspots named; one per ramp diverge without a split rule | `junctions.ts` cuts at continuation-less diverges; `continuity.ts` `sideBySide` | `munich-n27-ramp-gore.png`, `munich-n194-n257.png` |

TASK-213 must solve J1 to J5 (Freiburg) and J6 (Munich, Sindelfingen).

## Lane splits and merges (TASK-214)

| # | Case | Ids | What is wrong | Count | Likely code path | Close-up |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | Sawtooth pinch segments | Hauptbahnhof bus area: `r:580`, `r:585`, `r:612`, `r:626`, `r:627`, `r:629`, `r:1267` at `n:578`, `n:579`, `n:598`, `n:600`, `n:610`, `n:611`, `n:617`, `n:620`, `n:624`, `n:628` | 4 to 5 m one-lane OSM segments between two-lane segments each get a drop taper and a gain taper; edges jag, gore hatches are strewn along the road, joins step 0.4 to 1.0 m | 8 pinch roads (these 7 and Bismarckallee `r:1170`); 14 joins on the chain | `lanes.ts` `taperLength` (half a 4 m road) and transitions per road; `lane-drop.ts` `isDroppedLane`; hatch from `marking-geometry.ts` `transitionGeometry` | `freiburg-hbf-bus-sawtooth.png`, `-3d.png` |
| S2 | A gain of several lanes at once draws a fan of spikes | `n:1146` Friedrichstraße `r:1175` (2) to `r:1148` (5); `n:1169` Bismarckallee `r:1170` (2) to `r:1171` (5); `n:1188` `r:2064` to `r:1189` (2 to 4); `n:368` `r:369` to `r:391`; `n:738` `r:737` to `r:847` | Every added lane tapers from the same node, so three hatched spikes overlap and the surface opens as a funnel with a lens-shaped void beside it | 5 Freiburg places; Munich `n:27` shows the same at a diverge | `lanes.ts` transitions (one taper per lane, all from the node); `marking-geometry.ts` `hatchGeometry`/`transitionMarkings` | `freiburg-n1146-gain-fan.png`, `freiburg-n1169-gain-fan.png`, `freiburg-n1152-n1169-forecourt-3d.png` |
| S3 | Lanes step sideways at continuation joints | `n:717` Schnewlinstraße `r:718>r:838` 2.30 m (3 lanes, `jg:13281`); `n:1169` `r:1170>r:1171` 1.41 m; `n:393` `r:394>r:722` 1.00 m; `n:1188` 0.95 m; `n:895` Dreisamstraße `r:1315>r:897` 0.64 m on 4 lanes | Lane dividers jump across a lane at the node, dashes drawn diagonally | 124 joins over 5 cm at 76 Freiburg nodes, 27 over 0.3 m; Munich 10, Sindelfingen 17 | `corridor.ts` `jointReference`; `continuity.ts` `continuationLayout`/`fitContinuations` (`startOffsetM`/`endOffsetM` on roads under 10 m) | `freiburg-n717-n390-joint-step.png` |
| S4 | Lane polylines fold | `r:1185#4` 3.2 m back-step (Zur Unterführung, 5 lanes, 9 m); `r:653#1` to `#3` up to 2.0 m (`n:651`/`n:652`); `r:1563#0` 1.95 m; `r:718#0` to `#2` 1.0 m; `r:394#0` two cusps | Short roads with a lane-count change or a shift fold back on themselves; in 3D the dividers of `r:653` draw a spiked star | 17 Freiburg lanes (11.4 m back-step, 13 self-crossings, 18 cusps), all on roads under 25 m at groups; Munich 3, Sindelfingen 1 | `lanes.ts` taper offsets (smoothstep over `taperStartM` on short roads); `corridor.ts` `offsetLine` fillets | `freiburg-r1563-fold.png`, `freiburg-n652-group-lobes-3d.png` |
| S5 | Chained gains on short roads cross the dividers | Dreisamstraße `r:1311` (2) `n:1310` `r:1316` (3) `n:1312` `r:1314` (4) ... `n:895` `r:897` (5), roads 18, 29, 12 and 7 m | Each gain tapers on its own short road, so the dividers shift at every node and cross one another | 159 lane-count changes in Freiburg, 84 without a taper (69 at junction outlines, 45 at group members, 13 at continuation nodes) | `lanes.ts` transitions per road (a chain of short roads is never treated as one taper) | `freiburg-dreisam-n1312-n1310.png`, `-3d.png` |
| S6 | Merges and diverges at a point | B31 on-ramps `n:536` (`r:678` 2 + `r:1224` 1 into `r:538` 3, edge notch), `n:447` (`r:448` + `r:915` into `r:535`), `n:453` (`r:1089` + `r:1205` into `r:455`); diverges `n:1130` `r:1406` (4 to 3 and 1), `n:544` `r:1380` (4 to 2 and 2), `n:900` `r:901` | Merge and diverge movements get no taper and no parallel merge lane (B16); the outer edge notches where the ramp joins | 13 continuation lane-count changes without taper, all merge or diverge | `lanes.ts` (tapers only for through continuations), `continuity.ts` `sideBySide` | `freiburg-n536-onramp.png`, `freiburg-n453-onramp.png` |

TASK-214 must solve S1 to S6.

## Markings (TASK-215)

| # | Case | Ids | What is wrong | Count | Likely code path | Close-up |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | Arrows at a group entry show the first inner link, not the turn through the group | `r:1277#0` `n:768` Lessingstraße (through shown, turns left); `r:1514#0` `n:1349` Schreiberstraße; `r:850#0` `n:851`; `r:1148#0`/`#1` `n:1147`; `r:130#0` `n:131`; `r:1396#0` to `#2` `n:867` Auf der Zinnen (no left shown) | Arrows contradict the movements the lane has through the group | 9 of the 11 Freiburg lanes whose arrow differs from its geometric turns; 45 group-entry lanes whose movement turns differ from the turns through the group | `marking-geometry.ts` `arrowTurns`/`approachMarkings` read `lane.out` movement turns; group chains (`groups.ts`) are not used | `freiburg-n768-group-arrows.png`, `-3d.png`, `freiburg-n867-n131-group-arrows.png` |
| M2 | Lane dashes on short inner links splay across the junction | `jg:13298` (`n:1`, `n:970`), `jg:13268` (`n:5`), `jg:13281` (`n:717`), `jg:13295` (`n:652`), `jg:13292` (`n:828`, also a centre-line stub inside the junction) | TASK-131 draws lane lines on inner roads; on links under 15 m that turn they read as loose dashes at angles over the junction | 26 of 39 Freiburg groups (12 signalised) | `marking-geometry.ts` `roadMarkingGeometry`, the `road.group !== undefined` branch | `freiburg-hbf-group-n1-n970.png`, `freiburg-n828-inner-dashes.png` |
| M3 | Zebra crossings across the B31 expressway | `n:446` (`r:1692`, `r:448`, a ramp diverge with no street at grade), `n:78` (`r:80`), `n:79` (`r:80`, `r:82`), `n:242` (`r:1492`, `r:551`), `n:913` and `n:1083` (`r:1084`, `r:979`) | Crossings default on at trunk ends of diverges and T-nodes; at `n:446` they are half-width pieces beside a hatch | 10 crossing ends at 6 nodes | `network/crossings.ts` `crossingDefault` (excludes motorways, links, motorway merges, rings, not trunk diverges) | `freiburg-n446-trunk-crossing.png` |
| M4 | Crossings doubled or on top of other paint | `n:1462`/`n:1733` (3 to 4 m apart, over a hatch), `n:1705` Kronenbrücke, `n:403`/`n:461`, `n:2240`/`n:464`, `n:138`/`n:141`, `n:325`/`n:357`; arrows on the zebra at `n:464` (`r:467`); Munich `r:588`/`r:589` zebra over a hatch | Each node places its crossings without regard to the next node's or to hatches and arrows on the same short road | 12 Freiburg places with two crossings within 9 m on one street; 1 arrow on stripes | `network/crossings.ts` `placeCrossing`/`crossingEnabled`; `marking-geometry.ts` `approachShapes` arrow clearance only to its own crossing | `freiburg-n1462.png`, `freiburg-n1705-kronenbruecke.png`, `freiburg-n1152-n464-forecourt.png`, `munich-r588-r589-hatch-crossing.png` |
| M5 | Staggered crossing stripes | `r:460` at `n:403` Bismarckallee (rows 5.5 m apart lane by lane); `n:11` Wallstraße 4.1 m between directions; `n:18` (signal) 2.0; `n:276` 1.4; `n:4` 1.4; Munich `n:27` east arm | Stripes follow each lane's (or each direction's) own cut, so a crossing steps across the road | 6 Freiburg places | `network/crossings.ts` `placeCrossing`/`crossingSpan` | `freiburg-n403-staggered-crossing.png`, `freiburg-n11-staggered-crossing.png` |
| M6 | Stop line in pieces | `r:1185` at `n:970` (pieces 1.04 m apart, each square to its own lane); `r:1479` at `n:1132` 1.43 m; `r:1148` at `n:1147` one of 5 lanes without a stop line | The stop line is drawn per lane at the lane's `stopM`, perpendicular to that lane | 3 of 59 multi-lane stop-line approaches | `marking-geometry.ts` `approachShapes`; `network/stops.ts` | `freiburg-n970-stop-line.png` |
| M7 | No solid lane lines before signals | e.g. `n:1349` Schreiberstraße east arm, `n:768`, `n:44` | German approaches with lanes for different turns carry solid lane lines over the last stretch; every divider is dashed to the stop line | 60 Freiburg approaches whose lanes allow different turns | `marking-geometry.ts` `roadMarkingGeometry` (lane lines only through `roadDashes`) | `freiburg-n1349-dashed-approach.png` |

TASK-215 must solve M1 to M6; M7 is a theme rule for the owner to confirm.

3D: `render3d/markings.ts` triangulates the same `marking-geometry.ts` shapes, so every case above
shows in 3D as in 2D (the `-3d` close-ups). No 3D-only defect was found in the six 3D views.

## Other findings

- `npm run geometry-audit` crashes on main: the named cases R3-1 (`n:1181`) and R3-7 (`n:949`) no
  longer exist since TASK-131 renumbered Munich nodes, and the audit does not include Freiburg. The
  figures above come from a wrapper that skips missing cases; the bench needs its case list re-keyed
  (by OSM node) and a Freiburg entry.
- Checked and not defects: arrows at `n:403` and `n:710` (bear-right lanes), centre lines across
  side-street mouths at T-nodes (`n:1687`), divider ends 4 m before a crossing (the crossing
  clearance).
