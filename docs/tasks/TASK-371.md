# TASK-371 — Inner roads without stub lane blocks, third try: traffic unchanged by construction

Status: parked 2026-11-27 (branch `task/371-inner-stubs` at `ddf5a48c`), owner decision: traffic identical by construction, but the census ends at 1 / 0 / 0 (not 0), the audit is +4.9 cm on Freiburg's worst through deviation, and it adds `CNode.cutOutline` (a contract change). The app already draws no stub. Owner said "start both"; city work merges under the traffic merge rule and the audit
tolerance). Owner: Claude subagent (Opus 5.5). Base: main `5f172cb6`.

## Finding (TASK-348 rule 1, TASK-368)

Inner roads of junction groups keep stub lane blocks under the 5 m trim floor: 69 / 30 / 121 in Munich, Sindelfingen
and Freiburg. TASK-368 removed them (census to 0; J1-hbf overlap 31.12 → 6 m²) in two versions. Both moved the covered
lane slices into the adjacent movements. Both changed the conflict partners of 165 movements, and both failed:
- Munich actuated delay +4.7% / +9.9%;
- Freiburg 62 → 76 s;
- London City worst visit 802 → 1,111 s or more;
- J1-stefan overlap stayed at 25.96 m², and Sindelfingen gained a sharp corner.

Read TASK-368's Result (branch `task/368-inner-floor`, `60dcd7d3`) and TASK-348.

## Goal

Remove the stubs without changing traffic. The simplest form to try first is **drawing and geometry only**: the
compiled lane graph keeps its lengths, movements and conflict zones, and the stub is drawn as part of the group's
surface (TASK-347) instead of as a lane block. This follows the owner's decision 2 for TASK-348, corners
drawing-only. If the audit or the census reads the compiled lanes, so that drawing-only cannot move them, say so
with evidence. Then design the smallest change to the compiled geometry that keeps every movement's conflict
partners and offsets, and test that they are unchanged.

## Scope

`src/network/compile.ts`, `lanes.ts`, `junctions.ts`, `continuity.ts`; the drawing of group surfaces (`src/render`
group-surface and lane-block code, if that is where the stub is drawn); tests; bundled-city rebuilds
(`bench/bundled-cities.ts`, all of them, including York and Zurich) and re-pins.

Out of scope: `src/sim/**`, `src/schema`, signal programs, group membership (`split.ts`),
`bench/geometry-audit.ts` (unless it must read the drawn surface instead of compiled lanes; then stop and report),
`bench/traffic-baseline.json`, OSM edits, per-id curation.

## Gates

- Census 69 / 30 / 121 → 0, by whichever measure the audit uses (state it).
- J1 overlap about 0; sharp corners not worse; geometry audit against main within the audit tolerance.
- Traffic: if the compiled network hash is unchanged, traffic is identical by construction (check one hash per city).
  Otherwise, the owner's full merge rule:
  - Munich 0.15 seeds 1–12, four configurations, within 3%;
  - full demand within 2% on seeds 1–5, both modes;
  - Freiburg within 5 s; drain;
  - Sindelfingen; showcases.
- Close-ups of J1-hbf, J1-stefan and one Freiburg group before and after (PNG).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Result

**Census 1 / 0 / 0 (from 69 / 30 / 121), J1-hbf lane overlap 31.12 → 6.09 m², traffic identical by
construction.** Branch
`task/371-inner-stubs`. The lane graph is untouched; only the members' junction polygons grow.

### What the audit and the census read

- The 2D and 3D drawing already shows no stub. TASK-131/215 draw an inner road under `INNER_LINES_M`
  (15 m) with no lines at all (`marking-geometry.ts`), and TASK-347's group surface covers it.
  So no drawing change could move a measure.
- Measure 9 (lane overlap, `overlapPieces`) reads the compiled lanes (`net.lanes`, `laneEdges`).
  It leaves out only what lies under a `CNode.outline` of the same grade, not the group surface.
- TASK-368's census reads `road.stations`, the compiled lane block span.
- The simulation reads lane lengths, stop positions and polylines (`sim/manoeuvre.ts`,
  `intersection.ts`, poses). It does not read `CNode.outline` (nothing in `src/sim`, `routing`,
  `demand`, `host`).
- Any change to the lanes moves traffic. TASK-368's V2 kept all 2,051 movements' conflict partners in
  Freiburg; I re-compiled it here. It changed 256 lane lengths and stops and 426 movement lengths,
  and it still failed traffic. So "keep partners and offsets" was not enough.

### Rule

