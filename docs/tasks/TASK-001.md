# TASK-001 — Canonical schema, compile and synthetic fixtures

Owner: unassigned (one agent; this is the keystone, nothing in wave 1 starts before it merges)
Gate: 1
Depends on: scaffold on `main`

## Goal

The `City` canonical model, its Zod validation, the pure `compile(city)` that produces
`CompiledCity` with lane geometry, generated movements, conflicts, signal tables and
diagnostics, and the synthetic fixtures every later test uses. After this task, routing,
simulation, editing, rendering and persistence can be built in parallel against stable types.

## In scope

- `src/schema/`: `city.ts` (types from architecture section 4), `city.schema.ts` (Zod),
  `demand.ts` (Person, Activity, TripRequest, DemandConfig, Scenario from section 9),
  `history.ts` (Patch, HistoryEntry from section 6), `ids.ts` (allocation from `nextId`),
  `migrate.ts` (`migrateCity(json: unknown): City`, currently version 1 only, with the
  switch in place).
- `src/geo/`: `polyline.ts` (length, cumulative lengths, point and heading at distance,
  offset with miter and bevel per section 5.1, trim, Bezier sampling, segment intersection),
  `random.ts` (seeded generator with `next()`, `uniform(a, b)`, `normal(mean, sd)`,
  `pick(array)`, derived sub-generators by key; shared by sim, demand and routing), keep
  `projection.ts` and `vec2.ts`.
- `src/network/`: `compile.ts` (entry, returns `CompileResult`), `lanes.ts` (layout and node
  trimming), `movements.ts` (section 5.2), `conflicts.ts` (section 5.3), `signals.ts`
  (section 5.4), `diagnostics.ts` (codes and connectivity checks from section 5.5),
  `spatial.ts` (flatbush over lane segments).
- `src/fixtures/`: `grid5x5.ts`, `signal-approach.ts`, `bypass.ts`, `ramp.ts`,
  `divided-highway.ts`, `short-turn-lane.ts`, `disconnected.ts`, each `(seed?) => City`,
  as described in architecture section 14. Fixtures include places with connectors and one
  default `Scenario` per fixture in `src/fixtures/scenarios.ts`.
- `tests/network/`: tests listed below.
- `package.json`: add `flatbush` (ISC). No other dependency.

## Out of scope

- Routing, simulation, editing, rendering, persistence.
- OSM import. The schema must carry provenance and `geo`, but no importer code here.
- Any extension of the types beyond architecture sections 4 to 6 and 9. If something is
  missing, stop and report.

## Interfaces

Exactly the types in `docs/architecture.md` sections 4, 5, 6 (types only) and 9 (types
only). Export them from `src/schema/index.ts` and `src/network/index.ts`.

## Acceptance tests

- `tests/network/T18-schema-validation.test.ts`: an invalid city (dangling road node,
  negative lane width, connector lane out of range, signal node without a program) fails Zod
  or compile with the right `code` and the offending ids in `refs`; a hand-built minimal valid
  city passes.
- `tests/network/compile-grid.test.ts`: `grid5x5` compiles with `ok: true`; lane count equals
  the sum over roads; a two-way street's two lane blocks do not overlap (sample midpoints);
  lanes are trimmed by the node radius; `compile` run twice yields deep-equal results and
  identical movement ids.
- `tests/network/movements.test.ts`: at a four-way node with two-lane approaches, lane 0 has
  through and left, lane 1 has through and right; a road-level ban removes all lane pairs; a
  lane-level allow overrides a road-level ban; U-turns absent by default and present with an
  allow rule; left-hand traffic mirrors the turn lanes; vehicle class filtering.
- `tests/network/divided-highway.test.ts`: no movement joins the bridge road to either
  carriageway; the at-grade crossing has the expected movements; the two carriageways never
  get cross movements except at shared nodes.
- `tests/network/conflicts.test.ts`: opposing left turn conflicts with through; two through
  movements from the same lane do not conflict; two movements into the same lane conflict;
  priorities follow section 5.3.
- `tests/network/T13-signal-safety.test.ts`: conflicting movements in one phase give error
  `signal_conflict`; a valid two-phase program compiles with correct `cycleS` and per-time
  phase lookup; an unserved movement yields warning `signal_unserved_movement` and
  `neverGreen: true`.
- `tests/network/diagnostics.test.ts`: `disconnected` fixture compiles with warnings
  `disconnected_component`, `dead_end`, `connector_unreachable`, and `ok: true`.
- `src/geo/polyline.test.ts`: offset of a straight line and of an L-shape; point and heading
  at distance; segment intersection.

## Commands

`npm run check`

## Deliverable

PR with the modules, fixtures and tests. In the description: any place where the
architecture text was ambiguous and the interpretation chosen, so the lead can confirm or
amend the doc.

## Integration notes

Hot-path consumers (sim, routing) index `CompiledCity` arrays by `idx`; keep the arrays dense
and the `index` maps as the only string lookups.
