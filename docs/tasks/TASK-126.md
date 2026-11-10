# TASK-126 — Railway tracks and stations

Owner: unassigned
Gate: 10 candidates (owner backlog, 2026-11-10): rail items R1 and R2, merged into one task
Branch: `task/126-rail-stations` (created by the lead from main)
Depends on: TASK-096 (surroundings: rails drawn as context lines today), TASK-110 (walk network),
TASK-123 (walk connectivity).
Runs alongside: TASK-124 (garage and place exits), which changes `src/importers/osm/places.ts`
(`networkAccess`, `placeConnector`), `parking.ts`, `buildings.ts`, `src/network/parking.ts`,
`diagnostics.ts` and the walk attachment in `src/network/walk.ts`. Put this task's work in new
modules and keep hooks in those files small; the lead reconciles them at merge.
Followed by: TASK-127 (decorative trains on these tracks) and TASK-128 (stations as trip ends).
Design: this file; `docs/architecture.md` sections 4 (canonical model), 5 (compiled model), 5.6
(walk network), 11 (rendering) and 13 (OSM import). Read the owner backlog in `docs/plan.md`
("Owner backlog (2026-11-10)").

## Goal

Railway tracks become a network of their own: nodes, tracks between them, switches where tracks
diverge, and platforms, imported from OSM, compiled into a graph, saved with the project and
drawn in both views. Stations become special places tied to their platforms and to the walk
network through their entrances. No train moves yet, and nothing routes on the tracks; TASK-127
adds decorative trains and a later task adds train routing. Car and walker traffic must not
change.

What exists today:

- Rail and tram ways are display-only context lines (`src/importers/osm/context.ts`, class
  `rail` or `tram`; drawn by `src/render/layers/context.ts`). The Overpass query asks for
  `railway~"^(rail|light_rail|subway|narrow_gauge|tram)$"` ways only as surroundings.
- A `railway=station` node becomes a place of kind `station` (`places.ts`). The synthetic Station
  fixture (`src/fixtures/station.ts`, T10) has a station place with walk entrances.
- **The bundled extracts hold no railway track ways.** `fixtures/osm/munich-donnersberger.osm`
  (snapshot 2026-11-04T05:53:36Z) has the S-Bahn station node "Donnersbergerbrücke" (OSM node
  2470092007, `platforms=2`, `uic_ref=8004128`), 14 `public_transport=platform` features, 15 stop
  positions, 3 `public_transport=entrance` nodes, 2 switches, 6 signals, tram crossings and a tram
  stop, but none of the tracks themselves. `sindelfingen-a81.osm` has 27 level crossings and 4
  platforms, and no tracks.

## Design

1. **Rail data for the fixtures.** Add the railway ways (and the nodes they use) inside each
   extract's bbox to `fixtures/osm/munich-donnersberger.osm` and `sindelfingen-a81.osm`, pinned
   to each file's snapshot date with an Overpass `[date:"..."]` query. You may download for this
   one purpose. Append only new elements: every element already in the file stays byte for byte,
   so the road import does not move. Fetch `railway` ways of `rail`, `light_rail`, `subway`,
   `narrow_gauge` and `tram` (not `disused` or `abandoned`), `railway=platform` and
   `public_transport=platform` ways that are missing, and the railway nodes on those ways
   (`switch`, `buffer_stop`, `stop`, `level_crossing`, `crossing`, `signal`). Record the query, date and
   contents in `fixtures/osm/ATTRIBUTION.txt`. Add the same railway ways to the Overpass query
   for live imports (bump `queryVersion`).
