# TASK-309 — Airside import rules on the Zurich, Boston and Heathrow extracts

Status: planned 2026-11-22 (airports batch wave B, owner's go; starts after TASK-295). Proposed owner: Codex CLI
(gpt-6.2-sol, high). Branch `task/309-large-airside-import`, worktree `D:\cityflows-wt\309`, ports 5509 / 5609.

## Goal

Settle TASK-295's import and topology rules on the three large extracts before they are bundled, so TASK-302 to
304 can run in parallel (`docs/decisions/2026-11-22-airports.md`, wave B). No bundling, no UI.

- Import the airside of `D:\cityflows-wt\airport-data\zrh.osm`, `bos.osm` and `lhr.osm` (untrusted, read by path;
  commit them as `fixtures/osm/zurich-airport.osm`, `boston-logan.osm`, `heathrow.osm` with attribution entries
  from `record.txt`) and report TASK-295's counts for each: runways and crossings, edges by kind, holding positions
  joined and generated, stands joined, generated and unreachable, codes by stand, terminals and detached groups,
  hangars, helipads, road–airside crossings.
- Where a rule fails (unjoined stands, holds off the graph, runway crossings not split, code limits wrong at
  dual-taxiway lanes), fix the rule so London City stays as it is or improves; state each failure and its fix.
- An import-only city test per airport that pins the counts (fast: the airside import only, within the test-time
  budget).

## Scope

`src/importers/osm` (airport reader), `src/network` airside compile, `fixtures/osm`, tests, `docs/architecture.md`
where a rule changes.

Out of scope: bundling and the New city panel (TASK-302 to 304), aircraft and operations, per-id curation, OSM
edits, gate floors, `bench/traffic-baseline.json`, any other download.

## Gates

- Counts per airport before and after the rule fixes; every stand reaching a runway, or listed with why not.
- London City's archive identical or each change explained; existing cities byte-identical.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
