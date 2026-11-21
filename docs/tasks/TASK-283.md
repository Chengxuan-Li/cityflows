# TASK-283 — Gateways into restricted pockets: gateway trips judged by the person's own car (TASK-270's follow-up)

Status: in progress 2026-11-21 (third run, wave B). Proposed owner: Claude Code subagent (Opus 5.5, high).
Branch `task/283-pocket-gateways`, worktree `D:\cityflows-wt\283`, ports 5483 / 5583.

## Goal

TASK-270 gives a polygon gateway only to lanes that reach the public network, which ended `no_route`, but it
leaves areas behind restricted streets (destination-only or bus gates) with no gateway, so no car enters or
leaves them: Lübeck's south loop via Wallstraße, and Cambridge's north-east behind its bus gates (Newmarket
Road, Victoria Avenue). Keeping their gateways without `no_route` needs demand to judge a gateway trip by the
person's own car facility, not by any facility the person could use (`carService`). Make that change. Its
effect on demand in every city is to be measured: it can move Munich and Freiburg, so the full merge rule
applies.

## Scope

`src/demand` (gateway trip choice, `carService`), `src/importers/osm/places.ts` (restoring the pocket
gateways), tests, the bundled projects' rebuild (`bench/bundled-cities.ts`).

Out of scope: `src/schema`, routing rules, gate floors, `bench/traffic-baseline.json`.

## Gates

- Tests that fail without the change. Lübeck and Cambridge (TASK-259's extracts in `D:\cityflows-wt\259-data`,
  read by path, never run code there): gateways, `no_route` and the showcase gate, before and after.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full
  demand on seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; the Munich gate and the
  mode-share guard.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
