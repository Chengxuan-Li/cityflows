# TASK-216 road shapes against aerial imagery: Freiburg Hauptbahnhof (2026-11-19, main 026720d)

Read-only check of the bundled Freiburg project (`?city=freiburg`) against LGL Baden-Württemberg's
20 cm orthophotos, for the box around the Hauptbahnhof in the project's frame x -630 to 230 m,
y -690 to -90 m (860 m by 600 m: Bismarckallee from the Stühlinger bridge to Friedrichstraße, the
ZOB, the Hauptbahnhof junctions, Stefan-Meier-Straße and Zur Unterführung, Friedrichstraße to the
Rotteckring and Friedrichring junction, the Rotteckring tram). West of the rail line the box lies
outside the city's polygon, so only the Stühlinger bridge's tram has anything to compare there.
TASK-212's junction groups `jg:13298` and `jg:13268` are `jg:13297` (Hauptbahnhof, 11 members)
and `jg:13267` (Stefan-Meier-Straße) since the project was rebuilt at TASK-214's merge.

## Imagery and licence

- Service: `https://owsproxy.lgl-bw.de/owsproxy/ows/WMS_LGL-BW_ATKIS_DOP_20_C` ("WMS LGL-BW
  ATKIS Digitale Orthophotos in Farbe 20 cm Bodenauflösung", keyword
  `WMS_LGL-BW_ATKIS_DOP_20_C_V06`), layer `IMAGES_DOP_20_RGB`, found through LGL's metadata
  (capabilities `MetadataUrl`, record `4927a198-e9ce-da9a-a5ef-c11f21ff173f` on
  metadaten.geoportal-bw.de). No credentials.
- Licence, from the capabilities and the metadata record: fees "Unentgeltliche Nutzung nach Open
  Data Lizenz"; access constraints "Datenlizenz Deutschland - Namensnennung - Version 2.0"
  (`dl-de/by-2-0`, https://www.govdata.de/dl-de/by-2-0), source note with the holder and the
  year of retrieval.
- Attribution used on every close-up: **Orthophoto: LGL-BW (2026) Datenlizenz Deutschland -
  Namensnennung - Version 2.0, www.lgl-bw.de**; roads and paint: OpenStreetMap contributors, ODbL.
- Fetched once, 2026-11-19: 15 JPEG tiles of 860 x 1000 px in EPSG:3857 at 0.2 m ground pixels,
  2.2 MB, kept in `D:\cityflows-wt\216-data` (outside the repository). The project's frame is Web
  Mercator scaled about its origin, so an EPSG:3857 image maps onto it by a scale and a shift. The
  service does not give the flight date in the capabilities; the box shows no road works that
  differ from the OSM snapshot of 2026-11-18.

`bench/aerial-overlay.ts` reproduces everything: `fetch <data-dir>` (stops unless the
capabilities still state the open licence), `register <data-dir>`, `render <data-dir> <out-dir>`
(the close-ups below; `--sweep` for the 30 overview tiles, `--view` for ad hoc views with
cross-sections) and `shots3d <out-dir>` (the same cameras in the app's 3D view, dev server on
port 5416). The overlay draws, from the compiled city: the drawn carriageway's edge (cyan; the
union of road surfaces, junction polygons, tapers and gore pavement; dashed below grade), parking
strips (green dashed), lane, edge and centre lines and arrows (yellow), hatches (orange), stop
lines (red), crossing stripes (magenta), OSM centrelines (white dotted) and tram rails (orange).

## Registration

Four stretches of tram track, embedded in asphalt (Rotteckring) or on a grass bed (the curve into
Friedrichring): the imagery's grey level is averaged along each stretch at offsets across it, and
the visible track's centre is the midpoint of its pair of rail lines (1.0 m apart at this pixel
size). Offsets right of travel:

| point | stretch | length | visible track centre | residual after the constant |
| --- | --- | ---: | ---: | ---: |
| P1 | Rotteckring northbound (way 440945775) | 70 m | -0.35 m | -0.08 m |
| P2 | Rotteckring southbound (way 440945776) | 70 m | +0.30 m | +0.03 m |
| P3 | curve into Friedrichring, northbound (440945775) | 17 m | -0.15 m | +0.12 m |
| P4 | Friedrichring westbound (440945776) | 14 m | +0.15 m | +0.04 m |

