# TASK-220 tram track form (TASK-216 D8), 2026-11-19, main b3bcde6

D8: Freiburg's tram track in the Hauptbahnhof box was drawn on a ballast bed where the ground
shows it in the Rotteckring's asphalt, on the grass strips of the Rotteckring and of the curve into
Friedrichring, and on cobbles (ways 406495020/1). TASK-135's `form` field (`embedded`, `grass`,
`paved`, `ballast`; `src/schema/rail.ts`) already existed, so no schema change: the importer reads
more of OSM and the drawing gains street paving under embedded rails.

## Causes

- `surface=cobblestone` (the commonest tram surface in Freiburg, 4.2 km) and `embedded=pavement`
  were not read: both fell through to the geometry rule and became ballast.
- Rails tagged on the street rather than on the track (`railway:lanes*=tram|…`, `embedded_rails*`
  on pedestrian streets, `railway=tram` on a highway way) were read only from drivable roads'
  `embedded_rails`; the Altstadt's pedestrian streets are not drivable roads.
- Mapped grass strips (`landuse=grass`) under the track were not read.
- The Rotteckring's tracks run between two one-lane carriageways in one asphalt street; the
  carriageways are drawn at the 3.0 m default (D9), so the track centreline lies 1.6 to 2.5 m off
  the drawn surface and never counted as "inside road".
- Embedded track off a drawn road had no surface under it: grooves over the canvas.

## Rules (`assignTramForms`, `src/importers/osm/rail.ts`)

Tags decide first:

1. A tram mapped on a highway way: embedded.
2. `embedded=no`: an own bed (from `surface`, else ballast); any other `embedded` value
   (`yes`, `pavement`): embedded.
3. `surface=grass` or `railway:track_ballast=no`: grass; `railway:track_ballast=yes` or a loose
   surface (`gravel`, `fine_gravel`, `pebblestone`, `ballast`): ballast.
4. A highway carrying tram rails (`embedded_rails*`, `railway:lanes*` with `tram`, or
   `railway=tram`, pedestrian streets included) within half its width (from `width`, else 1.5 m a
   lane, two lanes at least) plus 1 m, along over half the track: embedded.

Otherwise, marked `inferred: ['form']`:

5. Inside same-grade road or junction surface over 80% of its length: embedded (as TASK-135).
6. On a mapped grass strip (`landuse=grass`, `landcover=grass`, `natural=grassland`, mean width
   at most 10 m, so not a park), or within 1.5 m of one, over half of its length off the road:
   grass, unless a paved `surface` is tagged.
7. Inside, or within 2.5 m of, a one-lane carriageway's drawn surface over 80%: embedded (the
   default lane width undershoots such streets, D9). Multi-lane carriageways get no tolerance:
   their lanes are drawn wide already (D3), and Munich's medians beside them are own beds.
8. A paved `surface` (now also `cobblestone`, `unhewn_cobblestone`, `concrete:plates`,
   `bricks`): paved; else ballast. A separate track between carriageways with no surface tag
   stays ballast; `railway:track_ref` says nothing of the form.

## Drawing

