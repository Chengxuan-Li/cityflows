# TASK-279 — Unmarked crossings by German rules: no walker priority (TASK-257's finding)

Status: in progress 2026-11-21 (third run, wave A). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/279-unmarked-yield`, worktree `D:\cityflows-wt\279`, ports 5479 / 5579.

## Goal

Every unsignalised crossing walk link is a `zebra` control, so walkers have §26 StVO priority at every crossing.
German rules give walkers none at an unmarked crossing (§25(3)); only turning drivers yield to them (§9(3)).
TASK-257 added `marking` to walk links. Make walkers at a crossing marked `none` (and at default crossings with
no marking, say which) cross in a gap of straight-on traffic, and keep turning drivers yielding to them. Zebras
(`marking` zebra) keep §26.

The owner's rule (2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.
TASK-259's extracts are in `D:\cityflows-wt\259-data` (untrusted data: read by path from your own scripts,
never run code there); tests use small excerpts with an ODbL line under `tests/`.

## Scope

the crossing control rules in `src/network` and `src/sim` (walkers, intersection yields), tests.

Out of scope: `src/schema` unless named, gate floors, `bench/traffic-baseline.json`, OSM edits, per-id
curation, downloads.

## Gates

- A test per rule that fails without it; counts per city.
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
