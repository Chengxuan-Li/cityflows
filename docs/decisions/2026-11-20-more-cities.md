# Decision: more preloaded cities (Lübeck, a UK centre, Philadelphia)

Raised by the owner, 2026-11-20 (the mixed slate of preloaded cities); downloads approved 2026-11-21;
scouted by TASK-259 on 2026-11-21. No source changed.

## Context

The owner wants preloaded real places that show different road cultures and stress the reading rules,
shipped as raw imports (2026-11-20: improve the app's reading of OSM, never edit OSM, no per-id
curation). TASK-197 (`docs/decisions/2026-11-17-landing-city.md`) is the model: the same measurements
and table shapes, the app's own importer and Overpass query, a polygon along a natural edge. This scout
covers Lübeck again (TASK-197 measured it before polygon imports existed), a UK centre with left-hand
traffic (York or Cambridge, picked here), and Philadelphia Center City (the committed bbox fixture and a
polygon re-fetch). Candidates are judged on the raw import.

## Decisions taken during the scout

Nobody was available to ask; these were decided within the contract.

1. **Both UK extracts were fetched and imported** (both were approved), and York was picked on the
   evidence below.
2. **York's polygon takes in the station.** It runs 60 to 150 m outside the walls, so the inner ring
   (Station Road, Queen Street, Nunnery Lane, Bishopgate Street, Paragon Street, Foss Islands Road, Lord
   Mayor's Walk, Gillygate) is inside, and reaches west round York station, 150 to 250 m beyond the
   walls, for its rail.
3. **Philadelphia's polygon is a rectangle along the Center City grid, 1.67 km².** Center City's only
   natural edges are the Vine Street Expressway and the two rivers, which are 3.7 km apart (about 6.5 km²,
   too big for a showcase at this demand). The polygon runs from the expressway (north) to just south of
   Spruce Street, and from 19th Street to 12th Street, around the committed fixture's bbox. Its extract is
   3.6 MB, over the contract's 1 to 2 MB estimate (that estimate came from the committed fixture, which
   has no buildings, land use or trees) and under the 10 MB limit, so it was kept.
4. **Diagnostic imports for the UK cities.** Neither UK extract imports with the current importer (D1,
   D2). To see past the first failure and list the left-hand defects, both were imported a second time in
   a scratch worktree whose importer dropped the parking facilities the final compile rejects (one lot
   each). Every York and Cambridge figure below comes from that diagnostic import and is marked so; it is
   not a candidate result, and the scratch change is gone.
