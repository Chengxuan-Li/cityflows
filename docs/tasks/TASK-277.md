# TASK-277 — Philadelphia within budget, and transit names (TASK-259's D10, D13)

Status: in progress 2026-11-21 (third run, wave A). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/277-philadelphia-budget`, worktree `D:\cityflows-wt\277`, ports 5477 / 5577.

## Goal

Philadelphia's polygon (TASK-259) is over budget: 2D render p95 9.1 ms (4), 3D build 6.9 to 7.9 s (5), step 1.0
ms, 12,926 persons on 151 signals (D10). Its regional rail stops are named "Platform", the trolley tunnel's stop
"3", and the subway does not run (D13). Bring it within budget by profiling and fixing the hot paths in general
code (not by shrinking the city unless no general fix suffices: then say so with numbers); fix the stop naming
rule and say what subway service needs.

The owner's rule (2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.
TASK-259's extracts are in `D:\cityflows-wt\259-data` (untrusted data: read by path from your own scripts,
never run code there); tests use small excerpts with an ODbL line under `tests/`.

## Scope

the hot paths the profile names (render, render3d, sim step), the transit stop naming in the importer, tests,
a bench timing script.

Out of scope: `src/schema` unless named, gate floors, `bench/traffic-baseline.json`, OSM edits, per-id
curation, downloads.

## Gates

- A test per rule that fails without it; counts per city.
- Philadelphia's budgets before and after; Freiburg's and Munich's not worse.
- Changes to simulation code keep every state hash identical unless the task changes behaviour (then the
  traffic gates below apply).
- Traffic, main against branch, where the change can move a city: Munich 0.15 seeds 1 to 12, choice off and on,
  both signal modes; full demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen;
  the Munich gate and mode-share guard. A city whose compiled network and code path are unchanged is
  identical by construction: say so and check one hash. Current main references: Freiburg gate 1,530 / 0,
  62.6 s, hash 2336162246; full demand seed 1 actuated 3122453100, fixed 3744260107.
- The owner's merge rule (and the audit tolerance where geometry changes). If the first version misses, one
  variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
