# TASK-297 — Airside markings and aircraft shapes in 2D

Status: planned 2026-11-22 (airports batch, owner's go; starts after TASK-295). Proposed owner: Codex CLI
(gpt-6.2-sol, high). Branch `task/297-airside-2d`, worktree `D:\cityflows-wt\297`, ports 5497 / 5597.

## Goal

Make the airside read as an airfield, in 2D and as ground paint in 3D through the shared marking geometry
(`docs/decisions/2026-11-22-airports.md`). Rules by geometry, no per-id curation.

- Runways: edge lines, centreline, threshold bars (count by runway width), designators read from the runway
  ends, displaced-threshold arrows, touchdown-zone and aiming-point markings at standard distances scaled to
  runway length, turning pads.
- Taxiways: yellow centrelines continuous through junctions and onto stand lead-ins, edge lines; a
  runway-holding-position marking (pattern A: two solid and two dashed lines, solid on the holding side) at every
  holding position.
- Aprons: stand lead-in lines, stand numbers at the stop position, apron edge lines.
- Aircraft outlines: a top view per class from the catalogue in TASK-298's contract (copy that table into
  `src/schema` if TASK-298 has not landed, so both use one table), drawn at real length and wingspan:
  large double-decker, widebody, narrowbody, regional jet, propeller (with propeller discs), private jet,
  helicopter (rotor disc). A preview of all outlines at scale in the dev render page.

## Scope

`src/render` (airside layer, aircraft outline drawing), `src/render/marking-geometry.ts`,
`src/render3d/markings.ts`, the dev render page, tests; the catalogue table if TASK-298 has not added it.

Out of scope: aircraft motion (TASK-298), lights (TASK-301), road markings of existing cities, gate floors,
`bench/traffic-baseline.json`, any download.

## Gates

- Tests on the synthetic airport (TASK-296): threshold bar count by width, designator from the runway end,
  holding marking solid on the holding side, stand number at the stop position.
- Screenshots in the evidence folder: London City in 2D and 3D, day and night: both runway ends, a holding
  position, the apron; the aircraft outlines side by side at scale.
- Existing cities' archives, render audits and 2D captures identical where they apply.
- `npm run check`, `test:city`, `test:e2e:light`.

## Report

Write it as the commit body.
