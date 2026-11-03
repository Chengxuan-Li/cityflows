# TASK-022 — Topology editing: draw, split, delete, move

Owner: unassigned
Gate: 2
Depends on: TASK-007, TASK-010

## Goal

Roads can be drawn, connected, split, deleted and reshaped on the map, and the result is
canonical topology that changes legal routes: T12 in full and the "Road" tool of the brief.

## In scope

- `src/editor/commands/topology.ts`: `addRoad` (with new nodes; snapping to an existing
  node reuses it; snapping onto an existing road splits it first, as one batch entry),
  `deleteRoad` (removes orphaned nodes, rules and connectors referencing it, reported as
  warnings), `splitRoad` (new node at `atM`, lanes and rules carried over, connectors
  reassigned by position), `moveNode` (updates centerline endpoints of incident roads),
  `mergeRoads` (inverse of split for two roads sharing a degree-two node with equal
  attributes; add to the `Command` union, lead-approved as part of this task).
- `src/ui/tools/draw-road.tsx`: click to place vertices, snap to nodes and roads with a
  visible snap target, Enter or double-click to finish, Escape to cancel, options for two-way
  street (creates the pair with a `streetGroupId`) and lanes per direction, class and speed
  defaults by class.
- `src/ui/tools/select.tsx`: drag a node to move it; split via inspector button at a point
  on the street.
- `src/render/layers/edit-overlay.ts`: preview polyline, snap markers, handles.
- `tests/editor/T12-topology.test.ts`, `tests/e2e/gate2-edit.spec.ts`.

## Out of scope

- Multi-select and batch edits (TASK-023), ramps tool (TASK-032).

## Acceptance

- T12 (headless): add a connecting bypass on `grid5x5`; all new ids are valid; compiled
  movements at both ends exist; routing uses the bypass when it is faster; undo restores a
  city deep-equal to the original except `version`; split then merge restores the original
  road attributes; delete removes dependents with warnings and never leaves dangling refs
  (compile has no errors).
- Grade separation: drawing a road across another without snapping to it creates no node and
  no movement (assert after compile).
- e2e: draw a two-way street that connects two existing nodes, restart, and assert at least
  one inspected vehicle route uses a road id created in this session.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with commands, tools, overlay, tests and a short screen recording or screenshots of
drawing with snapping.
