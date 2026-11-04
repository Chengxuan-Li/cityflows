# TASK-059 — Roundabout removal as an inverse command

Owner: unassigned
Gate: 5 (review note from TASK-049)
Depends on: TASK-049

## Goal

`removeRoundabout` restores a junction from a full before-and-after snapshot stored on the
center node (`Node.roundabout.before`, `.after`, `RoundaboutSnapshot` in
`src/schema/city.ts`, used in `src/editor/commands/roundabout.ts`). That is more state than
an inverse command, it grows every saved city that has a roundabout, and removal refuses to
run after any edit to the approaches because the snapshot no longer matches. Removal should
rebuild the junction from what is on the map now.

## In scope

- `src/editor/commands/roundabout.ts`: `removeRoundabout` computes the junction from the
  current ring: the center from the ring's centroid, each entry and exit leg pair merged
  back into one road through a new junction node (reuse `mergeRoads` and `moveNode` from
  `topology.ts` where they fit), connectors relocated as other topology commands do. It
  refuses only when the ring itself is broken (a ring road deleted or re-attached), with a
  message saying which road.
- `src/schema/city.ts`, `src/schema/city.schema.ts`, `src/schema/migrate.ts`: contract
  change, approved here: `Node.roundabout` becomes `{ radiusM, ringRoads, restore }` where
  `restore` holds only what the ring cannot reproduce: the original node's `control`,
  `signal`, `minorRoads` and `turnRules`. Bump the city schema version; the migration drops
  `before` and `after` from old files and fills `restore` from `before.nodes[center]`.
- `docs/architecture.md` section 6: the sentence on `addRoundabout` and `removeRoundabout`
  describes the new record, in the same PR.
- `tests/editor`: add, edit an approach's speed, remove, undo, redo; add on a signalized
  junction and remove restores the program; a migrated old record removes correctly;
  `tests/e2e/gate5-controls.spec.ts` "draw a roundabout ... restore the junction" stays
  green, additively asserting that an approach edit between add and remove is allowed.

## Out of scope

- `addRoundabout`'s geometry, the Roundabout tool (`src/ui/tools/roundabout.tsx`) beyond a
  renamed field, imported roundabouts (`src/importers/osm/controls.ts`), the renderer.

## Acceptance

- The gate5-controls roundabout scenario passes; the editor tests above pass; a saved
  project from `main` with a roundabout opens and its roundabout can be removed.
- `npm run check` green; `npm run test:e2e` green.

## Commands

`npm run check`, `npm run test:e2e`

## Deliverable

PR with the command, the schema change and migration, the architecture sentence and the
tests.
