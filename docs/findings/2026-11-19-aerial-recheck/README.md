# TASK-224 aerial re-check of the Hauptbahnhof box after wave A (2026-11-19, main a46d906)

TASK-216's overlay (`bench/aerial-overlay.ts`) run again on main after wave A: TASK-217 merged as
its paint-only variant (D1 in part, M1, M2, M4, M6, M7), TASK-220 (tram track form, D8), TASK-227
(pitched roofs on concave outlines); TASK-218 (D3 to D6, D9) and TASK-219 (D2) are parked. Same box
(x -630 to 230, y -690 to -90 m), same LGL-BW DOP20 tiles (`D:\cityflows-wt\216-data`, read-only;
nothing downloaded), same registration: 0.27 m (residuals -0.08, +0.03, +0.12, +0.04 m), so the
figures are uncorrected as before.

The parked branches are shown as they would land: each branch merged with main in a scratch
worktree (no commit), the Freiburg project rebuilt there (`bench/freiburg.ts`; city.json
`82d5b456...` for TASK-218, `bdf06f82...` for TASK-219), and rendered with this tree's bench. Road
and node ids in the box are the same in all three projects.

The box was not extended: the tiles end at y -90, and the Bertoldsbrunnen (about x 308, y +56) and
the Martinstor (about x 225, y +195) lie south of it.

Each figure is a row: TASK-216's close-up (main 026720d), main now, and the parked branch where it
touches the case; `-3d` is the app's 3D view at the same centre (buildings, trees and places off).
Orthophoto: LGL-BW (2026) Datenlizenz Deutschland - Namensnennung - Version 2.0, www.lgl-bw.de;
roads, paint and buildings: OpenStreetMap contributors, ODbL.

## D1 to D9

