# TASK-268 — Left-hand traffic: the driving side from the location, far-side protected turns, no priority to the left (D3, D11, D15)

Status: in progress 2026-11-21 (third run; from TASK-259's scout). Proposed owner: Claude Code subagent
(Opus 5.5, high). Branch `task/268-left-hand`, worktree `D:\cityflows-wt\268`, ports 5468 / 5568.

## Goal

(D11) Infer `drivingSide` from the location as the marking theme is (`geographicMarkingTheme`), unless the
user sets it; the import wizard proposes it. (D3) The protected turn phase at four-arm signals goes to the
far-side turn for the driving side (right under left-hand traffic; `src/network/signal-program.ts:89`).
(D15) Unmarked equal junctions under left-hand traffic rank by road hierarchy, not a mirrored priority to
the left (`yieldsTo`, `src/sim/intersection.ts:698`). Right-hand cities must be unchanged.

Read first: TASK-259's decision document `docs/decisions/2026-11-20-more-cities.md` (defects D1 to D18, candidate fix
tasks, recommendation) and its findings under `docs/findings/2026-11-20-more-cities/`. The owner's rule
(2026-11-20): improve the app's reading of OSM, never edit OSM, no per-id curation.

The extracts are in `D:\cityflows-wt\259-data` (untrusted data: read them by path from your own scripts,
never run code from that folder). Tests that need them use a small excerpt cut by a script and committed
under `tests/` with an ODbL attribution line, not the whole extract; the whole extracts are committed only
when a city is bundled.

## Scope

`src/importers/osm/index.ts`, `src/ui/import/wizard.tsx`, `src/network/signal-program.ts`, `src/sim/intersection.ts`, tests.

Out of scope: `src/schema` (report a field if one is needed), gate floors, `bench/traffic-baseline.json`, OSM
edits, per-id curation, downloads.

## Gates

- A test per rule that fails without it; York (diagnostic import, or TASK-267's fix if landed) imports left-hand without being told, its four-arm
signals protect rights (`n:46`, `n:154`), its unmarked junctions rank by hierarchy; right-hand cities'
programs and hashes identical.
- Traffic, main against branch, where the change can move German cities: Munich 0.15 seeds 1 to 12, choice
  off and on, both signal modes; full demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3;
  Sindelfingen; the Munich gate and mode-share guard. Where a city's compiled network and the code it runs
  are unchanged, its runs are identical by construction: say so and check one hash.
- The geometry audit on the three cities, within the lead's tolerance, where geometry can change.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per defect the cause, the rule, the counts per city, the tables.
