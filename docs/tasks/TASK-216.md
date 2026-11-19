# TASK-216 — Road shapes against aerial imagery: Freiburg Hauptbahnhof first

Status: done 2026-11-19 (owner approved the imagery download). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/216-aerial-check`, worktree `D:\cityflows-wt\216`, ports 5416 / 5516. Read-only on code.

## Goal

TASK-212's audit and the fixes after it (TASK-213, 214) measure the drawn geometry against itself:
overlaps, folds, joins. They cannot tell whether a road is where it is on the ground, as wide as it
is, or has the lanes, islands and stop lines it really has. The owner asked for the complicated
shapes of the demo cases to be checked against aerial imagery, starting with the Freiburg
Hauptbahnhof area.

1. **Imagery.** Use LGL Baden-Württemberg's digital orthophotos (DOP20, 20 cm, open data since
   2024-06-09) through its public WMS, for one box around the Hauptbahnhof: Bismarckallee, the
   Stühlinger bridge, the bus station (ZOB), Friedrichstraße to the Rotteckring junction, and the
   tram loop (about 800 m by 600 m; junction groups `jg:13298` and `jg:13268`). Confirm the licence
   and attribution text from the service's metadata before fetching. Keep the tiles outside the repo
   (`D:\cityflows-wt\216-data`); the close-ups committed under `docs/findings/` carry the
   attribution.
2. **Overlay.** Draw the compiled city over the imagery in the project's projection, from a bench
   script that renders an HTML page with Playwright (no new dependency): carriageway and kerb edges,
   lane lines, islands and gores, stop lines, crossings and tram tracks. Check the registration
   first on three fixed points (building corners or tram rails) and report the residual; correct a
   constant offset if one shows.
3. **Measure and rank.** For every road, junction and island in the box: kerb-line offset (m), width
   against the visible carriageway, lane count and turn arrows against the paint, island and gore
   shapes, stop-line and crossing positions. Rank the defects by size and by how much a viewer of
   the landing page would notice them, with OSM ids.
4. **Classify each defect** by where its fix belongs: the OSM data (a wrong or missing tag or way;
   a curation entry, or an OSM edit the owner may make), the importer's inference (width, lanes,
   setbacks), or a geometry rule in `src/network` (junction groups, J1). Say which follow-up task
   would fix each class.

## Scope

`bench/` (a new overlay script), `docs/findings/2026-11-19-aerial-check/` with close-ups (2D overlay
and the same view in 3D without the imagery) and the ranked list.

Out of scope: any change to `src/`, the fixtures, the gates, an imagery layer in the app (a
possible later task, owner's call), other cities until the owner has seen Freiburg's result.

## Gates

- Registration residual reported on three fixed points, under 1 m after any constant correction.
- Every defect with an id, a measured figure, a class and a close-up.
- The licence and attribution recorded in the findings.
- `npm run check` (for the bench script).

## Decisions for the owner

- Approve the imagery download: LGL DOP20 tiles for the box above through the public WMS, a few tens
  of MB, kept out of the repo.
- After Freiburg: which demo cases next (Munich Donnersbergerbrücke uses Bavaria's open DOP;
  Sindelfingen is in Baden-Württemberg too).

## Report

Write it as the commit body and the findings README: registration, the ranked defects by class, the
proposed follow-ups.
