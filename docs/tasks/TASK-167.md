# TASK-167 — Street-name labels and map typography

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/167-map-labels`, worktree
`D:\cityflows-wt\167`, ports 5367 / 5467. It starts once TASK-160/162 are on main, in parallel
with TASK-166 and TASK-168.

## Goal

Apple-Maps-style labels on the 2D map, in Arimo:
- **Street names** from OSM `name`. They run along the road centreline, curved where the road
  curves, kept upright, repeated about every 300–500 m on long streets, and shown only where the
  road is wide enough at the current zoom.
- **Place labels:** names, or the type for unnamed places. Station and tram-stop names. Optional
  major-landmark labels from context features.
- **Hierarchy:** major roads and stations first. Collision-free placement with a deterministic
  priority, so labels don't jitter while panning. Fade with zoom.
- **Halo:** a canvas-coloured halo for legibility. Works in both appearances once TASK-166 lands;
  use tokens.
- **3D:** labels for stations and major roads only, as billboards, if cheap. Otherwise 2D only;
  report it.
- **Toggle:** a "Labels" entry in Layers.

## Scope

`src/render/**` label layer, a placement module, the Layers entry, and tests.

## Gates

- Shots of Munich at three zooms, Sindelfingen and the grid, before and after. Save numbered
  previews to `D:\cityflows-wt\167-evidence\previews\`.
- Placement is deterministic, has no overlaps, and stays upright.
- Frame time: T62/T64 within 5% of the base.
- `npm run check`, `test:city`, `test:e2e:light`.
- No simulation hash moves.

## Report

Write it as the commit body: rules, counts, shots, frame times, and anything left open.
