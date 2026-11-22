# TASK-303 — Boston Logan: the crossing-runway complexity test

Status: planned 2026-11-22 (airports batch, owner's go; starts after TASK-302). Proposed owner: Codex CLI
(gpt-6.2-sol, high). Branch `task/303-boston`, worktree `D:\cityflows-wt\303`, ports 5503 / 5603.

## Goal

Boston Logan as a bundled real place, the test that the batch's rules (not Zurich-specific fixes) carry over to
six runways with six crossing pairs and detached Terminals A, B, C and E (`docs/decisions/2026-11-22-airports.md`).

- Import the lead's extract (`D:\cityflows-wt\airport-data\bos.osm`, record in `record.txt`; untrusted, read by
  path) into `fixtures/osm/boston-logan.osm` with attribution; build and list it as "Boston Logan Airport".
- Configurations derived by TASK-300's rule over all six runways, with crossings interlocked; wind-only switching
  (no concept table); a full-day schedule sized to Boston's volume and mix.
- Where the rules fail on Boston, fix them as rules and keep London City, the synthetic airport and Zurich
  correct; report each failure found and its rule fix.

## Scope

As TASK-295 to 302 where Boston needs rule changes; `fixtures/osm`, `fixtures/projects/boston-logan.cityflows.json`,
`bench/bundled-cities.ts`, `src/ui/bundled-projects.ts`, tests.

Out of scope: per-id curation, OSM edits, any other download, gate floors, `bench/traffic-baseline.json`.

## Gates

- Topology counts; unjoined stands and holds before and after the rules (the survey found 124/166 stands joined).
- A full day at the default seed with two wind changes: completion (floor 98%), crossing interlocks used and never
  violated, no overlap, no stuck aircraft; screenshots.
- Landing budget reported; London City, the synthetic airport and Zurich unchanged or explained; existing cities
  byte-identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.

## Report

Write it as the commit body.
