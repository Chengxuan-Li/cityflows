# TASK-213 junction shapes (2026-11-18, main edb6b21)

Close-ups of the junction cases of TASK-212's audit (`../2026-11-19-geometry-audit/`), before
(main) and after (branch `task/213-junction-shapes`), from the test build at 760 x 520 px: 2D at 14
px/m (n:44's zoom 40, n:552 12, Sindelfingen 10, Munich 12) with the basemap, places, entrances,
trees and buildings off, and 3D at pitch 55. Freiburg is the bundled project; Munich and
Sindelfingen are imported through the dialog and centred on the audit's node by its OSM id.

## J4: curb corners (changed)

| Node | Corner | Before | After | Rule | Close-ups |
| --- | --- | --- | --- | --- | --- |
| Freiburg `n:44` | `r:45>r:1285` | 180 degrees (a spike along the ramp's edge) | 4 degrees, radius 11.9 m | far-cut curb from either edge | `freiburg-n44-*.png`, `freiburg-n44-zoom-*.png` |
| Freiburg `n:2206` | `r:1408>r:2208` | 157.2 degrees (the chord) | 48.9 degrees, a gore with a 0.65 m fillet | gore at an acute corner over the cut | `freiburg-n2206-*.png` |
| Freiburg `n:660` | `r:661>r:719` | 152 degrees (square gore tip) | 22.8 degrees, radius 1.24 m | gore fillet reach | `freiburg-n660-*.png` |
| Munich `n:324` | `r:325>r:1072` | 158.8 degrees | not sharp | gore at an acute corner over the cut | `munich-n324-*.png` |
| Sindelfingen `n:27` | `r:697>r:29` | 152.6 degrees | 27.2 degrees | gore fillet reach | `sindelfingen-n27-*.png` |
| Sindelfingen `n:1162` | `r:1169>r:1164` | 148.3 degrees | 24.5 degrees | gore fillet reach | `sindelfingen-n1162-*.png` |

The rules (`src/network/junctions.ts`):

1. Far-cut curb from either edge. `farFillet` (TASK-131) fits a curb where the edges' lines meet
   behind both cuts, far behind one: the curb runs straight along the far edge's line from its cut
   corner to the arc. Its curve always started at the first road's cut corner, so when that road
   was the near one the curve ran out along its edge and back (n:44's ramp beside the capped
   `r:1285`). The curve now runs from whichever edge is far.
2. Gore at an acute corner over the cut. Two edges under 90 degrees apart whose lines meet beyond
   one cut and behind the other (a cut corner lying just over the other road's edge) fit no curb
   of 0.5 m beyond both cuts, so the outline took the chord. Where the curb fails there, the
   corner is a gore whose tip is the meeting point, rounded by its fillet.
3. Gore fillet reach. A gore's fillet had to keep its tangent points within the first half of
   either road from the node; on roads of about 20 m cut at the 10 m cap that left no room and
   the tip stayed square. The fillet may now always reach 4 m beyond the tip along either edge,
   leaving a metre of the edge.

Left sharp: Freiburg `n:128` (the inner corner of a hairpin lies on `n:871`'s half of the 6.5 m
`r:872`), `n:390` and Munich `n:621` (group members, see J1), Munich `n:549` and Sindelfingen
`n:12` (curbs on 3.6 m and 7.4 m roads), Sindelfingen `n:87` (arms 31 degrees apart overlapping
past the cap, see J3).

## J5: through roads (measure corrected, geometry unchanged)

`freiburg-n552-before.png`, `freiburg-n552-3d-before.png`: the fork at `n:552`, where measure 4
read the junction surface between `r:556` and `r:554` (29 degrees apart) as `r:556`'s far edge,
5.25 m out. The drawn shape is unchanged by this task.

## J1, J2, J3, J6 (unchanged)

Not changed by this task; TASK-212's close-ups show them as they still are.
