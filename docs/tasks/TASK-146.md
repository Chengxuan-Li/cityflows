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
The renderer's opt-in paint geometry now grows adjacent additions' widths once and gives them
one common interior boundary; the mismatch is **1.17e-13 m**. Both renderers consume this geometry.
The existing single-lane additions and lane drops keep exactly their previous paint.

A before/after census finds paint changes only on Munich `r:654`, `r:958` (Arnulfstraße,
way 316052825), `r:1284` (Westendstraße, way 1421510626), and Sindelfingen `r:1058`
(way 983910197): the four roads with adjacent additions. A lazy cached drawing view replaces
only their surfaces and affected corridor unions. Both scenes, shared markings, 3D surfaces/
slabs and drawn curbs consume it. It never changes the input or rebuilds on each frame.

**The entire physical compiled graph remains byte-identical**, including walk routes,
crossings, parking, signals, movements, spatial-index buffers and typed arrays. Decoded deep
comparison confirms this before and after constructing the drawing view. Munich retains
1,086 lanes, 1,715 movements and 6,880/11,825 walk nodes/links; Sindelfingen retains 3,138/3,728
walk nodes/links. B56, routing and walker timing are unchanged.

The visible outer-curb shifts peak at 1.182355 m (`r:654`), 1.238829 m (`r:958`), 1.099975 m
(`r:1284`) and 1.338506 m (`r:1058`). Original physical walker endpoints remain fixed:
`r:958`'s closest endpoint pair is 3.171 mm inside the corrected visible paving, rather than
1 m outside the old curb; Sindelfingen endpoints stay at least 0.993800 m outside. Sidewalk
drawing clips the unchanged walk ribbons against the corrected asphalt; crosswalk geometry
is unchanged. All added-lane centre samples remain inside their rendered lane strips.

The initial core-surface trial is rejected: its curb-following walk changes (Munich route-
distance bound 4.730810 m; Sindelfingen 0.480811 m including a 0.146139 m corner seam) gave
3 stalled heads against main's 0. The final renderer-only view removes those physical changes;
none of that trial's whole-network snapshot repins is retained. No simulation rule or gate is
relaxed to accommodate the repair.

## Evidence and verification

`D:/cityflows-task146-evidence` contains matched `before-`/`after-` images:
`locator-2d.png`, `gain-close-2d.png`, `gain-close-3d.png` (also raw 3D captures).
They are real CityFlows views, north up and west left, with road/OSM approach labels.
The 3D harness waits for scene construction and rendered frames, rejects a blank central
canvas by pixel diversity, and records zero browser errors. Cameras and the saved city are
identical across the pair; no simulation steps run.

`source-and-compiled.json` retains the OSM and movement trace. `physical-proof.json` and the
`before-`/`after-*-physical.json` pairs retain the complete decoded graph-equality proof and
rendered strip/curb measurements. The red synthetic regression measured a 0.769742 m boundary
mismatch; the repaired regression also checks centre containment, cache reuse and no physical
mutation. Only V114/V117 paint/curb snapshots change. Every physical compilation, canonical
city, lamp and arrow pin stays unchanged.

Verification results are recorded with the final commit. No contract, dependency or source-data
change is required. The additional renderer surfaces wire the same drawing view into 2D/3D
entry points, standalone geometry/marking builders and curb placement.

Renderer-only verification at candidate commit: typecheck/lint pass; 63 focused render tests
pass; decoded physical-graph equality passes for both cities; matched final 2D/3D/locator
captures have zero browser errors. The official light traffic/T53 command passes (two files,
five ordinary tests, unchanged T29 expected failure, 171.43 s), including zero stalled heads.
The passing log does not emit exact completed/gridlocked trip totals. Hosted light e2e passes
all 37 scenarios (4.0 min). Strict hosted check/city results from run 43319239521 remain pending.
