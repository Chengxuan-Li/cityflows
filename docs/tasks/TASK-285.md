# TASK-285 — Philadelphia as a preloaded city

Status: in progress 2026-11-21 (third run, wave B). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/285-bundle-philadelphia`, worktree `D:\cityflows-wt\285`, ports 5485 / 5585.

## Goal

TASK-259 recommended Philadelphia's Center City polygon after D7 (polygon gateways, TASK-270), D9 (City Hall,
TASK-272) and D10 (budgets, TASK-277); all three are in. Add it to the bundled cities with TASK-258's builder: the raw
import, no per-id curation, the showcase scenario, flat. Commit its extract from `D:\cityflows-wt\259-data`
(`philadelphia-center-city.osm`) under `fixtures/osm/` with a full `ATTRIBUTION.txt` entry. Add it to the New city
panel's "Real places" with a one-line note and `?city=philadelphia`. It must pass the showcase gate (drain, no
gridlock, no stalled heads, `no_route` 0, parking failures under 2%) and the load and frame budgets, measured as
TASK-258 did; if it is over budget, report the numbers and keep it out of the panel. TASK-284 adds Lübeck and York
to the same builder and panel in parallel: keep your edits additive so the merge is a union.

## Scope

`bench/bundled-cities.ts`, `fixtures/osm/` (the extract and attribution), `fixtures/projects/` (its archive),
`src/ui/bundled-projects.ts`, the panel list, tests (staleness, gate, the real-places spec), screenshots.

Out of scope: importer or simulation changes (report defects with ids as follow-ups), `src/schema`, downloads.

## Gates

- The showcase gate and budgets; the staleness test covers it; the real-places spec opens it.
- Existing state hashes unchanged.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`; screenshots of its first view in 2D and 3D.

## Report

Write it as the commit body.
