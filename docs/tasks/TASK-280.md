# TASK-280 — One height profile for rail tracks sharing a bridge (TASK-260's leftover)

Status: in progress 2026-11-21 (third run, wave A). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/280-rail-bridge-profile`, worktree `D:\cityflows-wt\280`, ports 5480 / 5580.

## Goal

Ground switches pin the rail height profile to zero and push ramps onto bridges; where two tracks leave a switch
at different grades, the deck follows the lower bed and the higher one floats up to about 2 m (Freiburg 148
covered bed points on 5 tracks, TASK-260's review). Give tracks that share a bridge or embankment one profile
(heights in `src/network/rail.ts`), so the deck carries every bed. Trains run on these heights only for drawing:
say whether any simulation reads them.

The owner's rule (2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.
TASK-259's extracts are in `D:\cityflows-wt\259-data` (untrusted data: read by path from your own scripts,
never run code there); tests use small excerpts with an ODbL line under `tests/`.

## Scope

`src/network/rail.ts` heights, `src/render3d/rail.ts` if it follows, tests, close-ups.

Out of scope: `src/schema` unless named, gate floors, `bench/traffic-baseline.json`, OSM edits, per-id
curation, downloads.

## Gates

- A test per rule that fails without it; counts per city.
- Covered bed points per city before and after (TASK-260's measure).
- State hashes identical, unless the simulation reads rail heights (then the traffic gates below).
- Render only: identical state hashes (one Munich, the Freiburg gate, Sindelfingen, one full demand).
- Frame budgets and 3D build on the Freiburg landing spec, main against branch.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
