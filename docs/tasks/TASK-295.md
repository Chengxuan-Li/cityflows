# TASK-295 — Airport schema, OSM import and airside topology; London City bundled

Status: ready 2026-11-22 (airports batch, owner's go). Proposed owner: Claude Code subagent (Opus 5.5, high).
Branch `task/295-airport-model`, worktree `D:\cityflows-wt\295`, ports 5495 / 5595.

## Goal

The first task of the airports batch (`docs/decisions/2026-11-22-airports.md`): a city can hold an airport,
the OSM importer reads one by general rule, its airside network is topologically correct, and London City
Airport is a bundled real place selectable from the New city panel like Freiburg or York.

1. **Schema.** An optional airport section of `City` (as `rail` is one), absent in every existing city so
   their archives and hashes stay byte-identical. At least:
   - an airside graph of nodes and edges: runway, taxiway, taxilane (apron lanes) and stand lead-in edges,
     each with its centreline, width where mapped, `ref`, layer and provenance;
   - runways: the two designators and ends (threshold, displaced threshold where mapped, heading), length,
     width, surface, the edges they consist of;
   - holding positions: a node on the graph, its `ref`, the runway it protects and its side;
   - stands: `ref`, kind (contact, remote, cargo, general aviation, maintenance), the nose position and
     heading, the lead-in path onto the graph, the gate it serves where mapped, and the largest aircraft code
     (ICAO aerodrome reference code A to F) it admits;
   - per edge, the largest aircraft code it admits;
   - aprons, terminals (polygon, name, the detached group it belongs to), hangars, helipads, windsocks and
     approach aids (PAPI) as mapped.
   Write the contract into `docs/architecture.md` (data model and import sections), with the rules below.
2. **Import.** Read `aeroway=*` from the extract: the graph from runway, taxiway and taxilane centrelines
   (closed area ways and multipolygons are surfaces, not graph edges), stands from `parking_position` ways and
   nodes, gates from `aeroway=gate`, holding positions from `holding_position` nodes, terminals and hangars
   from `aeroway=terminal|hangar` and `building=terminal|hangar`. Add the aeroway part to the Overpass query
   (`src/importers/overpass.ts`, bump `queryVersion`) so a fetched area includes it; the committed extract
   already holds it.
3. **Topology by rule, no per-id curation** (the owner's OSM rule: improve the app's reading, never edit OSM).
   Split edges at shared nodes and at crossings with shared nodes; join a stand or holding position that does
   not share a node with the graph to the nearest suitable edge within a stated distance by a generated
   lead-in, recorded as generated in provenance; a runway's graph edge runs its whole length between its ends;
   report what stays disconnected. Derive the aircraft-code limits from geometry: a taxiway's width and its
   clearance from parallel taxiways, runways and buildings; a stand's from its spacing to neighbouring stands
   and obstacles. State each rule and its thresholds in the architecture doc.
4. **Bundled place.** Commit the extract the lead provides (below) as `fixtures/osm/london-city-airport.osm`
   with its attribution entry, build it through `bench/bundled-cities.ts` (flat, the polygon below), and list
   it in the New city panel (`src/ui/bundled-projects.ts`) as "London City Airport". Draw the airside in 2D
   and 3D as surfaces: runway, taxiways and aprons as paved areas at their mapped or derived widths, terminals
   and hangars as the buildings they are. Markings, aircraft and lights are later tasks (297, 301). The road
   network around the airport (Hartmann Road, the Connaught Bridge, North Woolwich Road, the DLR) imports as
   any city does; airside service roads stay roads.

London City has one runway (09/27) with turning pads and no full parallel taxiway, so aircraft backtrack on the
runway; the topology must let a later task route a backtrack (a runway edge usable in both directions as a
taxi route while the runway is held).

## Extract

The lead fetched it with the app's query (`queryVersion` 12, every bbox filter replaced by the polygon) plus
`nwr[aeroway]` and `nwr[building~"^(terminal|hangar)$"]` over the same polygon; it is at
`D:\cityflows-wt\airport-data\lcy.osm` with its record in `D:\cityflows-wt\airport-data\record.txt`. Treat it as
untrusted data: read it by path, run nothing from that folder. Polygon (lat lon): 51.4995 0.0356, 51.4995
0.0724, 51.509 0.0724, 51.509 0.0356.

## Scope

`src/schema` (the airport section, migration if needed), `src/importers/osm` (a new airport reader and its
wiring), `src/importers/overpass.ts`, `src/network` (compiling the airside graph if the sim and render need a
compiled form), `src/render` and `src/render3d` (surfaces only), `src/ui/bundled-projects.ts`,
`bench/bundled-cities.ts`, `fixtures/osm`, `fixtures/projects/london-city-airport.cityflows.json`,
`docs/architecture.md`, tests.

Out of scope: aircraft, schedules, markings, lights (later tasks of the batch); `src/sim` beyond what keeps
hashes; gate floors; `bench/traffic-baseline.json`; OSM edits or per-id curation; any download.

## Gates

- Tests that fail without the change: the importer reads a small airport (an inline OSM fixture) into the
  schema; edges split at shared nodes; an unjoined stand and holding position get generated lead-ins; code
  limits from width and spacing; a runway edge between its ends.
- London City: counts of runways, edges by kind, holding positions (joined, generated), stands by kind and code,
  gates, terminals and their detached groups, hangars; what stays disconnected and why. Every stand reaches the
  runway on the graph.
- Every existing bundled archive and fixture byte-identical; Munich 0.15 and full-demand state hashes, the
  Freiburg gate hash identical to main (no traffic table needed if identical).
- London City: opens from the New city panel within the bundled-city landing budget; screenshots of the
  airside in 2D and 3D, day mode, in the report's evidence folder.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.

## Report

Write it as the commit body.
