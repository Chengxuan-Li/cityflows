# TASK-359 — Batched aircraft meshes: Heathrow's 3D frame under budget

Status: started 2026-11-26 (owner defaults). Owner: Claude subagent (Opus 5.5). Base: main.

## Finding (TASK-357, 2026-11-26)

After TASK-357, Heathrow's 3D render p95 is 5.7–6.1 ms against its 6 ms budget on a loaded machine: 6 of 7 runs
passed; TASK-354 measured 4.6–4.9 ms on a quiet one.

The cost is about 390 draw calls per frame, mostly each aircraft drawn as several separate meshes:
- fuselage, wings, tail and engines;
- livery parts;
- jet bridges;
- ground vehicles.

## Goal

Draw aircraft, and the ground vehicles if cheap, with far fewer draw calls:
- instancing per type and part;
- or merged geometry per type, with per-instance transforms and colours.

Output must look the same (pixel compare against main, as TASK-357 did). Night lights, shadows, selection and
picking keep working.

## Gates

- Heathrow 3D p95 well under 6 ms, with margin, over several runs.
- Other places' 3D frame times not worse.
- Screenshots identical, or explained per pixel class.
- Picking and selection tests pass.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, `tests/e2e/real-places.spec.ts`.
