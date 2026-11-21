# TASK-286 — Polygon gateways that the router can use: lane changes by the router's rule (York's Layerthorpe)

Status: in progress 2026-11-21 (third run). Proposed owner: Claude Code subagent (Opus 5.5, high). Branch
`task/286-gateway-lane-change`, worktree `D:\cityflows-wt\286`, ports 5486 / 5586.

## Goal

TASK-284 kept York out of the New city panel: every one of its `no_route` failures (3 on seed 1) starts at the
Layerthorpe gateway (way 1557301701, `p:3687`). Its exit lane `r:3638#0` (9.1 m) reaches the core only by changing
lanes on roads of 5 to 22.6 m, shorter than the 30 m the router needs, so every route from it fails. TASK-270's
gateway rule counts a lane change on any road (`networkAccess` in `src/importers/osm/places.ts`). Use the router's
own lane-change rule there (so a gateway lane counts only if the router could leave it), and choose a working lane
of the same road (`r:3638#1` works) where one exists. Measure every polygon city.

## Scope

`src/importers/osm/places.ts` (and the routing helper it should share, if any), tests, the bundled projects'
rebuild (`bench/bundled-cities.ts`).

Out of scope: routing rules themselves, `src/schema`, gate floors, `bench/traffic-baseline.json`.

## Gates

- A test that fails without the rule. York's showcase gate (TASK-284's archive and method) with `no_route` 0 on
  seeds 1 to 3; gateways per polygon city (Freiburg, Lübeck, Philadelphia, York, Cambridge diagnostic) before and
  after.
- Traffic, main against branch: Freiburg's gate and seeds 1 to 3; Munich and Sindelfingen (bbox imports) identical
  by construction (check one hash each); the Munich gate and mode-share guard.
- The owner's merge rule.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body.
