# TASK-262 — Footbridges with structure: piers, railings and canopies (owner's bugs 5 and 7)

Status: queued 2026-11-20 (third unsupervised run, owner's bug report). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/262-footbridge-structure`, worktree `D:\cityflows-wt\262`, ports 5462 / 5562.

## Goal

The owner logged (2026-11-20, Freiburg, shots `bug5.png`, `bug7.png` in `docs/findings/2026-11-20-owner-3d-bugs/`) that footbridges float:
the Hauptbahnhof's bridge over the platforms and the footbridge over the Leopoldring by Auf der Zinnen are
thin slabs in the air. The owner asks for actual models: piers, railings and, where covered, a canopy.

Freiburg's extract has 72 `footway`, 14 `path`, 4 `cycleway`, 22 `steps` and 1 `pedestrian` bridge ways;
18 are `covered=yes`, 18 carry `handrail`, 2 `man_made=bridge` outlines, 1 `bridge:structure`. Build, by
rule from the data:

- a deck with thickness and side fascias, the bridge outline from `man_made=bridge` where mapped;
- railings along open edges (both sides by default, `handrail` honoured), not where the bridge meets a
  building, a platform or stairs;
- piers at a spacing and at the ends where the bridge does not land on a building, a platform roof or
  an embankment, standing on the ground or on the platform below, never on a track or a carriageway
  (put them beside it, or span it);
- a canopy for `covered=yes` (roof on posts, or the walls and roof of an enclosed passage where tagged
  `wall` or `indoor`).

Keep it cheap: shared geometry, the 3D build within budget.

## Scope

`src/render3d/walk.ts` or a new `src/render3d/footbridges.ts`, `scene.ts` wiring, the importer's reading
of the tags above into the walk links only if the city does not carry them yet (say which; a schema field
is out of scope, so report it if one is needed instead of adding it), tests, close-ups under
`docs/findings/2026-11-20-footbridges/`.

Out of scope: `src/sim/**`, `src/network/**` rules, `src/schema` (unless named), the importer's road and walk topology, gate floors, OSM edits, per-id curation.

## Gates

- A test per fix that fails without it; counts per city of the shapes changed.
- Close-ups before and after at the owner's views (night lighting as in the owner's shots, and day),
  Freiburg first, and a sample in Munich and Sindelfingen.
- Render only: identical state hashes (Munich 0.15 seed 1 four configurations, Freiburg's gate,
  Sindelfingen, both full demands).
- Frame budgets and 3D build time on the Freiburg landing spec, main against branch (3D build within
  5 s; TASK-206).
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the rules, the counts (bridges, piers, railings, canopies per city), what the
data could not tell, the close-ups, the hashes and budgets.
