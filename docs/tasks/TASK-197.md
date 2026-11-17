# TASK-197 — Scouting a showcase landing city

Status: done 2026-11-17 (recommends Freiburg; awaits the owner's pick). Proposed
owner: Claude Code subagent (Opus 5.5, high). Branch `task/197-landing-scout`, worktree
`D:\cityflows-wt\197`, ports 5398 / 5498.

## Goal

The app opens on the 5 x 5 grid (`open('grid5x5')` in `src/ui/store.ts`). The owner wants the landing
view to be a showcase: a curated, stable version of a real German place, richer rather than small, with
a natural edge (river, rail line, ring road, old wall), not a square OSM cut. It need not be busy when it
opens (owner, 2026-11-17).

Scout the candidates and recommend one, so the owner can pick before TASK-198 builds it:

1. Shortlist at least three places from these (others are fine with a reason): Freiburg im Breisgau
   (Altstadt and Hauptbahnhof: rail line west, Dreisam south, Schlossberg east, trams); Köln (inside the
   Ring and the Rhine, or a part of it: Dom, Hauptbahnhof, Hohenzollernbrücke, Stadtbahn); Lübeck
   (the Altstadt island inside the Trave and the canal, station just west); München (inside the
   Altstadtring, Isar east, trams). Criteria: what the app can show (rail, trams, decks or bridges,
   terrain, parking, walking, signals), a boundary that follows real edges, and where traffic enters.
2. For each, fetch an OSM extract for a polygon around the natural edge (Overpass; record source,
   snapshot and query as `fixtures/osm/ATTRIBUTION.txt` does) into `D:\cityflows-wt\197-data\`, not
   the repo. Import it with the existing importer and record what the importer cannot do: polygon
   boundaries, entry points at the edge, missing features, broken junctions.
3. Measure each: import and compile time, production-build load time to first frame, frame time in 2D
   and 3D, simulation step time and the gates (gridlocked, stalled, the 900 s drain) at a demand that
   suits a showcase, and the compiled size.
4. Screenshots of each in 2D and 3D, Light, Day, from a showcase camera.
5. Write `docs/decisions/2026-11-17-landing-city.md`: the candidates, the numbers, the gaps, a
   recommendation, and what TASK-198 must build (importer changes, curation, tests).

## Scope

Scratch scripts and data outside the repo; `docs/decisions/2026-11-17-landing-city.md`. No source
changes: anything the importer needs is a finding for TASK-198.

Out of scope: changing the landing view, `src/schema`, committing extracts.

## Gates

- The decision document, with numbers and screenshots for every candidate.
- `npx prettier --check` on the document.

## Report

Write it as the commit body.
