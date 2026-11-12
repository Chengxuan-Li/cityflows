# TASK-146 — Westbound lane gain near Donnersbergerbrücke

After TASK-144 and TASK-145, locate the historical westbound approach east of n:638 by coordinates, mapped ways and direction. The old node identifier is absent from today's compiled Munich map. Trace OSM directional lane counts, turn markings, compiled lanes and legal movements against both browser views. Distinguish a mapped lane gain, faulty import or drawing error; repair a demonstrated defect within this surface and prove the result. Supply location, way IDs, direction of travel and clear 2D/3D shots including a wider locator view. Keep B56 simulation and held branches separate. Use ports 5346/5446.

## Audit and repair (2026-11-12)

The gain is **westbound**, on Arnulfstraße's northern carriageway, approaching Landshuter Allee.
The historical `n:638` camera is `(90.29, -526.03)` m; the Phase 0 `clusters.csv` traces it to
OSM nodes 1475498648, 1475498667, 9990825537 and 245353. Today's crossing members are `n:640`
and `n:649`, within `jg:10807`. The 3-to-5 gain itself is farther east at **`n:652`, OSM
node 297271363, 48.1462083 N, 11.5371639 E**, local `(160.7404, -524.1496)` m.

The bundled OSM snapshot (2026-11-04T05:53:36Z) says, in westbound travel order:

| OSM way | Current roads | Lanes | `turn:lanes` |
| --- | --- | --- | --- |
| 146018788 | `r:699`, `r:1312`, `r:700` | 2 | `left\|none` |
| 146018784 | `r:697` | 3 | `left\|left\|through;right` |
| 146018786 | `r:698` | 3 | `left\|left\|through;right` |
| 134171421 | `r:654` | 5 | `left\|left\|through\|through\|right` |
| 134171420 | `r:651` (inside the group) | 4 | `left\|left\|through\|through` |

All these ways are `oneway=yes`; ordinary `lanes` and `turn:lanes` apply in their node order,
with decreasing longitude/local x. No `lanes:forward` or `lanes:backward` split is involved.
The opposite, **eastbound** way 134583817 (`r:680` and its continuations) stays at two lanes
here. A separate **eastbound 2-to-4 gain** is west of the complex: `r:717` (way 151784481)
enters `r:958` (way 316052825, `left|left|through|through`) at `n:27`, OSM node 21040286,
local `(-10.9790, -529.7495)` m. It must not be confused with `n:652`'s westbound 3-to-5 gain
on the east arm. TASK-131 discussed both sides of this complex.

At `n:652`, legal connections remain `r:698#0 → r:654#0`, `#1 → #1`, and `#2 → #2/#3/#4`.
At `n:649`, lanes 0–3 enter matching lanes of `r:651`; lane 4 turns right into `r:669#1`.
The group's left/through exits retain the two-left/two-through arrangement. The existing
group U-turn reachable from lane 0 is unchanged; this task does not revisit TASK-131's turn audit.

The 3-to-5 count is mapped correctly. The defect was its painted geometry: both added lanes
start at the surviving lane's edge, but `laneEdges` eased their centres a second time and
generated overlapping strips. Their shared-edge mismatch in Munich was **1.05810549 m**.
The shared paint utility now grows adjacent additions' widths once and gives them one common
interior boundary; the mismatch is **1.17e-13 m**. Both renderers consume this geometry.
The existing single-lane additions and lane drops keep exactly their previous paint.

A before/after census finds paint changes only on Munich `r:654`, `r:958` (Arnulfstraße,
way 316052825), `r:1284` (Westendstraße, way 1421510626), and Sindelfingen `r:1058`
(way 983910197): the four roads with adjacent additions. Both cities' canonical roads,
driving lane polylines/permissions and movement geometry hash identically before and after.
Munich retains all 1,086 lanes and 1,715 movements. B56 and held branches are untouched.

The remaining compiled fields are identical except the derived curb-following walk geometry:

- Munich retains 6,880 walk nodes, 11,825 links, every link ID and all attachments. Only six
  `r:958:right` sidewalk segments and ten access joins change geometry/length; maximum endpoint
  displacement is 1.025805 m. The sum of absolute link-length changes bounds any shortest-walk
  distance change by **4.730810 m**.
- Sindelfingen's `r:1058:right/1` sidewalk shortens by 0.334673 m. At `n:594`, one curb meeting
  becomes two nodes joined by a **0.146139 m** corner link (`seam:n:594:1:3/1`): 3,138 to 3,139
  nodes and 3,728 to 3,729 links. Contracting this seam recovers exactly the original graph
  incidence and place/parking/connector/source-node attachments. The corresponding conservative
  shortest-walk distance bound is **0.480811 m**.

Every legal crossing's geometry, control and lane spans are unchanged in both cities.
`walk-equivalence.json` and the `*-walk.json` pairs record this comparison. The lead accepted
these confined curb-following effects, conditional on the city and traffic/T53 gates; no walk
code or walking policy changes.

## Evidence and verification

`D:/cityflows-task146-evidence` contains matched `before-`/`after-` images:
`locator-2d.png`, `gain-close-2d.png`, `gain-close-3d.png` (also raw 3D captures).
They are real CityFlows views, north up and west left, with road/OSM approach labels.
The 3D harness waits for scene construction and rendered frames, rejects a blank central
canvas by pixel diversity, and records zero browser errors. Cameras and the saved city are
identical across the pair; no simulation steps run.

`source-and-compiled.json`, `before-identity.json`, `after-identity.json`, and the two
`*-census.json` files retain the source, movement and geometry evidence. The red synthetic
3-to-5 regression measured a 0.769742 m boundary mismatch; the repaired regression passes.
The whole-network pins in T44/T49/T55/T75 and V106/V107/V108/V117, and V114/V117 paint/curb pins, include
the four corrected envelopes and their derived curb geometry. Only those expected hashes are
updated; canonical city and V108 arrow hashes remain pinned. Gore/paint safety checks report
no invalid overlap.

Verification results are recorded with the final commit. No contract, dependency or source-data
change is required. Additional files are the existing T25 regression and the test files named
above, whose paint-dependent pins necessarily change with this repair.

At candidate commit, `npm run check` passes: 1,150 tests pass, one is skipped; typecheck, lint,
format and build pass. Strict city and light e2e gates are running in hosted probe 43315503410;
the light traffic/T53 gate is running locally, alone. Their final results remain required.
