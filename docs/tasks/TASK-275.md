# TASK-275 — Covered and handrail on walk links (TASK-262's follow-up; owner-approved schema fields)

Status: in progress 2026-11-21 (third run). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/275-walk-covered-handrail`, worktree `D:\cityflows-wt\275`, ports 5475 / 5575.

## Goal

TASK-262 builds footbridge decks, railings, piers and canopies. Walk links do not carry OSM's `covered` or
`handrail` tags, so it gives railings to both sides everywhere and leaves covered ways without a mapped
roof open (the Stühlingerplatz paths, two covered stairs, the Dreisamradweg, the Schwabentorsteg). The owner
approved (2026-11-21) schema fields for `covered` and `handrail` on walk links.

1. Add optional walk-link fields, for example `covered?: boolean` and
   `handrail?: 'both' | 'left' | 'right' | 'center' | 'none'`. Read them from `covered`, `handrail`,
   `handrail:left|right|center` (and `handrail=yes` as both). Absent keeps today's drawing.
2. Railings honour `handrail` on raised ways and stairs (TASK-262's railings; TASK-261's flights).
3. A covered raised way without a mapped roof gets a light canopy on posts; one under a mapped roof keeps
   TASK-262's roof canopy. A covered way at grade draws a canopy only where nothing else is over it (say
   the rule and count it).

## Scope

`src/schema` (the fields, Zod), `docs/architecture.md`, `src/importers/osm/walk.ts`,
`src/render3d/footbridges.ts` and `walk.ts` where railings and canopies are built, tests, the bundled
projects' rebuild (`bench/bundled-cities.ts`), close-ups under `docs/findings/2026-11-21-covered-handrail/`.

Out of scope: `src/sim/**`, walk topology, gate floors, downloads. `indoor` and `wall` are not approved
fields here.

## Gates

- Tests: the tag reading, old projects unchanged, railings by `handrail`, canopies by `covered`. Counts per
  city.
- Close-ups at the Schwabentorsteg, the Stühlingerplatz paths and the Hauptbahnhof stairs, day and night.
- State hashes identical.
- Frame budgets and 3D build.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
