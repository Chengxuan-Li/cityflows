# TASK-263 — Elevators drawn as elevators (owner's bug 6)

Status: queued 2026-11-20 (third unsupervised run, owner's bug report). Proposed owner: Claude Code
subagent (Opus 5.5, high). Branch `task/263-elevators`, worktree `D:\cityflows-wt\263`, ports 5463 / 5563.

## Goal

The owner logged (2026-11-20, Freiburg, shot `bug6.png` in `docs/findings/2026-11-20-owner-3d-bugs/`) dark towers with lit windows along the
Hauptbahnhof's footbridge and asked whether the data says they are elevators. It does: Freiburg's extract
has 5 `building=elevator` ways, 2 `building:part=elevator` ways and 11 `highway=elevator` nodes. Draw them
as elevator shafts: a glass or framed shaft without office windows or lit-window lighting, its height to
the footbridge or the level it serves (or the tagged `height`), a door at the levels it serves, and for a
`highway=elevator` node without a building, a small shaft or a pictogram where it stands (pick by what
reads best and say why). Count per city.

## Scope

`src/render3d/scene.ts` buildings path and window lighting (`lights.ts`), `heights.ts`, the importer's
building reading only to carry the `elevator` value if the city drops it (say where), tests, close-ups
under `docs/findings/2026-11-20-elevators/`.

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

Write it as the commit body: the rule, the counts, the close-ups, the hashes and budgets.
