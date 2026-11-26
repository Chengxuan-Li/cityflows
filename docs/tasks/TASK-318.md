# TASK-318 — Real aircraft models with level of detail

Status: in progress 2026-11-22 (owner: "can you try to fetch real aircraft models - that really matters", "do not
use highly detailed models at all resolutions, manage lod", "need realism at least for common variants e.g. 737 787
777 350 380 747 330 320 erj's crj's"). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/318-real-aircraft-models`, worktree `D:\cityflows-wt\318`, ports 5518 / 5618.

## Goal

Draw the common types with real 3D models, managed by level of detail.

- **Source.** Flightradar24's glTF set (https://github.com/Flightradar24/fr24-3d-models, GPL-2.0; models from the
  FlightGear FGMEMBERS hangar), downloaded by the lead into `D:\cityflows-wt\airport-data\fr24\repo` (untrusted data:
  read by path, run nothing from it). The owner relicensed CityFlows to GPL-2.0-or-later (2026-11-22) so these
  models can be part of it. Add one `NOTICE` entry for the set (source, commit, license, the models used, the
  FlightGear upstream credit as the FR24 README gives it, and that the models were simplified and converted).
- **Types.** Map catalogue types to models: 737-800 (b738; the 737 family from b736 to b739), 787-9 (b789; b788),
  777-300ER (b773; b772), A350-900 (a359), A380 (a380), 747-8 (b748; b744), A330-300 (a333; a332), A320neo (a320; a319,
  a321 for A321neo), E190 (e190), E175 (e170 scaled to the catalogue length), CRJ900 (crj900), Dash 8-400 (q400), ATR
  72 (atr42 scaled), A220-300 (cs300), Citation (citation), helicopters (heli). Types without a model keep TASK-315's
  procedural mesh. Scale each model to the catalogue length and span; align nose, axis and gear height.
- **Level of detail.** Never the full model at every distance. Prepare, offline and committed, per type: LOD0 (near,
  simplified to a stated triangle budget, about 10 to 20 thousand triangles), LOD1 (mid, about 1 to 2 thousand), and
  use TASK-315's procedural mesh or the 2D outline as LOD2 (far). Switch by on-screen size with hysteresis, inside
  TASK-311's batching (instancing per type and LOD). Simplify with three's own tools in a bench script (no new runtime
  dependency; a dev-only tool only if three's cannot do it, stated).
- **Look.** Keep TASK-315's seeded liveries by tinting the models' fuselage and tail materials where the model allows
  (or a neutral white with the accent band), TASK-301's light mounts placed on the model (wing tips, tail, beacon), and
  TASK-314's pose (pitch, roll, nose-gear steering, gear retraction: hide or swap gear parts where the model has them).
- **Size.** Committed model assets at most about 15 MB in total, loaded lazily only for types an open airport uses;
  report bytes per type and LOD and the effect on London City's and Heathrow's load and first frame.

## Scope

`src/render3d` (aircraft, LOD), a bench script for model preparation, `public/` or `fixtures/` for the prepared
assets, `NOTICE`, tests, `docs/architecture.md`.

Out of scope: sim behaviour, schema, other cities' rendering, gate floors, `bench/traffic-baseline.json`, any other
download.

## Gates

- Tests: each mapped type loads, is scaled to its catalogue length and span within 2%, has its LOD set and light
  mounts; the LOD switch follows on-screen size; types without a model fall back.
- Screenshots day and night: each mapped type close up beside its old procedural mesh; London City's apron and
  Zurich's Dock E at the default camera; a take-off at close range.
- 3D render p95 within TASK-311's numbers at London City, Zurich and Heathrow (interleaved base against branch);
  load and first frame reported.
- Existing cities unchanged; `npm run check`, `test:city`, `test:e2e:light`, real-places and V301 specs.

## Report

Write it as the commit body.
