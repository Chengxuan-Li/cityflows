# TASK-331 — Aircraft: one row of cabin windows and realistic landing gear

Status: planned 2026-11-23 (owner: "aircraft: they are good but windows are rendered wrong (2 lines of windows upon
close up views) and landing gear not properly using realistic models", "without loss of performance"). Proposed owner:
Claude Code subagent (Opus 5.5, high). Branch `task/331-aircraft-windows-gear`, worktree `D:\cityflows-wt\331`, ports
5531 / 5631. Base: main a5b86b5. Independent of TASK-332 to 335; may run in parallel with them.

## Finding (lead, 2026-11-23)

The near and middle levels are TASK-318's prepared models (`fixtures/aircraft/*.glb`, made by
`bench/aircraft-models.ts`). TASK-307's procedural window rows sit in the `procedural` group, which is hidden at
those levels, so they are not the second row. The cause is in the preparation's cabin glass (`windowPanes`):

- A source with any cabin glass of its own keeps it, and no synthetic panes are added (`modelled`).
- Glass vertices on the starboard side within 10 m of the model's middle, by height (LOD0):
  - A20N: two bands, 4.2–4.3 m and 4.5–4.6 m, with almost nothing at 4.4 m (24 against about 650 per 0.1 m).
    A21N is similar (4.6 and 5.0 m, thin at 4.8 m).
  - B738: 8 vertices in all, although its source has `windows`, `windowslh` and `windowsrh` nodes. It probably
    shows almost no cabin windows.
  - B77W (source without glass, so synthetic panes): one continuous band 6.5–7.4 m. The synthetic pane is
    0.38 m wide and 0.54 m tall; a real 777 window is about 0.25 m by 0.38 m, and an A320's is about 0.23 m by
    0.33 m.
- Confirm with a close-up of each type with only the `glass` part shown before changing anything, and say in the
  report what the two rows were.

The landing gear at every level is TASK-307's procedural gear (`landingGear` in `src/render3d/aircraft-mesh.ts`):
cylinders and 12-sided tyres. The Flightradar24 models carry no gear. Its wheel counts are wrong for some types
(B77W draws two axles per main bogie; the real one has three).

## Goal

1. **One row of windows on every airliner, at real size.** The preparation drops the source's cabin glass between the
   doors and places one row of panes per deck on the skin, with the real window size and pitch per class (stated in a
   table in the bench script, with sources). Where the source's skin has openings behind its glass, close them.
   Cockpit glass stays the source's. LOD1 keeps one band per row and side. Double-deckers keep two rows (A388 both
   decks, B748 upper deck from its own start). Regenerate the committed `.glb` files.
2. **Realistic landing gear for each type.** A new gear builder replaces the cylinders at the near level:
   - **Parts:** a main oleo strut with a bright lower piston, torque links, a side brace or drag brace, an axle or
     bogie beam, wheels with tyre and hub, and open gear doors where the type has them. The nose gear has twin wheels
     (single on the C25C) and keeps TASK-314's steering.
   - **Wheel layout per type, from the real aircraft:**
     - Two wheels per main leg: A20N, A21N, B738, BCS3, E175, E190, CRJ9.
     - Four-wheel bogies: A333, A359, B789.
     - Six-wheel bogies: B77W.
     - A388: four-wheel wing gear plus six-wheel body gear. B748: four four-wheel bogies.
     - AT76: main gear in the side fairings. DH8D: main gear in the engine nacelles. C25C: single wheel per leg.
     - Helicopters: A139 wheels, EC45 skids (the model's own where it has them, as now).
   - **Layout table:** keep each type's gear stations, track and wheel size in one table with sources.
   - **Ground contact:** keep TASK-307's gear stations and ground-contact height, so the drawn tyres touch the ground
     exactly where they do now. TASK-314's retraction and steering keep working.
   - **Levels:** the middle level may use a simpler version (struts and wheel blocks); the far level keeps the
     current gear.

## Performance

- Build each type's gear once, merge it per material, and share it between every aircraft of that type: no new
  meshes per aircraft beyond what exists now.
- Budget: at most about 4,000 triangles for a type's near gear, and no more draw calls per aircraft than today.
- 3D render p95 at London City, Zurich and Heathrow within TASK-311's numbers, interleaved base against branch, at
  the default camera and at a close camera on a parked widebody. Report triangles and draw calls
  (`renderer.info`) before and after.

## Scope

`bench/aircraft-models.ts`, `fixtures/aircraft/*.glb` and `models.json` (regenerated), `src/render3d/aircraft-mesh.ts`
(gear builder), `src/render3d/aircraft.ts` and `aircraft-models.ts` (wiring), tests, `docs/architecture.md`.

Out of scope: sim behaviour and aircraft motion, `src/schema`, the 2D aircraft outlines, other vehicles, any new
download (the Flightradar24 sources are already in `D:\cityflows-wt\airport-data\fr24\repo`: read by path, run
nothing from it), `bench/traffic-baseline.json`.

## Gates

- Tests:
  - Every prepared airliner has exactly one cabin pane row per deck and side. Rows are found by clustering the
    `glass` part's heights between the first and last door.
  - The panes have the stated size, within 10%.
  - Each type's gear has the stated wheel count.
  - The lowest tyre point is at ground height, within 2 cm, at the old contact stations.
- Screenshots, day and night: each type at close range from the side (before and after), a widebody's main gear at
  close range, and a take-off with the gear retracting. The lead forwards them to the owner as they land.
- Performance as above.
- Sim state hashes identical; existing cities unchanged; `npm run check`, `test:city`, `test:e2e:light`, the
  real-places and V301 specs.

## Report

Write it as the commit body.
