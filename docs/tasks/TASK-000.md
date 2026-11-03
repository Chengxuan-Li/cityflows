# TASK-000 — Upstream audit and reuse matrix

Owner: unassigned
Gate: 0
Depends on: nothing (runs in parallel with TASK-001)

## Goal

A written, evidence-backed reuse matrix so that the simulation, lane-inference and import
tasks adapt proven code where the license allows, instead of re-deriving it. Read-only: this
task writes no product code.

## In scope

- `docs/references/upstream-audit.md` (new).
- `NOTICE`: no entries yet; this task may add a "study-only references" line pointing at the
  audit.

For each target below: pin the commit SHA and license, list the files that matter with a
one-line description each, state what CityFlows should adapt (with the destination file from
`docs/architecture.md`), what it should only study, and the risks.

| Target | Look at | Feeds |
|---|---|---|
| TRIZHAX traffic flow simulation (MIT) | `src/simulation/` IDM, MOBIL, signal controller; `src/world/` validator and OSM tag handling; `scripts/selftest.mjs` determinism checks | TASK-003, 004, 020 |
| traffic-simulation.de (GPL-3.0, compatible) | IDM and MOBIL reference implementations, on-ramp merging and lane-drop handling, parameter sets | TASK-003, 004, 032 |
| CityFlow (Apache-2.0) | `docs/source/roadnet.rst` lane links, intersections, signal phases; engine step ordering | TASK-001, 003 |
| osm2streets (Apache-2.0) | lane count and width inference from OSM tags, driving side handling, intersection polygon construction | TASK-001 (lane layout), 020 |
| A/B Street docs | map edits model, lane editing UX, traffic signal editor screenshots (design reference only) | TASK-010, 022, 040 |
| SUMO netconvert docs | default lane counts and speeds per highway class, turn lane assignment heuristic | TASK-001 (5.2), 020 |
| Nitai Aharoni traffic simulator (PolyForm NC) | architecture notes only; record whether the repo was reachable | nothing copied, ever |

## Out of scope

- Running or benchmarking the references. Note claimed performance figures as claims.
- Any change under `src/`.
- Reopening the foundation decision (architecture section 1, row 1).

## Acceptance

- The document exists with the table above filled in, commit SHAs, and file paths that a
  reader can open.
- Every "adapt" recommendation names a CityFlows destination file and a license-compatible
  source; every GPL or MIT snippet proposed for adaptation is identified by file and function.
- A short "do not use" list names non-free sources and why.
- PR passes `npm run check` (unchanged code) and lints Markdown by eye: no promotional prose,
  no restated README text.

## Commands

`npm run check`

## Deliverable

PR with the audit document. The lead folds its recommendations into TASK-003, 004 and 020
before those start.