5. **Load and frame budgets were measured with the candidates bundled into a scratch build**
   (`fixtures/projects/<id>.cityflows.json`, opened by `?city=<id>` exactly as Freiburg opens), and
   **Freiburg was measured in the same session** as the reference, because the machine stayed at 52 to
   100% CPU throughout (other agents' runs).

## Candidates

| | Polygon | Edge | Polygon / bbox |
| --- | --- | --- | --- |
| Lübeck | the Altstadt island and the Hbf (TASK-197's polygon) | the Trave west and north, the Elbe-Lübeck canal east, the rail line past the Hbf west | 2.70 / 4.74 km² |
| York | inside the city walls, with the station | the walls and the inner ring outside them; the station west | 1.85 / 2.69 km² |
| Cambridge | between the Cam and the inner ring | the Cam and the Backs west and north (Jesus Green, Midsummer Common inside), Elizabeth Way, East Road, Gonville Place, Lensfield Road, Fen Causeway | 2.43 / 3.14 km² |
| Philadelphia | Center City, Vine Street Expressway to Spruce Street, 19th to 12th Street | the expressway north; the grid elsewhere | 1.67 / 1.69 km² |
| Philadelphia (committed) | `fixtures/osm/downtown.osm`, a bbox, 2026-11-03 | none (bbox) | 1.02 km² |

## Picking the UK centre

| | York | Cambridge |
| --- | --- | --- |
| Edge | the walls on every side, the inner ring just outside | the river on two sides, the ring on two; the polygon cuts the signalised Newmarket Road roundabout |
| Rail | York station, 72 tracks (5.3 km), 4 main-line routes, 40 departures an hour | none (the station is 1 km outside the ring) |
| Signals (OSM nodes / city signals) | 84 / 63, 61 pelican and puffin crossings, 13 toucans, 6 zebras | 31 / 16, 11 puffin and pelican, 9 toucans, 10 zebras |
| Roundabouts | one car-park ring, 3 mini-roundabouts | Four Lamps and the Newmarket Road roundabout, 5 mini-roundabouts |
| Import | fails with left-hand traffic (D1); imports with right-hand | crashes under either side (D2) |
| Diagnostic gate at 0.15 | 3,191 persons, 0 `no_route`, 0 gridlocked, worst visit 156 s | 2,469 persons, 229 `no_route`, 0 gridlocked, worst visit 193 s |
| Traffic at 07:45 | 65 driving | 33 driving: the colleges are a car-free core |

**York.** It has the clearer edge, a main-line station, four times the signals and the UK's signal
crossings, and twice the traffic; Cambridge's only advantage, its roundabouts, is recorded below from its
diagnostic import, so its left-hand findings are not lost.

## Measurements

As TASK-197: scratch scripts that call the repository's `importOsm` (polygon option as
`bench/freiburg.ts`, terrain off), `compile`, `auditJunctions` and `probeMorning` (07:00 to 10:00, 0.15
persons per resident; the drain criterion is TASK-197's all-roads worst single visit against 900 s);
browser figures from `vite build` bundles served by `vite preview` on ports 5459 (test mode) and 5559
(production), Chromium on the GPU (RTX 4070 SUPER, ANGLE D3D11), 1440 x 900, inspector hidden. Load: first
frame after the page's load event, and the 3D view's first frame after the 2D one (the
`qa-production.spec.ts` budgets: 3 s and 5 s, idle). Frame interval and render CPU while playing at 1x
from 07:45 (budgets 4 ms and 6 ms p95, `freiburg-landing.spec.ts`). CPU is the machine's load (28 logical
cores) at the step; free memory was 3.6 to 6.8 GB throughout. Full figures in
`docs/findings/2026-11-20-more-cities/measurements.json`.

| | Lübeck | York (diagnostic) | Cambridge (diagnostic) | Philadelphia | Philadelphia committed | Freiburg (reference) |
| --- | --- | --- | --- | --- | --- | --- |
| OSM extract (MB) | 7.99 | 4.17 | 4.88 | 3.61 | 0.82 (no buildings) | 6.24 |
| Import cold / warm (s), CPU (%) | 32.0 / 39.9, 75 to 68 | 49.2 / 47.5, 78 to 91 | 35.8 / 38.1, 76 to 100 | 40.4 / 36.1, 56 to 75 | 10.9 / 10.4, 79 to 76 | |
| Compile (s) | 4.3 to 4.8 | 5.6 to 6.3 | 5.4 to 5.9 | 3.8 to 4.4 | 1.6 to 1.7 | |
| Nodes / roads / lanes / movements | 816 / 1513 / 1641 / 2319 | 1116 / 2139 / 2267 / 3418 | 588 / 1188 / 1226 / 1949 | 665 / 1071 / 1747 / 2473 | 401 / 659 / 965 / 1444 | |
| Road km (outside polygon) | 65.0 (0) | 65.5 (0) | 52.5 (0) | 53.7 (0) | 33.9 | |
| Signals / junction groups | 46 / 48 | 63 / 78 | 16 / 33 | 151 / 43 | 80 / 24 | |
| Walk links / parking spaces | 16630 / 3204 | 19124 / 1940 | 29623 / 427 | 20195 / 2014 | 14093 / 1016 | |
| Buildings | 5189 | 1433 | 2114 | 1540 | 0 | |
| Rail track km by kind | rail 8.2 | rail 5.3 | none | subway 10.7, rail 7.3, tram 2.1 (all in tunnel) | none | |
| Train routes, departures per hour | 3 main line, 30 | 4 main line, 40 | none | 7 regional (as S-Bahn), 105; 1 trolley route, 10 | none | |
| Bridge / tunnel roads | 32 / 31 | 34 / 98 (D6) | 4 / 50 (D6) | 18 / 23 | 0 / 11 | |
| Gateways / drivable OSM ways crossing the polygon | 9 / 49 | 10 / 66 | 7 / 59 | 22 / 88 | 21 (bbox) | |
| City JSON / project with population (MB, gzip) | 8.3 / 9.2 (1.5) | 6.4 / 6.8 (1.2) | 5.3 / 5.6 (1.0) | 4.8 / 6.5 (1.0) | 1.5 / 1.6 (0.3) | 5.7 (1.0) |
| Junction audit: overlap m² (nodes), escaping movements | 10.6 (3), 0 | 0.9 (4), 1 | 31.6 (2), 2 | 0 (0), 0 | 0 (0), 0 | |
| Production: first frame after load (s), CPU % | 6.4 (100), 5.6 (71) | 8.6 (62), 8.3 (67) | 4.2 (100), 4.1 (52) | 10.2 (85), 9.6 (64) | 4.6 (81), 4.7 (75) | 5.3 (70), 5.0 (52) |
| Production: 3D after the first frame (s); scene build (s) | 10.9, 11.6; 2.7 to 3.0 | 11.4, 12.1; 3.7 to 4.0 | 8.6, 9.2; 1.9 to 2.1 | 16.4, 17.6; 6.9 to 7.9 | 5.7, 5.9; 2.9 | 8.9, 9.2; 3.1 |
| Frame 2D: interval / render CPU mean (p95) ms | 16.7 / 1.15 (4.6) | 16.7 / 0.88 (2.5) | 16.7 / 0.68 (2.2) | 16.7 / 2.49 (9.1) | 16.7 / 0.78 (3.6) | 16.7 / 0.99 (2.8) |
| Frame 3D: interval / render CPU mean (p95) ms | 16.7 / 2.74 (3.4) | 16.7 / 2.00 (2.5) | 16.7 / 1.62 (2.0) | 16.7 / 3.22 (4.1) | 16.7 / 1.42 (1.8) | 16.7 / 3.60 (4.5) |
| In-app step, 07:00 to 07:45 (ms per 0.1 s step) | 0.47 | 0.33 | 0.26 | 0.99 | 0.14 | 0.38 |

Every load figure is about twice its idle value: Freiburg itself took 5.0 to 5.3 s to its first frame
(its idle budget is 3 s) and 8.9 to 9.2 s to 3D (budget 5 s). Read the candidates against that reference:
Cambridge 0.8x, Lübeck 1.1 to 1.2x, York 1.6x, Philadelphia 1.9x Freiburg's first frame; Philadelphia's
3D scene build (6.9 to 7.9 s against Freiburg's 3.1 s) and its 2D render p95 (9.1 ms against 4) fail
outright. Lübeck's 2D p95 (4.6 ms) is over the 4 ms budget at 100% CPU; its mean is 1.15 ms.

## Gates at the showcase demand

0.15 persons per resident, mode choice on (the showcase gate, as Freiburg's: no gridlock, no stalled
head, no `no_route`, every other failure a parking failure under 2% of local arrivals, worst single visit
under 900 s); choice off (every driver drives) is the stress reference. The city hashes were identical
between the cold and warm imports.

| | Lübeck | York (diagnostic) | Cambridge (diagnostic) | Philadelphia | Philadelphia committed |
| --- | --- | --- | --- | --- | --- |
| Choice on: persons, completed by 10:00 | 6825, 2546 | 3191, 1779 | 2469, 1263 | 12926, 4740 | 717, 468 |
| Choice on: gridlocked / stalled / worst visit (s) | 0 / 0 / 94 | 0 / 0 / 156 | 0 / 0 / 193 | 0 / 0 / 306 | 0 / 0 / 29 |
| Choice on: `no_route`, no parking share | **122**, **3.1%** | 0, 1.4% | **229**, 1.1% | **98**, 0.1% | **160**, 0% |
| Choice on: mean delay (s), step (ms), state hash | 110, 0.26, 3776828727 | 90, 0.27, 2391607628 | 101, 0.15, 462132652 | 146, 1.05, 3309201898 | 43, 0.04, 597449598 |
| Choice off: completed, gridlocked / stalled / worst visit (s) | 4322, 137 / 3 / 8276 (fails) | 3122, 25 / 0 / 1362 (fails) | 2170, 0 / 0 / 1378 (fails) | 5258, 402 / 12 / 8406 (fails) | 468, 0 / 0 / 29 |
| **Showcase gate** | **fails**: `no_route` 122, parking 3.1% | **fails**: no import (D1); passes on the diagnostic import | **fails**: no import (D2); `no_route` 229 | **fails**: `no_route` 98; 2D render and 3D build over budget | **fails**: `no_route` 160; no buildings, no places |

Lübeck against TASK-197's bbox import of the same polygon: gateways 1 to 9, worst visit 759 to 94 s,
completed 1,592 to 2,546, road km outside the polygon 5.5 to 0; but `no_route` is unchanged (121 to 122)
with a new cause, the polygon gateways (D7), and the parking share rose from 1.8% to 3.1% (D17).

## Screenshots

Light appearance, Day lighting, at 07:45, no basemap (requests off the machine blocked).
2D overviews are the fitted view the city opens on; close-ups are zoomed at the defect.

Lübeck: ![Lübeck 2D](../findings/2026-11-20-more-cities/luebeck-2d.png)
![Lübeck 3D](../findings/2026-11-20-more-cities/luebeck-3d-showcase.png)
![Holstentor](../findings/2026-11-20-more-cities/luebeck-3d-holstentor.png)
![Wallstraße's dead gateway (D7)](../findings/2026-11-20-more-cities/luebeck-2d-wallstrasse-gateway.png)

The island reads at once; the Marienkirche, the other churches and the Holstentor stand on their building parts.

York (diagnostic import): ![York 2D](../findings/2026-11-20-more-cities/york-2d.png)
![York 3D](../findings/2026-11-20-more-cities/york-3d-showcase.png)
![Mini-roundabout as a plain T (D4)](../findings/2026-11-20-more-cities/york-2d-mini-roundabout-piccadilly.png)
![Yellow kerb lines across a junction (D8)](../findings/2026-11-20-more-cities/york-2d-zebra-tower-street.png)
![Puffin crossing, correct](../findings/2026-11-20-more-cities/york-2d-puffin-skeldergate.png)
![High Petergate through Bootham Bar, no wall (D5)](../findings/2026-11-20-more-cities/york-2d-bootham-bar.png)
![Micklegate Bar missing (D5)](../findings/2026-11-20-more-cities/york-3d-micklegate-bar.png)

The walls, York's edge, are not drawn at all (D5); the footstreet core is a grey block with few places.

Cambridge (diagnostic import): ![Cambridge 2D](../findings/2026-11-20-more-cities/cambridge-2d.png)
![Four Lamps roundabout, correct](../findings/2026-11-20-more-cities/cambridge-2d-four-lamps.png)
![Mini-roundabout as a plain T (D4)](../findings/2026-11-20-more-cities/cambridge-2d-mini-roundabout-parkside.png)
![The polygon cuts the Newmarket Road roundabout (D7)](../findings/2026-11-20-more-cities/cambridge-2d-newmarket-roundabout.png)

Philadelphia: ![Philadelphia 2D](../findings/2026-11-20-more-cities/philadelphia-2d.png)
![Philadelphia 3D](../findings/2026-11-20-more-cities/philadelphia-3d-showcase.png)
![City Hall missing (D9)](../findings/2026-11-20-more-cities/philadelphia-3d-city-hall.png)
![Broad and Walnut, US markings](../findings/2026-11-20-more-cities/philadelphia-2d-broad-walnut.png)

Philadelphia committed: ![downtown.osm 2D](../findings/2026-11-20-more-cities/downtown-2d.png)

## Left-hand traffic: what was checked

On York's and Cambridge's diagnostic imports (`drivingSide: 'left'`, marking theme `uk` inferred), with
a scratch audit of the city and compiled network and the close-ups above:

| Check | Result |
| --- | --- |
| Carriageways of two-way streets left of the way | correct: York 1,866 of 1,866 roads, Cambridge 1,060 of 1,060 offset left (3 Cambridge pairs flagged by a midpoint test on curves, not confirmed) |
| Roundabout circulation and entries | correct: rings clockwise, entries turn left onto the ring and give way (Four Lamps: 6 entries, give-way triangles and double dashed lines) |
| Signal heads, signs and street furniture on the kerb side | correct (2D and 3D follow `drivingSide`) |
| Connectors at the kerb lane, roadside strips | correct: York 241 strips left, 29 right (right-hand kerbs of one-way streets) |
| Bus lanes | correct: at the kerb (York 3, Cambridge 3) |
| Turn on red | correct: none (York and Cambridge 0 movements) |
| Puffin and pelican crossings | correct: two rows of studs, stop lines |
| Import with left-hand traffic | **D1** |
| Protected signal phase | **D3**: the near-side turn gets it |
| Mini-roundabouts | **D4** |
| Driving side by default | **D11** |
| UK kerb markings | **D8**, zebras **D16** |
| Unmarked equal junctions | **D15** |

## Defects

Ranked by what they block. Every fix is a reading or drawing rule, not curation. Ids in brackets are
OSM ids.

| Id | Rank | City | Defect | Evidence |
| --- | --- | --- | --- | --- |
| D1 | blocker, left-hand | York | **The import fails with left-hand traffic.** The final compile rejects lot way 1346647913 (`access=private`): its entry `c:4840` onto Bootham Row (way 24258667, a one-lane service road) has an invalid lane or position (`parking_invalid`), so `importOsm` returns no city. The same extract imports right-hand, the entry on `r:891#0` at 0.0 m. One bad facility fails the whole import. | `results/diagnose.log` (scratch) |
| D2 | blocker | Cambridge | **The import throws** (`TypeError` at `src/network/parking.ts:108`, `compileVisibleParking` from `connectCarExits`) under either driving side: lot relation 2214067 (Trinity College, multipolygon with an inner ring) names place `p:2480`, which is in the parking graph's index but no longer in `city.places`. The import worker dies instead of reporting. | `results/diagnose.log` |
| D3 | high, left-hand | York, Cambridge | **The protected turn phase goes to the near-side turn.** `generateSignalProgram` marks `turn === 'left' \|\| 'uturn'` as the turn to protect (`src/network/signal-program.ts:89`) and gives it a 15 s phase at four-arm signals; under left-hand traffic the near-side left needs no protection and the far-side right does. York: 10 left groups in 15 s phases, e.g. `n:46` (12728664, Monkgate and Lord Mayor's Walk: four lefts), `n:154` (21268518, Blossom Street and Nunnery Lane at Micklegate Bar), `n:477` (27497557); rights get a phase only when they do not fit (4). Cambridge: 9 left groups. Lübeck, right-hand, gives its 11 to the far-side left, as intended. | `lefthand.json`, `protected.ts` |
| D4 | high (UK) | York, Cambridge | **Mini-roundabouts are plain junctions.** `highway=mini_roundabout` is not read: the node is uncontrolled, ranked by road class, with no give way to the right, no circulation and no marking (white disc, arrows, give-way lines). York 27231340, 2369587625 (1424571655 is off the imported roads); Cambridge 104541, 609070, 6572035, 6572064, 14959442 (all tagged `direction=clockwise`). | close-ups |
| D5 | high (York) | York | **The city walls and bars are not fetched or drawn.** The query has no `barrier=city_wall` or `historic=city_gate`, so York's defining edge (the walls and Bootham, Monk, Walmgate and Micklegate Bars) is invisible in 2D and 3D; the roads through the bars read as building passages a level down (D6). | Bootham Bar, Micklegate Bar shots |
| D6 | high | York, Cambridge, Lübeck | **Building passages and covered streets read as tunnels** (TASK-197 finding 8; only Freiburg's curation raises them). York 98 roads at layer -1 (the extract carries 95 `tunnel=building_passage` and 81 `covered=yes` tags; High Petergate 131158813 through Bootham Bar); Cambridge 50; Lübeck 31 (TASK-197 found most of Lübeck's to be building passages). Real underpasses (York's Leeman Road under the railway, 4434469, `tunnel=yes layer=-1`) are right. | `measurements.json` |
| D7 | high | Lübeck, Cambridge, Philadelphia | **Polygon gateways that no route reaches**, the cause of every `no_route`. Lübeck 122: Wallstraße (4095369), where the cut leaves 5 m stubs (`r:3` one lane, `r:4` two) with no movement onward, dead both ways; Burgtor (134664153) out; two places on Wahmstraße (4253783) unreachable inbound. Cambridge 229: Hills Road (4276099) out; the Elizabeth Way and Newmarket Road gateway (54563658, 54563632, 83632354, 521543345) where the ring cuts the signalised roundabout; Victoria Avenue (1328818227); a place on Gresham Road (3128570). Philadelphia 98: Market Street (424807264, 1326494337) out; the inbound connectors on South 12th Street (556954158) and Race Street (584038595); a place on Pearl Street (32077777). York (diagnostic): Foss Islands Road (988768710) takes 30 trips in, none out. A gateway's two connectors may be on roads that do not join the core, and a ring through a roundabout cuts it in half. | `reach.json` |
| D8 | medium, left-hand markings | York, Cambridge | **UK kerb lines are inferred, not read.** Every residential to primary road without a parking strip gets a yellow nearside line (`edgeLineColor`), which reads as no waiting everywhere; OSM's `parking:*:restriction` and `parking:condition` tags (York 18 ways, e.g. Leeman Road `parking:both:restriction=no_stopping`) are not used, single and double yellow are not distinguished, and the yellow line continues dashed across side-road mouths, where UK lines stop. | zebra-tower-street, Lendal close-ups |
| D9 | medium | Philadelphia | **City Hall is not drawn.** Relation 4720912 (`building=civic`, `height=30`, `layer=1`, one outer and three inner rings) leaves an empty plaza at the centre of Center City in 2D and 3D. | City Hall shot |
| D10 | medium | Philadelphia | **Over budget**: 2D render CPU p95 9.1 ms (budget 4), 3D scene build 6.9 to 7.9 s (budget 5; Freiburg 3.1 s in the same session), first frame 1.9x Freiburg's, step 1.0 ms (Freiburg 0.38): 12,926 persons on 151 signals. A smaller polygon or demand is the likely first step. | browser figures |
| D11 | medium, left-hand | all UK | **The driving side is not inferred.** The importer defaults to right (`options.drivingSide ?? 'right'`, `src/importers/osm/index.ts`) and the import wizard starts on Right (`src/ui/import/wizard.tsx`), while the marking theme is inferred from `addr:country` and the location (`uk`). A UK import with the defaults is a right-hand city with UK markings. | code |
| D12 | medium | York | **Time-conditional access and alternating one-ways are not read.** York's footstreets (`motor_vehicle:conditional=delivery @ (08:00-10:30, 17:00-18:00); no @ (10:30-17:00)`, High Petergate 131158813 and others) are open all day; `oneway=alternating` (Leeman Road 4434469, 4019022, 147420937) is unsupported (9 warnings). | diagnostics |
| D13 | medium | Philadelphia | **Transit reads poorly.** Regional rail runs as 7 S-Bahn routes whose stops are named "Platform" (Suburban Station's platform names, not the station's); the trolley tunnel's route has a stop named "3"; the Market-Frankford and Broad Street subways (10.7 km) carry no service. All of it is underground. | `measurements.json` |
| D14 | low | Philadelphia committed | **`downtown.osm` cannot be a preloaded city**: it has no buildings or land use, so its only places are 21 gateways (717 persons, gateway to gateway), and 160 of them (22%) find no route. | gate table |
| D15 | low, left-hand | York, Cambridge | **Unmarked equal junctions mirror priority to the right** into priority to the left (`yieldsTo`, `src/sim/intersection.ts:698`); the UK has no such rule (give way by the road hierarchy). Not seen to cause a failure. | code |
| D16 | low, left-hand markings | York, Cambridge | **Zebras lack zig-zag lines** (and Belisha beacons in 3D): drawn as plain bars (Four Lamps, 14959446). | Four Lamps close-up |
| D17 | low | Lübeck | **Parking failures 3.1%** of local arrivals (gate: under 2%): 16 on Fährstraße (`r:353`, 4540598) and 36 unspawned; 40 facilities without a car exit, 16 lots without a reachable aisle (Am Güterbahnhof). | diagnostics |
| D18 | low | all | Smaller reading gaps: `oneway=faux` (Lübeck 119880660, 150345381); restriction relations ignored (Lübeck 17, Philadelphia 12, via node outside the roads); signals that never serve a movement (Philadelphia `n:1020`, `n:653`; York `n:503`); service estates outside the network (Lübeck 171 lanes, Philadelphia 82, York 64, Cambridge 27); junction overlap at Lübeck `n:1268` (1475068583, 10.2 m², as in TASK-197). | diagnostics |

## Candidate fix tasks

1. **UK imports that import (D1, D2).** The importer reports one bad parking facility and drops it, never
   fails or throws for it; fix both causes (the left-hand entry on Bootham Row, the lot whose place is
   gone). Gate: York and Cambridge import under left-hand traffic; hashes of the other cities unchanged.
2. **Left-hand signal programs (D3).** The protected turn is the far-side turn for the driving side. Gate:
   York's four-arm signals protect rights; right-hand cities' programs and hashes unchanged.
3. **Mini-roundabouts (D4, D16).** Read `highway=mini_roundabout` as a give-way-to-the-circulating-flow
   node with its marking; UK zebra zig-zags. Gate: the eight nodes above yield and are drawn.
4. **Driving side from the location (D11, D15).** Infer `drivingSide` as the marking theme is inferred;
   the wizard proposes it; UK unmarked junctions rank by hierarchy.
5. **UK kerb markings from OSM (D8).** Kerb lines from parking restriction tags, single and double
   yellow, stopped at junction mouths.
6. **Polygon gateways that route (D7).** A gateway only where its connectors reach the core both ways (or
   the cut stub is joined to its junction); a ring does not halve a roundabout. Gate: `no_route` 0 in
   Lübeck, Cambridge and Philadelphia.
7. **Reading rules for passages and access (D6, D12, D18's `oneway=faux`).** Building passages at grade
   (Freiburg's curation as a rule), conditional access, alternating one-ways.
8. **City walls and gates (D5).** Fetch and draw `barrier=city_wall` and the gates (a query version bump
   and a re-fetch, needing the owner's yes).
9. **Landmark multipolygons (D9).** City Hall's relation drawn.
10. **Transit naming and subways (D13).**
11. **Big-city budgets (D10).** Philadelphia within the load and frame budgets, or a smaller polygon.
12. **Lübeck parking (D17).**

## Recommendation

- **Lübeck: bundle after D7 and D17** (task 6 and 12). It is the strongest showcase of the four: the
  island edge, the Holstentor and the churches on their building parts, three main-line
  routes, and the calmest traffic (worst visit 94 s); its load is within 1.2x of Freiburg's. Its two gate
  failures are the polygon gateways and the parking share, both reading rules.
- **York: bundle after D1, D3, D4 and D11** (tasks 1 to 4), better with D5, D6, D8 and D12 (tasks 5, 7,
  8). On the diagnostic import it passes the showcase gate (0 `no_route`, no gridlock, worst visit 156 s,
  1.4% parking failures) and stays in budget apart from a load 1.6x Freiburg's; it is the first
  left-hand city and shows the UK's signal crossings, but without its walls it is not yet York.
- **Cambridge: drop as the UK city;** keep its extract for the roundabout and mini-roundabout tests of
  tasks 3 and 4 (D2 must be fixed first).
- **Philadelphia (polygon): bundle after D7, D9 and D10** (tasks 6, 9, 11). It shows what no German city
  does (one-way grid, 151 signals, right turn on red at 89 of them, US markings, the expressway in its
  trench), but it fails the gate on `no_route`, has lost City Hall and is over the frame and 3D budgets.
- **Philadelphia committed (`downtown.osm`): drop** (D14).

## Data sources

© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright). Downloaded 2026-11-21
for this scout and kept outside the repository (`D:\cityflows-wt\259-data`); none is committed. Query:
the app's Overpass query (`buildQuery` in `src/importers/overpass.ts`, `queryVersion` 10) with every
`(s,w,n,e)` filter replaced by `(poly:"…")` with the polygon below (lat lon pairs) and `[timeout:180]`;
one request at a time to https://overpass-api.de/api/interpreter, client `cityflows-scout/1.0`. Overpass
returns every way that touches the polygon whole; the files have no bounds element.

```text
luebeck-altstadt.osm — the Altstadt island and the Hauptbahnhof, Lübeck, Schleswig-Holstein
Source: https://overpass-api.de/api/interpreter, requested 2026-11-21T07:00:41Z, finished 07:01:39Z
OSM snapshot: 2026-11-21T07:00:36Z
Polygon: 53.876 10.6895 53.8738 10.682 53.8725 10.6775 53.8708 10.673 53.868 10.666 53.865 10.669
53.864 10.6745 53.8618 10.679 53.856 10.687 53.8612 10.695 53.8655 10.6982 53.871 10.6985 53.8752 10.695
BBox of the polygon: 10.666, 53.856, 10.6985, 53.876
7,986,825 bytes, SHA-256 4557d9e505e975b6bc844e12f3b0e3dd1bbcbbdda03ecc94174505be6f1a2f44

york-walls.osm — inside the city walls, with the station, York, North Yorkshire
Source: https://overpass-api.de/api/interpreter, requested 2026-11-21T07:01:49Z, finished 07:02:41Z
OSM snapshot: 2026-11-21T07:01:36Z
Polygon: 53.9655 -1.0835 53.9634 -1.0872 53.9628 -1.0895 53.9614 -1.0908 53.9604 -1.0945 53.9592
-1.0975 53.9556 -1.0968 53.9543 -1.0925 53.9522 -1.0885 53.9514 -1.0842 53.952 -1.0808 53.9521 -1.078
53.9533 -1.0737 53.9555 -1.0718 53.9577 -1.0713 53.9611 -1.0724 53.9633 -1.0754 53.9647 -1.0775
BBox of the polygon: -1.0975, 53.9514, -1.0713, 53.9655
4,171,757 bytes, SHA-256 762dc47387d41ed9425fc902638a93d407e0a5fc7189d8deec6aa826ab21f057

cambridge-centre.osm — between the Cam and the inner ring, Cambridge, Cambridgeshire
Source: https://overpass-api.de/api/interpreter, requested 2026-11-21T07:02:51Z, finished 07:03:39Z
OSM snapshot: 2026-11-21T07:01:36Z
Polygon: 52.1978 0.1135 52.201 0.1132 52.205 0.1128 52.208 0.114 52.2102 0.115 52.2124 0.1185 52.2129
0.126 52.2136 0.134 52.2096 0.1378 52.205 0.1357 52.201 0.1336 52.1985 0.13 52.1975 0.126 52.1975 0.12
52.197 0.116
BBox of the polygon: 0.1128, 52.197, 0.1378, 52.2136
4,880,921 bytes, SHA-256 ff8c3aff55712c8deb25e2616b06e1d8556b1e42d8255428e19beef5e39567c0

philadelphia-center-city.osm — Center City, Vine Street Expressway to Spruce Street, 19th to 12th
Street, Philadelphia, Pennsylvania
Source: https://overpass-api.de/api/interpreter, requested 2026-11-21T07:03:49Z, finished 07:04:42Z
OSM snapshot: 2026-11-21T07:02:38Z
Polygon: 39.9592 -75.159 39.9592 -75.17 39.9585 -75.1722 39.9566 -75.173 39.9465 -75.173 39.9465
-75.159
BBox of the polygon: -75.173, 39.9465, -75.159, 39.9592
3,614,043 bytes, SHA-256 0dd8a433d90f8fa5ac064edf1cc38e1d67c8c146fcbe6d0bfcc03c779cc68ef4
```

The committed `fixtures/osm/downtown.osm` (819,800 bytes, SHA-256
39727ff88f892bfa453edf86fcd8e9776e730cb616d8ae9579b0e3edda4417fd, snapshot 2026-11-03T22:23:38Z) was
imported with its bbox.

## Numbers taken under load

The machine ran at 52 to 100% CPU for the whole scout (other agents' benchmarks and tests); every timing
carries its CPU figure, and free memory stayed between 3.6 and 6.8 GB (each headless run waited for 4 GB free before it started). The
browser figures were taken in one session with Freiburg as the reference, which is why the tables compare
against Freiburg's same-session figures rather than its idle budgets. Imports ran two at a time and are 2 to 3x TASK-197's idle Lübeck (32 to 40 s against 21.7 s). The gate results
do not depend on load: the simulation is deterministic, and each city's cold and warm imports gave the
same city hash. Scratch scripts and raw reports are in `D:\cityflows-wt\259-evidence` (`measure.ts`,
`lefthand.ts`, `reach.ts`, `browse.mjs`, `closeups.mjs`).
