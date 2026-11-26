# TASK-293 — Philadelphia's import warnings and load time (TASK-285's F1, F2)

Status: in progress 2026-11-21 (wave C, owner's go). Proposed owner: Codex CLI (gpt-6.2-sol, high). Branch `task/293-philadelphia-warnings`, worktree
`D:\cityflows-wt\293`, ports 5493 / 5593.

## Goal

Philadelphia's raw polygon import gives 155 validation warnings (TASK-285 F1) and loads at about 1.2x Freiburg
(F2). Group the warnings by kind, find each kind's cause in the importer's reading of OSM (not in OSM: no edits,
no per-id curation) and fix the reading where it is wrong; where a warning is right (the data really is odd),
say so and leave it. Then profile Philadelphia's load and make the hot paths fast in general code. Rebuild the
bundled projects; simulation changes are possible only where a fixed reading changes the network.

## Scope

`src/importers/osm/**` reading rules, the validation messages, the load hot paths, tests, the bundled
projects' rebuild.

Out of scope: `src/schema`, routing and simulation rules, gate floors, `bench/traffic-baseline.json`.

## Gates

- Warning counts by kind before and after, in every bundled city (no city gains warnings).
- Load budgets for Philadelphia and Freiburg, interleaved main against branch.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full demand on
  seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; every bundled city's showcase gate; the
  Munich gate and the mode-share guard.
- The owner's merge rule. If the first version misses, one variant, both tables.
  (Identical hashes are the expected result where the network does not change.)
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