2. **Canonical model.** Add an optional rail network to `City`: rail nodes (position, kind:
   switch, buffer stop, stop, level crossing, plain), tracks between nodes (polyline, kind: rail,
   light rail, subway, tram, narrow gauge; `service` such as siding, yard, spur or crossover;
   layer, bridge or tunnel; max speed and name when tagged), and platforms (shape, name, the
   tracks they serve, their station). A station place gains its platforms and entrances. Keep it
   as small as these needs; it is a contract change this task describes, so record it in
   `docs/architecture.md` section 4 and follow the schema and migration rules there (an optional
   field with no version bump, as TASK-096's surroundings did, if the rules allow it).
3. **Compiled graph.** Compile the tracks into a graph in `CompiledCity` (section 5): nodes,
   directed or undirected edges with lengths, and the connections a train may take at each node.
   At a switch or a shared node, two tracks connect only when the deflection between them is
   small (state the angle and why; a train cannot turn a corner). Tracks on different layers
   never connect except at a mapped node they share. Report connected components. Trams are
   tracks too: street-running tram tracks are their own graph, not road lanes. Level crossings and
   tram crossings with roads are recorded as crossing points on both networks; they do not change
   car behaviour in this task.
4. **Stations.** Tie each station place to its platforms (OSM stop-area relations if you fetch
   them, otherwise by name and distance; state the rule), and to the walk network through its
   `public_transport=entrance` nodes or, without entrances, through the nearest walk links,
   with the walk network's existing access rules. The station place's shape covers its platforms
   or its mapped building. Munich's Donnersbergerbrücke station has its S-Bahn platforms; bus and
   tram platforms near it are platforms of their own stops, not of the station, unless OSM says
   so.
5. **Drawing and inspecting.** Draw tracks, switches, platforms and stations in 2D and 3D. Track
   kinds look different (main line, S-Bahn or subway, tram, siding); tunnels follow the existing
   grade drawing; tracks under bridges stay visible. Draw them in place of the context rail lines
   when the city has a rail network, never both. A `Rail` toggle in Layers controls them.
   Selecting a track shows its kind, name and service; selecting a station shows its platforms and
   entrances. Keep render cost within the existing frame budgets.
6. **Derived and live.** The compiled rail graph is derived data. Road edits do not change it,
   except that a road edit which removes a level crossing's road removes that crossing record.
   Editing tracks is out of scope; saving and loading keeps the rail network.
7. **Measure.** Per city: rail nodes, tracks and length by kind, switches, components, platforms,
   stations with their platforms and entrances, crossing points; import and compile time; frame
   time with the rail layer on and off.

## In scope

The list below is this task's main surface, not a fence. You may also change any other file
the feature needs in order to be wired in, type-check or be tested, as long as it is not named
under "Out of scope"; list each such file and why in your report. Stop and ask the lead only
for a file named under "Out of scope", a contract change this task does not describe, or a
behaviour change to another feature.

Pre-approved, no need to ask:
- `fixtures/osm/munich-donnersberger.osm`, `sindelfingen-a81.osm` (appended railway elements
  only) and `fixtures/osm/ATTRIBUTION.txt`;
- new modules: `src/importers/osm/rail.ts`, `src/network/rail.ts`, rail layers in
  `src/render/layers/` and `src/render3d/`, and an inspector panel;
- `src/importers/overpass.ts` (query, `queryVersion`), `src/importers/osm/context.ts` (rail
  lines step aside for the network), and small hooks in `src/importers/osm/places.ts` and
  `src/network/walk.ts` for station platforms and entrances;
- `src/schema/**` for the rail network and station fields, with its migration and tests;
- `src/network/types.ts`, `compile.ts` (hooks), Layers and inspector UI;
- `docs/architecture.md` sections 4, 5, 5.6, 11 and 13;
- `bench/import-probe.ts` (a rail census);
- tests: a new `tests/network/T62-rail.test.ts`, importer tests, a new e2e spec
  `tests/e2e/T62-rail-stations.spec.ts`, plus the hash pins and counts that move, each named with
  its reason.

## Out of scope

- `src/sim/**`, `src/demand/**`, `src/routing/**`: no trains, no train routing, no new trips.
  TASK-127 and TASK-128 follow.
- Road lanes, movements, junctions, parking and car connectors. The lanes and movements hash
  stays equal to main's in both cities.
- `placeConnector`, `networkAccess`, garage and lot connectors (TASK-124).
- Track editing tools.
- Pedestrian rules at level crossings.

## Gates

1. **Rule.** In T62, on synthetic fixtures:
   - a straight track with a switch: both branches connect to the stem, the two branches do not
     connect to each other, and a corner sharper than your angle does not connect;
   - tracks on different layers crossing without a shared node do not connect; a shared node
     on a bridge end does;
   - a platform beside two tracks serves both; a station ties to its platforms and its entrances
     join the walk network;
   - a level crossing records a crossing point on the road and on the track;
   - save and load keep the rail network; the compiled graph is the same after a road edit
     elsewhere; same input, same hash.
2. **Fixtures.** Every element that was in each extract before is unchanged (state how you
   checked). The road import is unchanged: the lanes and movements hash equals main's in both
   cities.
3. **Munich.** The main-line and S-Bahn tracks through the bbox import as connected tracks with
   their switches; Donnersbergerbrücke is a station with its S-Bahn platforms and entrances, and
   a walk route from its entrances to the surrounding streets. Report the census (Design 7).
4. **Traffic unchanged.** `npm run test:traffic:light` passes with the 10:00 gate equal to main's
   (3 571 completed, 23 gridlocked, 0 stalled heads) and T53 equal to main's (51 / 57 zone
   stops). If station entrances change the walk graph and these move, explain each change.
5. **Performance.** Import and compile within 5% of main's on both cities (warm, side by side).
   Frame time with the rail layer on within 10% of off, in 2D and 3D, on Munich.
6. **Pictures.** 2D and 3D shots of Donnersbergerbrücke with the rail layer on and off, and one
   of a tram street. Read them yourself: tracks lie on their mapped lines, platforms beside their
   tracks, nothing drawn over road surfaces except trams in the street.
7. **Checks.** The light tier (AGENTS.md "Delivering a task", lead 2026-11-10): `npm run check`,
   `npm run test:city`, `npm run test:traffic:light` and `npm run test:e2e:light` are green, plus
   your T62 e2e spec and the specs that draw layers: `gate4-layers`, `T44-context`,
   `V97-grade-shadows`. Run e2e with `CITYFLOWS_TEST_PORT=5326` and
   `CITYFLOWS_PRODUCTION_TEST_PORT=5426`; never use port 4173 or 5173. Do not run the whole
   `npm run test:e2e`, `npm run test:traffic` or `npm run bench`; they run at checkpoints.

## Acceptance

All gates. Then open the app (`npm run dev -- --port 5326`), import Munich, turn the Rail layer
on, and select Donnersbergerbrücke station, one of its platforms and a main-line track, in 2D and
3D. Turn the layer off and check the old context rail lines do not reappear. Describe what you
saw.

## Deliverable

A report in the body of your last commit message (no new Markdown files):
- the fixture additions (query, date, element counts) and how you proved the old elements
  unchanged;
- the rail model and compiled graph as built, the connection angle and the station rule;
- the census and timings listed under Measure;
- files changed outside the pre-approved list and why;
- expectations changed, with their reasons;
- the final lines of `npm run check`.

Report every timing that grew against main. Write any Markdown or docs as UTF-8.

Commit on `task/126-rail-stations`; do not push or merge. The lead reviews only commits.
