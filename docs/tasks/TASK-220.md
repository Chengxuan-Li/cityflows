# TASK-220 — Tram track form (TASK-216 D8)

Status: in progress (unsupervised run, owner 2026-11-19). Proposed owner: Claude Code subagent (Opus
5.5, high). Branch `task/220-tram-track-form`, worktree `D:\cityflows-wt\220`, ports 5420 / 5520.

## Goal

TASK-216 found Freiburg's tram track drawn on a ballast bed for 825 m in the Hauptbahnhof box, where
on the ground it is set in asphalt or paving inside the road, or on grass
(`docs/findings/2026-11-19-aerial-check/`, D8). TASK-135 planned track forms (embedded, grass, paved,
ballast) from OSM tags or inference; check what exists.

1. Read the track form from OSM (`embedded=yes`, `railway:track_ref`, `surface`, `landuse=grass`
   strips, `tracks` on roads) and infer it where nothing is tagged: tram track inside or alongside a
   road carriageway is embedded; a separate tram way between carriageways with no surface is grass
   only if tagged; ballast otherwise.
2. Draw each form in 2D and 3D (embedded: rails in the road surface, no bed; grass: green bed;
   paved: grey stone; ballast as now), within the frame budgets.
3. Count the forms in Freiburg and Munich before and after.

Visual only: the simulation must not move (identical state hashes).

## Scope

`src/importers/osm/rail.ts` (track form only), `src/network/rail.ts` if the form is carried there,
the rail and tram drawing in `src/render` and `src/render3d`, tests.

Out of scope: `src/schema` unless a track form field already exists (stop and ask otherwise), tram
service and timetables, crossings (TASK-217), roads (TASK-218, 219), gate floors.

## Gates

- Identical state hashes main against branch: Munich 0.15 seed 1 choice off, both modes; Freiburg's
  gate; Sindelfingen.
- Close-ups before and after, 2D and 3D, of the Friedrichring and the Rotteckring trams and one
  Munich tram if any, in `docs/findings/2026-11-19-tram-track-form/`, plus the aerial overlay of D8.
- 2D and 3D frame budgets on Freiburg (render CPU p95).
- `npm run check`, `test:city`, `test:e2e:light`.

Where a case is one of TASK-216's aerial defects, show it before and after with
`bench/aerial-overlay.ts` (the imagery is in `D:\cityflows-wt\216-data`, read-only; do not download
anything).

The Freiburg project (`fixtures/projects/freiburg.cityflows.json`) is built from the extract by the
importer and compiler: if your change moves it, rebuild it (`node --experimental-strip-types
--import ./bench/register.ts ./bench/freiburg.ts`) and re-pin in your branch, saying so; the lead
rebuilds again at the merge. No other fixture changes.

## Report

Write it as the commit body: per case, the cause, the rule, the figures; the traffic tables.
