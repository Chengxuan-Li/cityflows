# TASK-332 — Train model kit, with the tram and the S-Bahn

Status: planned 2026-11-23 (owner: "realistic train models and car models without loss of performance", then approved
the lead's plan: draw-only, keep the sim's lengths, one shared model kit, variants per route). Proposed owner: Claude
Code subagent (Opus 5.5, high). Branch `task/332-train-model-kit`, worktree `D:\cityflows-wt\332`, ports 5532 / 5632.
Base: main a5b86b5. TASK-333 and TASK-334 build on it.

## Finding (lead, 2026-11-23)

`src/render3d/trains.ts` draws every car of every train as two instanced boxes: one body and one roof, two draw calls
in all. Windows and the night cabin glow are painted by a shader in the box's unit coordinates (TASK-163). The sim
knows three kinds (`sbahn`, `mainline`, `tram` in `src/network/trains.ts`) and gives each car a pose (`train.cars`,
25 m cars, 9 m for trams). Bundled rail by track kind and name:

| City | Track kinds (and names) |
|---|---|
| London City Airport | `light_rail` (Docklands Light Railway), `rail` (Elizabeth Line) |
| Heathrow | `rail` (Heathrow Link Line), `subway` (Piccadilly Line) |
| Munich | `rail` (S-Bahn and main lines), `tram` |
| Freiburg | `tram`, `rail` (Höllentalbahn, Rheintalbahn, Breisacher Bahn) |
| Philadelphia | `subway` (Broad Street, Market-Frankford, PATCO), `rail`, `tram` |
| York, Lübeck | `rail` |

## Owner decisions (2026-11-23)

- **Drawing only.** The sim, the timetable and train lengths do not change, and state hashes stay identical. Each
  model is drawn at the sim's car length and pose.
- **Seven variants, chosen per route by one rule.** This task builds the kit, the rule, and the first two variants.
  TASK-333 and TASK-334 add the other five.

  | Route | Variant | Task |
  |---|---|---|
  | `tram` kind | Low-floor articulated tram | 332 |
  | Mostly `light_rail` track | DLR-style light metro | 333 |
  | Mostly `subway` track, left-hand-traffic city | Generic London tube train | 334 |
  | Mostly `subway` track, otherwise | Generic New York subway train | 334 |
  | `sbahn` kind on `rail`, left-hand-traffic city | Elizabeth-line-style EMU (Class 345-like) | 333 |
  | `sbahn` kind on `rail`, otherwise | S-Bahn EMU (ET 423-like) | 332 |
  | `mainline` kind | DB locomotive (BR 101-like), coaches, cab car | 333 |

  - "Mostly" means the track kind covering the most of the route's length.
  - The city's driving side stands in for the country, since projects carry none.
  - Until 333 and 334 land, their routes use the S-Bahn variant.
- **Colours:** operator colours without logos or names.

## Goal

1. **Variant rule.** Write it as a pure function of the route, the rail graph and the driving side, with tests on
   every bundled city.
2. **Model kit.** Build each variant as code, not files: a parametric builder, in the spirit of TASK-307's procedural
   aircraft.
   - **Body:** a cross-section profile (rounded roof, sides curving in, skirt) extruded along the car, plus gangway
     bellows between cars where the variant has them.
   - **Cab ends:** a lofted nose on end cars only, with its direction set by the train's direction of travel.
   - **Underneath and on top:** bogies (frame plus wheel discs) at the variant's centres, pantographs and roof
     equipment where the variant has them.
   - **Detail drawn by a shader in the body's own coordinates, not in geometry:** windows, doors and door seams,
     livery bands, cab windscreen, head and tail lamps, destination display, and the TASK-163 night cabin glow and
     lamps.
   - **Settings:** each variant is a data record (profile, width, height, floor height, nose shape, door count and
     spacing, window pattern, colours, bogie and pantograph layout). Adding a variant must not touch the builder.
3. **Tram:** a low-floor articulated tram in 9 m modules. Bogies under alternate modules, bellows between modules, a
   rounded cab at each end, a pantograph on a middle module.
4. **S-Bahn:** an ET 423-like EMU. Four-car units (cars drawn at the sim's 25 m), coupled into the sim's train length
   with cab ends where units meet. Three double doors per side per car, a pantograph per unit, and red, white and
   grey colours.
5. **Level of detail.** Choose per car by on-screen size, with hysteresis:
   - near: the full model;
   - far: today's box, drawn with the variant's colours and windows by the shader.
6. **Picking and tunnels.** Picking, the tunnel rule (TASK-132), selection colour and the inspector work as now, for
   every variant and level.

## Performance

- Every part is one `InstancedMesh` per variant and level, shared by all trains of that variant. Create a variant's
  meshes only when a route in the city uses it.
- Budget: at most 3 draw calls per variant at the near level plus 1 at the far level, and at most about 1,500
  triangles per car at the near level.
- No allocation per frame (the current loop allocates a `Vector3` per car; remove that).
- 3D render p95 within noise of main, interleaved base against branch:
  - Munich at full demand, Freiburg and London City.
  - Cameras: the default, and a close camera at a busy station.
  - Report draw calls and triangles (`renderer.info`) before and after.

## Scope

`src/render3d/trains.ts` and new files beside it (kit, variants, variant rule), `src/render3d/scene.ts` (wiring and
picking), tests, `docs/architecture.md`.

Out of scope: `src/network/trains.ts` and all sim behaviour, `src/schema`, the 2D train layer, tram stops and stations,
`bench/traffic-baseline.json`, any download or new dependency.

## Gates

- Tests:
  - The variant rule on every bundled city's routes, including Philadelphia's `subway` routes and Heathrow's Link
    Line.
  - Builder output per variant: part list, triangle count within budget, extents equal to the stated length, width
    and height within 2%.
  - Cab ends face the direction of travel.
  - Picking returns the right train at both levels.
- Screenshots, day and night: the tram and S-Bahn close up beside the old box, Munich's S-Bahn trunk line at the
  default camera, Freiburg's trams on Kaiser-Joseph-Straße. The lead forwards them to the owner as they land.
- Performance as above.
- Sim state hashes identical; 2D identity hashes identical; `npm run check`, `test:city`, `test:traffic:light`,
  `test:e2e:light`.

## Report

Write it as the commit body.