- Embedded: grooved rails as before, plus the street's surface under them where no road is drawn,
  3.2 m a track, reaching 0.1 m under the roads it meets (no seam): asphalt where the track meets a
  road, grey stone where it meets none (a pedestrian street). 3D draws it as lit, grained asphalt
  (the road's texture, own mesh) at road height; in a pedestrian street it and the rails sit on the
  footways' top (0.145 m), which otherwise cover them.
- Grass and ballast as before; paved is grey stone `0xbab5ab` (was a warm sand `0xc4b9a8`).

## Counts (tram sections, length)

| City | Form | Before | After |
| --- | --- | ---: | ---: |
| Freiburg | embedded | 33, 596 m | 253, 5,044 m |
| Freiburg | grass | 16, 640 m | 33, 1,448 m |
| Freiburg | paved | 55, 1,346 m | 79, 1,908 m |
| Freiburg | ballast | 308, 6,613 m | 47, 797 m |
| Munich | embedded | 0 | 6, 46 m |
| Munich | grass | 0 | 10, 2,045 m |
| Munich | ballast | 54, 5,774 m | 38, 3,683 m |

Freiburg from the bundled project before and after the rebuild (only tram `form` and its
provenance change); Munich from the bbox import. The D8 ways in the box (by section midpoint):
784 m ballast before; after 189 m embedded (Rotteckring), 372 m grass (Rotteckring south, the
Friedrichring curve), 100 m paved (406495020/1), 123 m ballast.

## Simulation and frames

State hashes are identical main against branch: Munich 0.15 seed 1 (`seed-report --seeds 1`)
actuated choice off 599167940 and on 647224768, fixed off 5860114 and on 125757433; Freiburg's gate
1730700508 (unchanged pin); Sindelfingen's morning 2565719556. Render CPU p95 on Freiburg
(`tests/e2e/freiburg-landing.spec.ts`, interleaved, CPU load 53, 36, 17 and 7% before each run):
main 2.2 and 1.3 ms in 2D, 3.7 and 3.5 ms in 3D; branch 1.7 and 2.0 ms in 2D, 3.2 and 3.4 ms in 3D
(budgets 4 and 6 ms). Fewer sleepers (6.6 km less ballast) offset the paving.

## Close-ups

App shots (`before-*`, `after-*`, `-3d` the same centre in 3D; basemap, surroundings, trees,
places, labels and parked cars off), centres in the project frame (m), 2D px/m, 3D zoom, pitch 50:

| Id | Centre | 2D | 3D | What |
| --- | --- | ---: | ---: | --- |
| rotteckring-embedded | 40, -125 | 12 | 40 | P1/P2, asphalt between the one-lane carriageways (rule 7) |
| rotteckring-grass | 113, -233 | 12 | 40 | the grass strip 601039362 (rule 6) |
| friedrichring-curve | 205, -355 | 10 | 24 | D8's curve, grass strips 648533261/2/6 (rule 6) |
| altstadt-embedded | 170, -8 | 10 | 26 | a pedestrian street with `railway:lanes` (rule 4), stone paving |
| cobbles-paved | -215, -92 | 12 | 40 | 406495020/1, `surface=cobblestone` (rule 8) |
| munich-arnulf-grass | 283, -480 | 8 | 24 | Arnulfstraße, grass strip 132855045 (rule 6) |
| munich-arnulf-bridge | 40, -532 | 8 | 24 | Arnulfstraße at Donnersbergerbrücke |
| munich-landsberger | 234, 186 | 8 | 24 | Landsberger Straße median: ballast, embedded across the junction |

Overlays (`overlay-D8-*-before|after`): `bench/aerial-overlay.ts render <data-dir> <out> --view`
with `D8-friedrichring:205,-355,50,36,14`, `D8-rotteckring:40,-125,40,30,14`,
`D8-rotteckring-grass:113,-233,40,30,14` and `D8-cobbles:-215,-100,50,36,12`; tram rails are now
coloured by form (orange embedded, green grass, lilac paved, red ballast). Orthophoto: LGL-BW
(2026) Datenlizenz Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de; OpenStreetMap
contributors, ODbL.

## Left

- Rotteckring between the Friedrichring curve and the grass strip (`rt:12913`, `rt:12942`,
  `rt:12944`, `rt:12915`, about 115 m): the ground is asphalt or paving, but parking bays separate
  the track from the drawn carriageways by more than 2.5 m, so it stays ballast (rule 8).
- Munich: OSM maps grass strips under 2 km of Arnulfstraße's track. The owner's reference images
  for TASK-135 show ballast beside Donnersbergerbrücke (a grass strip only beside the stop), so
  `munich-arnulf-bridge` may now be wrong there; there is no Munich imagery to check further.
