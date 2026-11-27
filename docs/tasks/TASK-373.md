# TASK-373 — US walker priority at unmarked junction crosswalks, without the UK rule

Status: started 2026-11-27 (lead default after TASK-372; city work merges under the traffic merge rule). Owner: Codex
(gpt-6.2-sol, high). Base: branch `task/372-walker-country` at `ec1ebd5d`.

## Finding (TASK-372)

TASK-372 added an optional `country` on the city schema, set by the importer from `geo`, and two rules:
- **gb:** drivers turning out of the crossed arm also yield (Highway Code H2). London City then gridlocks one trip and
  its worst visit rises from 822.3 s to 1,472.7 s, over the 900 s limit, in both versions.
- **us:** walkers have priority at unmarked crossings at a junction, as at a zebra; not mid-block. Philadelphia passes:
  completed 4,689 → 4,679, mean delay 151.0 → 153.8 s, worst visit 412.5 → 579.6 s. Boston is held out.

German and Swiss cities were identical by hash.

## Goal

Keep the `country` field and the US rule; turn the UK rule off, so that `gb` reads like `de`. Keep the gb test and code
behind a switch only if it stays small and off by default; otherwise remove it (the branch keeps it).

## Scope

As TASK-372: `src/schema` (the optional field), `src/importers`, `src/network/walk.ts`, `src/sim/walkers.ts`,
`docs/architecture.md` (5.4, 5.5, schema), tests, bundled-city rebuilds and re-pins.

Out of scope: gate floors, `bench/traffic-baseline.json`, OSM edits, per-id curation, signal programs.

## Gates

- de/ch cities (Munich, Freiburg, Sindelfingen, Lübeck, Zurich) and gb cities (York, London City, Heathrow)
  identical to main by state hash; only the `country` metadata and the city digest differ.
- Philadelphia showcase passes; report completed, mean delay, worst visit, walker waits, vehicle seconds lost to
  yields against main.
- Airside unchanged: Heathrow peak seed 1 and the London City day identical to main.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.