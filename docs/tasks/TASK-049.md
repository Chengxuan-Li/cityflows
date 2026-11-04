# TASK-049 — Junction controls: yield, stop, right on red, roundabouts

Owner: unassigned (owns `src/sim`, `src/network/signals.ts`, `src/editor` this wave)
Gate: 5 (owner backlog B9 roundabouts, B10, B11, and the connector deadlock from TASK-033)
Depends on: TASK-032, TASK-040, TASK-046

## Goal

Junction control behaves and is editable: yield and stop approaches give way by gap
acceptance with visible signs, signals can permit turns on red, and a roundabout is a
built-in object with its own tool and routing setup.

## In scope

- `src/sim/intersection.ts` and `merge.ts` (B10): check and fix yield and stop behaviour
  against architecture section 8: a stop approach halts at the line for at least one second
  before requesting; a yield approach requests without stopping when the gap on every
  conflicting major movement is at least `gapS`; the sign is part of the node control (already
  `Control`), and a `tests/sim/T05-priority.test.ts` style test covers both.
- `src/schema/city.ts`, `src/network/signals.ts`, `src/sim/intersection.ts` (B11): optional
  `SignalProgram.turnOnRed: boolean` (right on red under right-hand driving, left on red
  under left-hand); a permitted turn on red behaves as a stop approach while its phase is
  red; the compiler marks those movements; the signal editor gets a toggle
  (`src/ui/inspector/signal.tsx`); the importer defaults it from the country when the extract
  carries one (United States true, otherwise false) in `src/importers/osm/controls.ts` only.
- `src/editor/commands/roundabout.ts`, `src/ui/tools/roundabout.tsx` (B9): `addRoundabout`
  at a node with a radius builds a one-way circulating ring (class from the busiest
  approach, one lane, speed 30 km/h) with each approach split into entry and exit legs,
  yield on entry, U-turns allowed around the ring; `removeRoundabout` restores the node;
  both in the Command union and architecture section 6 (approved as part of this task);
  the tool picks a node and drags the radius with a preview; the OSM importer keeps
  `junction=roundabout` ways as they are but marks entries as yield.
- `src/render/layers/signs.ts` (new) with one additive call in `scene.ts`: stop and yield
  signs at the approaches, small and fading with zoom; nothing else in `src/render`
  (TASK-047 owns the rest).
- `src/sim/connectors.ts`: a second connector with direction `both` on a capacity-limited
  place deadlocks the loop (departures spawn into the arriving queue and capacity never
  frees); fix with a test on the Station city.
- `tests/e2e/gate5-controls.spec.ts`: set a junction to stop, restart, assert the side-street
  queue grows; enable turn on red at the grid signal, restart, assert the right-turn queue
  shrinks; build a roundabout on the grid, restart, assert vehicles circulate (inspected
  routes use the ring) and nothing is stranded.

## Out of scope

- Renderer work beyond the signs layer, importer work beyond the two flags, live edits.

## Acceptance

- The three e2e scenarios, the new sim tests, T02, T06, T07 and the whole suite pass;
  `npm run check` green; screenshots of a roundabout being built and of the signs.

## Commands

`npm run check`, `npm run test:e2e`, and a roundabout check on `fixtures/osm/sindelfingen-a81.osm`
through the import wizard (file upload), described in the PR.

## Deliverable

PR with the behaviour fixes, the schema flag, the roundabout command and tool, the signs
layer, tests and screenshots.