An inner road shorter than its members' cuts and 5 m keeps its 5 m floor. Its lanes, movements,
conflicts, stops and connectors compile exactly as before. Each member's `CNode.outline` takes in
the slice of the inner road's surface beyond the part the cuts leave (`coveredSlices`):
- the slice is at least 0.5 m (`INNER_SEAM_M`);
- the removed span is shared in proportion to what each cut takes beyond the lanes' end;
- the slice runs on 5 cm into the outline (`coverInnerSlices`);
- a slice is taken only where the union stays one ring, with no hole over 0.1 m² and no
  self-crossing (Munich `n:340` would cross itself).

`CNode.cutOutline` keeps the outline as before. It is set only where slices were added, and it is
read through `cutOutline(node)`. Crossings, the walk graph, stalls, rail, catenary, level crossings
and the importers' tram stops and rail forms read it, so everything placed against the junction is
unchanged. The render reads it in the same way: the paint, 3D walk and footbridges, rail drawing,
street furniture, trees, parked cars and labels. A member's own fill reads it too: filled over the
lane lines, the grown outline hid TASK-229's dashes on the carriageway at J2. Only the group
surface (which already covered the slices) and picking use the grown outline. Paint (V114), the 3D walk (`walk-height`) and rail geometry stay
byte-identical. A city without such a member, such as the grid or the town, compiles byte-identically.
The new field is documented in architecture §5 and §5.1, where it replaces the deferred rule 1.
The dead rule-1 plumbing is removed (`INNER_LANE_M`, `INNER_LANE_M_PENDING`, the per-road floors
in `compile.ts` and `continuity.ts`). Output without it is byte-identical.

### Census (inner roads under the 5 m floor)

| City | Under the floor | Stations census (TASK-368) | Drawn census, main | Drawn census, TASK-371 |
| --- | ---: | ---: | ---: | ---: |
| Munich | 69 | 69 → 69 | 54 | 1 |
| Sindelfingen | 30 | 30 → 30 | 20 | 0 |
| Freiburg | 123 | 121 → 121 | 87 | 0 |

The drawn census counts lane surface outside both members' outlines over more than the seam the
cuts leave, plus 5 cm. It is sampled every 5 cm along the stations, at the middle of each lane's
`laneEdges` and within the road surface. This is what measure 9 counts as a lane block. The
stations census cannot move without moving lanes, and so traffic. Munich's remaining road is
`r:1332` at `n:340`: 4.00 m is exposed against the 2.98 m the cuts leave. Its slice is left out
because it would make `n:340`'s outline cross itself (T20, T38.2).

### Geometry audit (unmodified) against main `bdf28fc8`

| Measure | Main | TASK-371 |
| --- | ---: | ---: |
| J1-hbf lane overlap (m²) | 31.12 | 6.09 (`r:405/r:460` 5.60 is not an inner road) |
| J1-stefan lane overlap (m²) | 25.96 | 25.96 (`r:1177` is an approach and `r:6` is not under the floor) |
| J2 lane overlap (m²) | 12.14 | 0.27 |
| Freiburg lane overlap (m²), pairs | 200.97, 44 | 132.94, 40 |
| Munich / Sindelfingen lane overlap (m²) | 192.26 / 640.41 | unchanged |
| Sharp corners, Freiburg / Munich / Sindelfingen | 60 / 15 / 25 | 60 / 15 / 25 |
| Square noses, Freiburg | 26 | 25 |
| Through far deviation, worst, Freiburg (m) | 1.778 | 1.827 |
| Through near deviation, worst, Freiburg (m) | 1.499 | 1.505 |
| Through nodes over 10 cm, Munich / Freiburg | 16 / 28 | 17 / 28 |

Sindelfingen's audit is identical in every total. The through-deviation change is outside the
tolerance (+4.9 cm), but it is a change of measured extent, not of geometry:
- The drawn region D (incident road surfaces and outline) is unchanged. No outline adds area
  outside its cut outline and its roads' surfaces in any of the three cities.
- The audit measures stations over the outline's projected extent. At `n:2236`
  (`r:663>r:2237`) and Munich `n:1` (`r:4>r:301`), the outline now reaches 6 to 7 m further along
  the inner road. There, that road's own surface is already 1.8 to 1.9 m off the through corridor.
- Not covering at through-pair members keeps the audit inside tolerance, but leaves the census at
  15 / 10 / 34.

### Traffic

Every compiled city, with the two outline fields left out, is byte-identical to main. Each city's
`cutOutline` equals main's `outline`, and the walk graph is identical. This holds for 12 cases:
the Munich and Sindelfingen audit imports and all ten bundled archives, including York, Zurich,
Boston and Heathrow. The full compiled hash changes only where a member takes in a slice. The simulation never reads either, so traffic is identical by construction. Measured
checks:

