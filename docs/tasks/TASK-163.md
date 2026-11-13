# TASK-163 — Scene lighting settings and an evening scene with artificial lighting

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch `task/163-lighting`,
worktree `D:\cityflows-wt\163`, ports 5363 (production 5463). It starts on top of TASK-162's
branch once TASK-162 reaches its checkpoint, because both touch `src/render3d` materials and
lights.

## Owner decisions (2026-11-13)

- Road surfaces, lane markings, rail and street furniture keep realistic colours. TASK-162 rolls
  its road and marking palette back to them; this task must not restyle them.
- Add **scene lighting settings**.
- Add an **evening scene with artificial lighting**. This lifts the deferral of night lighting
  from TASK-107 (decision 8 of 2026-11-07).

## Goal

**Lighting settings**, in the Layers or a View section of the sidebar. Reuse TASK-160's control set
and place it where TASK-160's layout puts view options; the lead reconciles at merge. Settings:
- **Time of day:** Day, Evening and Night presets, plus "Follow simulation clock", which moves the
  sun and dusk with the sim time.
- **Sun direction or azimuth** (optional) and **shadow** on or off. Shadows already exist as a
  layer, so reuse that toggle.
- **Brightness / exposure** with a sensible range.

Every setting is a view preference: it doesn't change the simulation or the project hashes. Store
it per viewer, in localStorage wrapped in try/catch, or in the existing view store if there is
one.

**Evening scene, in 3D:**
- a low warm sun and dim blue ambient, with the sky or background darkening;
- **street lamps** lit: TASK-107's OSM and generated lamps, with a warm glow on the ground beneath
  each, as cheap decals or sprites rather than hundreds of real lights;
- **building windows** lit in a deterministic pattern seeded by building id, with a sensible
  share lit;
- **vehicles** with headlights and tail-lights as small emissive marks, and an optional faint
  beam on the road ahead if cheap;
- **signals and level-crossing lights** emissive, so they read in the dark;
- **station platforms and tram stops** lit.

**Evening in 2D:**
- a darkened map tint;
- lamp glows as soft radial marks;
- vehicle lights as small marks;
- lit signal heads;
- markings still legible.

## Must stay true

- Realistic road, marking, rail and furniture colours at Day. At Evening they are lit or darkened
  physically, not recoloured.
- Frame time: Day may not regress. Evening and Night may cost at most 10% over Day on the T62 and
  T64 workloads, measured with one worker and `CI` unset. Use instanced or merged geometry for
  lamps, windows and lights.
- Determinism and simulation hashes are untouched. Render-geometry pins don't move unless a new
  optional layer is explained.
- The Day scene matches TASK-162's look.

## In scope

- `src/render3d/**`: scene lights, materials, emissive layers and lamp, window and vehicle-light
  meshes.
- `src/render/**`: the 2D evening tint and glow layers.
- The lighting settings UI: a small, self-contained component in `src/ui` plus its hook-up.
- Tests.
- `docs/architecture.md`, the render section, describing the view-only lighting state.

## Out of scope

- Simulation, network, importer and demand.
- Road, marking, rail and furniture colours at Day.
- TASK-160's layout work, beyond adding the settings component.

## Gates

1. Shots at Donnersbergerbrücke (wide and close), Landsberger, a level crossing, the trams and a
   station:
   - 3D at Day, Evening and Night, plus "Follow simulation clock" at 07:00 and 21:00;
   - 2D at Day and Evening.

   Save numbered previews after each visible step to `D:\cityflows-wt\163-evidence\previews\`, with
   one line each in `log.md`. The owner wants frequent previews.
2. Frame gates: T62 and T64 at Day (no regression), and at Evening and Night within 10% of Day.
3. Tests: settings persistence and fallback, deterministic window pattern by building id, and no
   simulation or project hash change.
4. `npm run check`, `test:city`, and `test:e2e:light` on port 5363.

## Report

Write it as the commit body:
- the lighting model and presets;
- what lights up and how, with instance counts;
- frame times;
- shots;
- hashes and pins moved and why;
- files touched;
- open questions.
