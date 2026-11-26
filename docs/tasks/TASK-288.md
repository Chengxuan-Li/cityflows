# TASK-288 — Populations draw gateway trips only among gateways the home's car reaches (TASK-283's follow-up)

Status: in progress 2026-11-21 (owner's go, 2026-11-21). Proposed owner: Claude Code subagent (Opus 5.5, high).
Branch `task/288-reachable-gateways`, worktree `D:\cityflows-wt\288b`, ports 5488 / 5588.

## Goal

TASK-283 judges a trip that leaves home by the home's own car, so polygon imports keep their gateways into pockets
behind destination streets and bus gates without `no_route`. People whose population draw assigned them a
gateway their car cannot reach now stay home: Lübeck 13,516 to 12,959 trips a day, Cambridge 4,546 to 3,867.
Draw a person's gateway work or visit destinations only among gateways reachable by the home's own car (both
ways, as the trip and its return need), so these people travel again. Where no gateway is reachable, keep
the current fallback and count them. The change is in the general population draw, not per city.

## Scope

`src/demand` (population draw, gateway choice, `carService` as TASK-283 left it), tests, the bundled projects'
rebuild (`bench/bundled-cities.ts`, staleness pins).

Out of scope: `src/schema`, routing rules, `src/importers` gateway placement, gate floors,
`bench/traffic-baseline.json`.

## Gates

- Tests that fail without the change. Lübeck (bundled) and Cambridge (TASK-259's extract in
  `D:\cityflows-wt\259-data`, read by path, never run code there): trips a day before TASK-283, after it, and
  with this task; people left without a reachable gateway; `no_route` 0; the showcase gates of every bundled city.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full demand on
  seeds 1 to 5, both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; the Munich gate and the mode-share
  guard. Populations may change where some homes reached no gateway; say which cities' populations change.
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