| Run | Main state hash / delay / completed | TASK-371 |
| --- | --- | --- |
| Munich 0.15 s1 fixed, choice off | 64388273 / 704.79 / 5307 | identical |
| Munich 0.15 s1 fixed, choice on | 2142289963 / 128.77 / 2545 | identical |
| Munich 0.15 s1 actuated, choice off | 2303892435 / 615.70 / 5312 | identical |
| Munich 0.15 s1 actuated, choice on | 3476462186 / 84.00 / 2581 | identical |
| Munich full demand s1 actuated | 3866269405 / 1765.66 / 3559 | identical |
| Freiburg gate s1 | 55277987 / 61.00 / 1527 | identical |
| Sindelfingen full demand s1 | 1876791207 / 17.74 / 2965 | identical |
| London City showcase s1 | 821146038 / 385.72 / 1993 | identical |

All nine buildable bundled archives rebuilt byte-identically with `bench/bundled-cities.ts`.

### Close-ups

`D:\cityflows-wt\330-pilot\R\t371\png\`, before (main) and after, for J1-hbf (`n:1`/`n:970`),
J1-stefan (`n:5`) and J2 (`n:651`/`n:652`/`n:2236`):
- `*-2d-*` and `*-3d-*` are app shots of the Freiburg landing city, made by a scratch Playwright spec
  on port 5395 (`closeups.spec.ts` there; not committed). Before and after differ by 0 to 3 pixels:
  the drawing already showed no stub.
- `*-lanes-*` show what measure 9 sees: inner-road lanes in orange where they lie outside every
  node outline. The stubs become 0.5 m seams.

### Tests and pins

`tests/network/junction-lanes.test.ts`: the skipped rule-1 test is replaced by two tests. One
checks that the inner roads of an 8 m median crossing keep 5 m of lanes, with no lane surface
outside the members' outlines beyond the seam. The other compiles the same city with the slices
mocked off and checks that every movement's length, conflict partners and zones are unchanged,
that the whole compiled city without the outlines is unchanged, and that `cutOutline` equals the
outline without slices. Both fail without the rule.

T42.1 checks each node's own corners on `cutOutline`, which is main's outline. A member's slices
lie inside the group's one surface, where no curb is drawn. The geometry audit measures the drawn
group surfaces and still finds 60 / 15 / 25 sharp corners. Without this change, T42.1 named two
slice joints at Sindelfingen (`n:396`, `n:890`).

Re-pinned for Munich's and Sindelfingen's compiled networks, with a TASK-371 comment at each pin: T44, T49, T55,
T75, V106, V107, V108 and V117. In each, only the outlines differ. The four airport compiled-graph
pins in `bundled-airport-load` are re-pinned too. Their startup states and flight boards are
unchanged.

### Verification

| Command | Result |
| --- | --- |
| `npm run check` (3 workers) | Pass: 307 files passed, 1 skipped; 2,207 tests passed, 1 skipped; `✓ built in 1.68s` |
| `npm run test:city` (3 workers) | Pass: 77 files passed; 291 tests passed, 1 skipped |
| `npm run test:traffic:light` | Pass: 2 files passed; 5 tests passed, 1 expected fail (100.7 s) |
| `npm run test:e2e:light` (port 5395) | Pass: 63 passed (3.4 min) |
| `tests/traffic/bundled-airport-load.test.ts` | Pass after the re-pin: 4 passed, startup states and boards unchanged |

### Gates

| Gate | Verdict |
| --- | --- |
| Census 69 / 30 / 121 → 0 | 1 / 0 / 0 by the drawn measure (Munich `r:1332`, left out to keep `n:340` simple); 69 / 30 / 121 by stations, which cannot move without moving traffic |
| J1 overlap about 0 | J1-hbf 6.09 m², of which 5.60 is `r:405/r:460`, not an inner road; J1-stefan 25.96 is not a stub (TASK-368's finding) |
| Sharp corners not worse | Pass: 60 / 15 / 25, unchanged |
| Audit against main within tolerance | Every total is equal or better except Freiburg's worst through far deviation, +4.9 cm (a longer measured extent with D unchanged; see above), and through nodes over 10 cm in Munich, 16 → 17 |
| Traffic | Identical by construction: the compiled city minus the outlines is byte-identical in all 12 cases; eight runs have equal state hashes |
| Close-ups | `D:\cityflows-wt\330-pilot\R\t371\png\` |
| Tiers | Pass |