Least-squares constant: 0.27 m (x -0.23, y -0.15: the ground lies 0.27 m west-north-west of the
drawn tracks), about 1.4 imagery pixels. Every raw offset is under 0.4 m, so no correction was
applied; the figures below are uncorrected. Close-up `registration-p1-rotteckring.jpg`.

## Defects

Ranked by what a viewer of the landing page notices first, then by size. Figures are measured on
the imagery: offsets on cross-sections with metre ticks (`--view ...,r:<id>@<station>@<half>`
prints the drawn kerbs' offsets) or between points read off 10 to 20 px/m close-ups (about 0.3 m).
Each close-up has a 3D twin (`<id>-3d.jpg`, the app's 3D view at the same centre, buildings,
trees and places off, no imagery).

| # | Defect | Ids (OSM) | Measured | Class | Close-up |
| --- | --- | --- | --- | --- | --- |
| D1 | Zebra stripes at nearly every junction arm, none where the ground has them | 167 crossing ends at 63 nodes in the box (114 on non-service roads); mapped zebras 2479358348 (`n:211`), 9118444286 (`n:1139`), 31456088, 303192148, 320091867 | 155 of 167 drawn crossings lie more than 4 m from any mapped crossing; of 54 mapped crossings (5 zebras, 31 signalised, 8 unmarked, 10 other) only 12 signalised ones have a drawn crossing within 4 m, no zebra does. Painted zebra at `n:211` 5.4 m from the drawn one; at `n:1139` the zebra is on the east arm, drawn on the west and south arms 13 and 17 m away. In crops of all 114 non-service ends, stripes show on the ground at about 5 places | Geometry rule: `src/network/crossings.ts` places crossings by default per arm and ignores mapped crossing nodes and their markings (zebra, signal dashes, unmarked) | `D1-crossings-n211-n1139` |
| D2 | Hauptbahnhof group reaches 35 m along Friedrichstraße: stop line and zebra across the five westbound lanes, stop lines on the eastbound side | `jg:13297` members `n:1147`, `n:483`, `n:488`; crossover `r:1876`/`r:1877` (way 795829487, `highway=service`, no other tags) | Drawn westbound stop line 37 m before the painted one (where the queue stands); the painted lanes run on through it | Geometry rule (junction groups, J1): an untagged median crossover makes its nodes signalised members with stop lines and crossings; a curation entry for way 795829487 is the stop-gap | `D2-group-stop-line-n1147` |
| D3 | Five-lane approaches 2 m too wide, drawn over the island and the painted gore | Stefan-Meier-Straße `r:1179` (way 233466343), Zur Unterführung `r:261` (23024402) | `r:1179`: drawn 17.5 m (kerbs +8.7 / -8.8), ground 15.5 m (+9.5 / -6.0), 2.75 m over the gore. `r:261`: drawn 17.8 m (+8.8 / -9.1), ground 16.0 m (+9.5 / -6.5), 2.6 m over the island. Lanes 3.5 m drawn, about 3.1 m painted. Bismarckallee `r:1171` (5 lanes) fits: drawn 18.0 m, ground about 17.5 m | Importer inference: `src/importers/osm/roads.ts` gives every lane 3.5 m (3.0 m on residential and service roads) | `D3a-width-r1179-stefan-meier`, `D3b-width-r261-zur-unterfuehrung` |
| D4 | Stop line of Stefan-Meier-Straße drawn past the signalised cycle crossing, inside the junction; Zur Unterführung's turned across its crossing | `r:1178` at `n:1` (OSM 21875552), crossing node `n:1077` (303192187, `crossing=traffic_signals`, compiled uncontrolled); `r:1185` at `n:970` | `r:1178`: 9 m beyond the painted stop line; `r:1185`: about 35 degrees off the painted line, across the west cycle crossing | Importer inference: `src/importers/osm/controls.ts` moves the crossing's signal to the junction within 60 m (`controlTransferred`), so the stop line is drawn at the junction member instead of before the signalised crossing; `r:1185` takes the member's cut (J1) | `D4-stop-line-r1178` |
| D5 | Bismarckallee in front of the Hauptbahnhof drawn as two carriageways with a median | `r:1251` (238468897), `r:2215` (30277608) | Drawn -11.8 to +3.5 m with a 1.3 m gap (15.3 m); ground one carriageway -9.5 to +4.3 m (13.8 m): west kerb 2.3 m out, east 0.8 m in | Importer inference: a pair of one-way ways without a mapped divider gets the corridor median (`src/importers/osm/corridors.ts`) | `D5-median-r1251-bismarckallee` |
| D6 | A promenade drawn as a two-lane road with a centre line | `r:225`/`r:226` (4881345, `highway=service`, `lanes=1`, two-way); likewise Katharinenstraße `r:1865`/`r:1866` (761326849, `lanes=1`, `oneway=no`) | Drawn 6.0 m, two 3.0 m lanes, centre line and a hatch box; ground a light-paved promenade about 10 m wide without paint | Importer inference: `lanes=1` on a two-way way becomes one lane per direction with a centre line instead of one shared lane | `D6-promenade-r226` |
| D7 | Friedrichstraße's westbound lane gain starts too late | `n:1146` (`r:1175` 2 lanes, way 233466339, into `r:1148` 5 lanes, way 227874537) | Drawn turn arrows 19 m nearer the junction than the painted ones; the ground widens upstream of the painted arrows, the drawn fan (S2) after them | OSM data: the five-lane way starts about 20 m after the visible widening (an OSM edit of the split node, or a curation entry); the fan shape is TASK-214's open S2 | `D7-lane-gain-n1146` |
| D8 | Tram tracks drawn on a ballast bed where they are embedded or on grass | ways 440945775, 440945776 (no form tags), 406495020, 406495021 (`surface=cobblestone`) | 825 m of track in the box drawn as ballast: embedded in asphalt on the Rotteckring (the dark rail pairs of P1, P2), grass on the Friedrichring curve (P3, P4), cobbles on 406495020/1 | Importer inference: form defaults to ballast and ignores `surface`; OSM could add `embedded=yes` or `surface=grass` | `D8-tram-bed-friedrichring` |
| D9 | Width tags ignored | Rotteckring `r:1590`/`r:1690` (536508979, `width=4`), Hans-Sachs-Gasse (217644292, 1300459003, `width=5`) | Rotteckring drawn 3.0 m, ground lane to the parking bay edge about 5 m (west kerb 2.0 m beyond the drawn one); Hans-Sachs-Gasse drawn 6.0 m for 5 m | Importer inference (as D3) | `D9-width-tag-r1590-rotteckring` |

By class and the follow-up that would fix it:

- Geometry rules in `src/network`: D1 (crossings), D2 (stop lines in junction groups).
  - Crossings from mapped crossing nodes: a crossing where OSM maps one, with its marking (zebra
    stripes, the two dashed lines of a signalised crossing, nothing when unmarked); defaults only
    on arms of signalised junctions without a mapped crossing. It touches the same rules as
    TASK-215's held M3 to M5, so it belongs after (or into) TASK-215.
  - Stop lines in junction groups: never at a member reached only through a median crossover,
    and at the edge of the group's conflict area otherwise; part of the J1 group contract
    TASK-213 left open.
- Importer inference in `src/importers/osm`: D3, D4, D5, D6, D8, D9.
  - Stop lines at transferred signals: keep the stop point where the signal stands (the
    crossing node) when the control moves to the junction, with the stop line in `stops.ts`.
  - Road widths: `width` and `width:lanes`, an urban lane width nearer 3.1 m for primary and
    secondary roads, one-way pairs without a mapped median sharing one edge, `lanes=1` two-way
    ways as one shared lane without a centre line.
  - Tram track form: paved for `surface` values other than grass or gravel, embedded for
    untagged track inside a road corridor.
- OSM data (an edit the owner may make, or a curation entry in `bench/freiburg.ts`): D7 (the
  lane split node of Friedrichstraße), and way 795829487 as the stop-gap for D2.

## Checked, not defects

- Friedrichstraße between Rosastraße and the Rotteckring (both carriageways and the median) and
  Bismarckallee north of the Konzerthaus (five lanes) lie within about 1 m of the ground.
- The cars on the Hauptbahnhof's east arm are a queue in the five westbound lanes, not a car park;
  the lane in Bismarckallee's planted median (`r:1764`, `r:1723`) is a real lay-by.
- Breisacher Straße under the rail bridge (`covered=yes`, drawn at grade) cannot be seen from
  above; the box west of the tracks is outside the city's polygon.
- The Hauptbahnhof group's inner lane lines over the junction (TASK-212 J1, M2) show as before.
