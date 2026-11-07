# TASK-097 — Shadows and edges that show which roads are raised and which run below

Owner: unassigned
Gate: 6 (visual representation, owner 2026-11-07)
Branch: `task/097-grade-shadows` (created by the lead from main)
Depends on: TASK-090 (tiers). Design: this file; `docs/architecture.md` section 11 (grade
groups, terrain cache) and section 13 step 4 (how nodes and roads get their grade). Read those
before the code.

## Goal

The owner: "shadow representations for road z level differentiation". Roads and nodes carry a
grade (OSM `layer`), and `src/render/scene.ts` draws one group per grade, lowest first. A bridge
deck therefore covers what runs below it, but nothing tells the eye that it is raised. The
Donnersberger bridge, the `n:967` overpass and Sindelfingen's A81 bridges read as flat
overlaps. At `n:967` the west approach's signal heads are hidden under the bridge (open item from
TASK-094).

Make grade separation readable with a cast shadow, deck edges, a tunnel style, and see-through
for what a deck covers. Presentation only: no geometry, network or simulation change.

## Design

1. **Heights.** One constant `GRADE_HEIGHT_M = 5`: grade `g` stands at `5 * g` metres. Use the
   grades `scene.ts` already computes (`nodeGrades`, `roadGrades`); do not compute grades a
   second way.
2. **Cast shadow.**
   - Owner revision (2026-11-07): ground streets cast nothing. For every grade above 0,
     draw a shadow of that grade's road surfaces
     and node areas (`CRoad.surface`, `CNode.outline`) onto what lies below: a dark fill at
     about 25% opacity, offset by `Δh × k` in one fixed light direction (light from the
     north-west, so shadows fall to the south-east; start with `k = 0.6`, name the value you
     settle on). `Δh` is the height above the grade below (5 m for grade 1 over grade 0).
   - Soft edge: a penumbra of about 1.5 m, done by two or three offset fills of decreasing
     opacity or by a blur on the cached texture. Pick the cheaper one and measure it (gate 4).
   - Where a deck road meets a node at a lower grade (a bridge end whose node is on the
     ground, section 13 step 4), the offset fades to zero over the last 20 m, so the shadow
     meets the abutment instead of floating off it.
   - The shadow lives in its own `Graphics` at the bottom of the higher grade's group, so it
     falls on lower roads, vehicles and signals alike, and sits under the deck that casts it.
   - Grades below 0 cast nothing onto grade 0.
3. **Deck edges.** A raised road's two outer surface edges get a 0.35 m darker line (a parapet),
   not at its junction mouths or where it touches another surface of the same grade.
4. **Tunnels.** Road surfaces of grade below 0, where they are not covered, draw at about 55%
   opacity with dashed edges, the usual map convention.
   Owner revision (2026-11-07): lower streets receive an inset shadow on themselves, clipped
   inside their road and node surfaces. Use 5 m depth per negative grade, the same light
   direction and penumbra, and fade the inset to zero at ground-level portals over 20 m.
5. **See-through under decks.** Signal heads and vehicles of a lower grade that a higher deck
   covers stay visible as a ghost: a copy of the lower grade's `signals` and vehicle containers
   drawn above the higher grades at about 35% opacity. Mask or limit it to where it is covered
   if that is cheap; if not, an unmasked ghost is acceptable (it overlays its own original where
   nothing covers it). Verify at `n:967` (TASK-094's hidden lights).
6. **Layers.** A Layers entry "Shadows" (`LayerVisibility.shadows`, default `true`) turns 2 to
   5 off together. With it off the map is pixel-identical to main.
7. **Cache.** Shadows and edges are static: build them in `setCity` with the terrain and let
   them share the grade terrain's `cacheAsTexture` at overview zoom.

## In scope

`src/render/layers/shadows.ts` (new), `src/render/scene.ts` (wiring, ghost copies),
`src/render/style.ts`, `src/render/types.ts` (`LayerVisibility`), `src/ui/layers.tsx`,
`bench/geometry-shots.ts` (cameras), `docs/architecture.md` section 11 (describe what you
built), tests (a unit test for the shadow geometry next to the layer, an e2e case tagged
`@smoke`), and the expectations that move, each named.

## Out of scope

`src/render/layers/roads.ts` and `nodes.ts` (TASK-095 is editing them; draw edges and tunnel
style from `shadows.ts` using the compiled surfaces), `src/network`, `src/importers`,
`src/sim`, the schema, OSM surroundings (TASK-096), the 3D view (TASK-098).

## Gates

1. **Readable grades (shots).** Add cameras:
   - `V97-n967` (the `n:967` overpass, Munich),
   - `V97-donnersberger` (the Donnersberger bridge over the tracks and Arnulfstraße, Munich),
   - `V97-sindelfingen-a81` (an A81 bridge, with `osm: 'fixtures/osm/sindelfingen-a81.osm'`),
   - and include `T93-n967`, `R6-n638`, `G2-n774`.
   Before and after with `npm run geometry-shots -- <dir> --only ...`. Read every image
   yourself, zoomed in on the deck ends: the shadow meets the abutment, the parapet stops at
   the junction mouths, nothing floats or shows a seam.
2. **Hidden lights.** At `n:967` the west approach's signal heads are visible under the
   bridge (shot), and their colour changes with the signal state.
3. **No change with Shadows off.** A test (unit or e2e) that with `shadows: false` the scene
   adds no shadow, edge, tunnel or ghost objects.
4. **Cost.** Frame time at the Munich overview and at a street zoom with Shadows on is within
   20% of off, and static rebuild time within 20%. Report the four numbers. Owner decision
   (2026-11-07): raise the frame-time allowance from 10% to 20%; retain the 20% rebuild
   allowance. The measured 11.04% street-frame and 14.96% rebuild increases are accepted.
5. `npm run check`, `npm run test:city` and `npm run test:e2e:smoke` green. Run e2e with
   `CITYFLOWS_TEST_PORT=5293`; never use port 4173.

## Checks to run

Use the fast tiers (TASK-090, `AGENTS.md` "Delivering a task"):

- While iterating: `npm test` (unit tier, about 15 s) and `npm run geometry-shots -- <dir> --only <ids>`.
- Before committing: `npm run check`, `npm run test:city` and `npm run test:e2e:smoke`.
- Do not run `npm run test:traffic`, `npm run traffic:quick`, `npm run bench` or the full
  `npm run test:e2e`: this task does not touch `src/sim` or `src/network`, and the lead runs
  the traffic gate, the benchmark hashes and the full e2e suite at merge.

## Acceptance

All gates. Open the app (`npm run dev -- --port 5293`), load Munich, pan along the
Donnersberger bridge and over `n:967` with a running simulation, toggle Shadows, and describe
what you saw (cars passing under the deck, signal ghosts changing colour).

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- the constants as implemented (height per grade, light direction, `k`, opacities, penumbra);
- how the soft edge and the ghost are done, and their cost;
- frame and rebuild times;
- image paths (before and after);
- expectations changed, each with its reason;
- the final lines of `npm run check`.

Commit on `task/097-grade-shadows`; do not push or merge. The lead reviews only commits.