| # | Defect | TASK-216 | Main now | Parked branch on main | Figure |
| --- | --- | --- | --- | --- | --- |
| D1 | Crossings where the ground has none, none where it has zebras | 170 crossing ends painted (all zebra), 158 over 4 m from any mapped crossing; 0 of 13 mapped zebras matched (TASK-217's count) | **Partly fixed.** 42 painted (6 zebra, 36 signalised broken lines), 22 over 4 m from a mapped crossing (signal lines at signalised arms without a mapped crossing); 2 of 13 zebras matched. The zebras mapped only as nodes (`n:211`, `n:1139`) are still not drawn (they need walk links, which move traffic) | — | `D1-crossings-n211-n1139` |
| D2 | Hbf group reaches 35 m along Friedrichstraße: stop line at the crossover | Westbound stop line 37 m before the painted one | **Not fixed.** Same place; its crossing now paints as signal lines; the five westbound lanes lose their lane lines (N1) | TASK-219: **fixed**, stop line 4.0 m past the painted one, lane lines back; they swing visibly (about 1 to 2 m) across `n:1147` where the ground's run straight. TASK-218: as main | `D2-group-stop-line-n1147` |
| D3 | Five-lane approaches too wide, over the gore and island | `r:1179` 17.5 m (kerbs -8.75 / +8.73; ground -6.0 / +9.5, 15.5 m): 2.75 m over the gore. `r:261` 17.8 m (ground 16.0 m): 2.6 m over the island | **Not fixed** (identical) | TASK-218: `r:1179` 16.25 m (-8.12 / +8.13): 2.1 m over the gore, 1.4 m short on the far side; `r:261` 16.25 m (-8.12 / +8.12): 1.6 m over the island, 1.4 m short. **Width fixed, position not**: the ground's carriageway sits about 1.7 m off the OSM centreline (`placement`, which TASK-218 leaves out) | `D3a-width-r1179-stefan-meier`, `D3b-width-r261-zur-unterfuehrung` |
| D4 | Stefan-Meier-Straße's stop line past the signalised cycle crossing | 9 m beyond the painted line, in pieces | **Not fixed.** One line now (M6), solid lines before it (M7), same place | TASK-218: **fixed**, 0.8 m from the painted line; the junction surface grows by the 9 m (its audit: bulge 31.5 to 41.8 m²) | `D4-stop-line-r1178` |
| D5 | Bismarckallee drawn as two carriageways with a median | -11.8 to +3.5 m with a 1.3 m gap; ground one carriageway -9.5 to +4.3 m | **Not fixed** (identical) | TASK-218: **mostly fixed**, one carriageway -11.0 to +3.5 m with a 0.5 m painted median: west kerb 1.5 m out (was 2.3), east 0.8 m in | `D5-median-r1251-bismarckallee` |
| D6 | Promenade drawn as a two-lane road with a centre line | 6.0 m, two 3.0 m lanes, centre line, hatch box; ground a 10 m paved promenade, no paint | **Not fixed** (identical) | TASK-218: **partly**, one 4.5 m shared lane; the centre line and the hatch box are still drawn | `D6-promenade-r226` |
| D7 | Friedrichstraße's westbound lane gain starts too late | Drawn arrows 19 m nearer the junction than the painted ones | **Not fixed**; the two left lanes of `r:1148` lose their arrows (N2) | TASK-219: the gain as main; no stop line at `n:1147` any more; the two left lanes still without arrows | `D7-lane-gain-n1146` |
| D8 | Tram track on a ballast bed where embedded or on grass | 825 m of track in the box drawn as ballast | **Mostly fixed** (TASK-220): in the box 189 m embedded, 372 m grass, 100 m paved, 123 m ballast. The Friedrichring curve is grass and the Rotteckring north embedded, as the ground. About 115 m at the Fahnenbergplatz stop stay ballast where the ground shows paving (parking bays keep the track over 2.5 m from the drawn carriageway; TASK-220's open item) | TASK-218: as main (its width rule skips ways with street parking) | `D8-tram-bed-friedrichring`, `D8b-rotteckring-ballast` |
| D9 | `width` tags ignored | Rotteckring `r:1590` drawn 3.0 m, ground about 5 m | **Not fixed** (identical; `r:1690` 3.0 m) | TASK-218: `r:1690` 4.0 m (`width=4`; ground about 4 to 5 m); `r:1590` stays 3.0 m (street parking) | `D9-width-tag-r1590-rotteckring`, `D9b-width-tag-r1690-rotteckring` |

Fixed on main: D8 (but 115 m) and D1's wrong zebras (42 of 170 ends still painted, 22 away from a
mapped crossing). The parked work would fix D2 (TASK-219), D4 and most of D5 (TASK-218), the width
of D3 and the tagged width of D9 on one of its two roads (TASK-218); D6 in part; D7 needs the OSM
edit or curation entry it needed before.

## New defects from the merged changes, inside the box

| # | Change | Defect | Measured | Figure |
| --- | --- | --- | --- | --- |
| N1 | TASK-217 M2 (no lane lines on group inner lanes under 15 m) with the J1 group membership | Lane lines the ground has are gone where a junction group takes in a stretch of carriageway: Friedrichstraße westbound (`r:1149`, five lanes, through `n:1147` and `n:473`, the D2 group) and Stefan-Meier-Straße (`r:1179`, `r:745`, `r:6` in `jg:13267`) | About 35 m of Friedrichstraße (from the Hbf junction to the crossover's stop line) and Stefan-Meier-Straße's 13 m `r:1179` with the inner roads beside it without lines; the ground has dashed lines throughout. In the box M2 drops 43 inner lane lines in 9 groups; the rest lie inside junction areas, where the ground has none (correct). TASK-219 restores Friedrichstraße's | `D2-group-stop-line-n1147` (both rows), `D3a-width-r1179-stefan-meier` |
| N2 | TASK-217 M1 (a group entry lane shows its turns through the group) at the entry D2 creates | The two left lanes of `r:1148` show no arrow; the ground has arrows on every lane | `r:1148#0` has no chain through `jg:13297`; `#1`'s only chain turns left twice (to `r:484`), which M1 classes as a u-turn and does not show | `D7-lane-gain-n1146` |
| N3 | TASK-220 street surface on embedded track | Minor: where the embedded track's asphalt meets the Rotteckring's junction approach it shows a darker wedge. The 1 m light strip between the track and the east carriageway is older (the ballast bed had it) but reads more now; the ground is asphalt with a white edge line there | Rotteckring north, about 50 m | `D9-width-tag-r1590-rotteckring-3d` |
| N4 | TASK-227 pitched roofs on concave outlines | 31 buildings in the box changed from flat to pitched. Against the imagery 23 match pitched roofs (tiles, dormers, ridges), 4 are unclear (dark roofs, lean), 1 is half outside the tiles. 3 are doubtful, all OSM outlines or tags that the flat fallback used to hide, not skeleton faults: at (210, -222) a block outline that takes in a glass-roofed courtyard, so a hip runs over it; at (-307, -497) an outline over yard sheds; the school at (-38, -536) (way 24719975, `roof:shape=hipped`, `roof:levels=0`) gets a 6 m roof at 35 degrees where the ground shows a low pitch with solar panels | — | `R0-roofs-changed-1` to `-4`, `R1` to `R4` |

M6 (one stop line per approach) and M7 (solid lines before stop lines) agree with the ground
wherever the stop line itself is right; at D4 the solid lines run on past the painted stop line
because the drawn one is still 9 m late. The 22 signal-line crossings away from mapped crossings
were not checked one by one.

## Follow-ups

Ranked as TASK-216 did (what a viewer of the landing page notices first, then size):

1. **D2, N1, N2: group membership.** TASK-219's rule (TASK-226 re-measures it) fixes D2 and gives
   Friedrichstraße its lines back; check the lane-line swing at `n:1147` before it lands. For
   N1 on Stefan-Meier-Straße and N2, a marking follow-up: M2 judged by the inner road's length
   between member nodes (or kept where every lane runs straight on), and an entry lane whose only
   group path is a u-turn shown with its first movement's turn.
2. **D4: stop line before the signalised crossing**, TASK-218's rule, split off with J1 (TASK-226's
   area) as TASK-218's review proposed.
3. **D3 and D9: widths**, TASK-218's variant rule with an audit that measures voids against the
   drawn median; the remaining 1.4 to 2.1 m at D3 is the carriageway's offset from the OSM line
   (`placement` or asymmetric lane layout).
4. **D5 and D6** alone (Freiburg only); D6's centre line on a shared lane (TASK-217's file).
5. **D1: zebras mapped only as nodes** need walk links, with a traffic budget.
6. **D8b: 115 m of Rotteckring ballast**: a curation entry, or rule 3 of TASK-220 measured to the
   outer edge of the parking bays.
7. **D7**: the OSM edit or curation entry (owner's).
8. **N4**: OSM fixes for the three outlines or tags; N3: the track's street surface carried to the
   carriageway's edge.

## Reproduce

```
node --experimental-strip-types --import ./bench/register.ts bench/aerial-overlay.ts render D:\cityflows-wt\216-data\dop20 <out>
node --experimental-strip-types --import ./bench/register.ts bench/aerial-overlay.ts shots3d <out> --port <port>
node --experimental-strip-types --import ./bench/register.ts bench/aerial-overlay.ts shots3d <out> --port <port> --buildings --only R1-roofs-rheinstrasse,R2-roofs-eisenbahnstrasse,R3-roofs-hans-sachs-gasse,R4-roofs-poststrasse
```

New in the bench: `shots3d --port` (was fixed at 5416) and `--buildings` (keeps the surroundings
on); views `D9b` (TASK-218's section of the Rotteckring), `D8b` and `R1` to `R4`; a `roofs` flag
that draws the 3D view's pitched roofs over the imagery (also `--view ...,roofs`). The rows above
were put together from the single close-ups with a scratch script.
