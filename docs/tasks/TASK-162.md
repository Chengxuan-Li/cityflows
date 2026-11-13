# TASK-162 — Mac-style map: plain canvas, quiet places, system-colour traffic (TASK-160 phase 3)

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch `task/162-mac-map`,
worktree `D:\cityflows-wt\162`, ports 5362 (production 5462). This is TASK-160's phase 3, split out
so it runs in parallel with TASK-160's phase 2 (the interface panels in `src/ui`). The branch starts
from TASK-160's phase-1 commit `585debd` (Arimo, design tokens) merged with main.

## Owner decisions (2026-11-13)

Keep everything in TASK-160's decisions: Sonoma/Ventura flat, not Liquid Glass; Arimo; macOS blue.
For the map:
- **Background: a plain canvas.** The OpenStreetMap raster tiles are off by default and stay
  available as a Layers toggle. Draw our own pale warm-gray canvas, buildings, water, green and
  land use from the imported city data (`City.context`, TASK-096), Apple-Maps light style.
- **Places: quiet tints.** One colour per place type, as soft low-saturation system tints with a
  thin, slightly darker edge, so roads and vehicles stand out.
- **Vehicles: destination tint** in the macOS system colours: blue, green, orange, red, purple,
  teal, indigo, pink, yellow and brown. Pick enough for the place palette, distinguishable on the
  canvas. Buses, trams and trains keep a distinct look.

## The palette, as a starting point to tune by eye

- **Canvas:** about `#F2F1EE`.
- **Buildings:** a light warm gray fill with a hairline darker edge.
- **Water:** soft system blue.
- **Parks and wood:** soft system green.
- **Roads:** white surfaces with a soft gray casing. Hierarchy shows by width and a restrained
  tint: motorways and trunks in a pale system yellow or orange, primaries white with a stronger
  casing.
- **Junction surfaces:** match their roads.
- **Lane markings:** white. Centre lines follow the marking theme's regulatory colours (German,
  UK and others), unchanged.
- **Crossings:** white.
- **Rail:** neutral grays, with trams in the tram-track look of TASK-135, adapted.
- **Selection:** system blue `#007AFF`, as a ring or outline.
- **Signal heads:** keep red, amber and green, in system shades.

Apply it in both 2D (`src/render/style.ts` and the layers that hard-code colours) and 3D
(`src/render3d`), consistently. Map labels use Arimo.

## In scope

- `src/render/**` and `src/render3d/**`: colours, styles and the background layer default.
- The tiles default in whatever store or scene setting holds it.
- Tests over colours and styles.

Leave `src/ui/**` to TASK-160 phase 2. The Layers panel moves there, so only change the default
value of the tiles setting, not the panel. List any `src/ui` line you must touch.

## Out of scope

- Geometry and render positions. Pins over geometry must not move; a colour-only change that
  moves a pin is explained and re-pinned.
- Simulation, network, importer and demand.
- `src/ui/**` beyond the tiles default.

## Gates

1. Matched before and after shots, in 2D and 3D, at three zoom levels each:
   - Munich: Donnersbergerbrücke, a lot, a level crossing, the trams, Landsberger;
   - Sindelfingen;
   - the grid.

   Save them to `D:\cityflows-wt\162-evidence\` with an index.md. Look at every shot yourself and
   tune until roads, places and vehicles read clearly against the canvas.
2. Contrast: lane markings and vehicles are clearly visible on their surfaces, and map labels meet
   WCAG AA against the canvas.
3. The T62 and T64 frame gates: one worker, an idle machine, `CI` unset. The palette may not cost
   frame time. Record failed runs.
4. `npm run check`, `test:city`, and `test:e2e:light` on port 5362. T41, V106, V107, V108 and V117
   render tests pass, with colour pins re-pinned and explained.
5. A checkpoint report with shots for the owner. The lead relays the owner's feedback for a tuning
   round.

## Report

Write it as the commit body: the palette (token table), the shots, test results, pins moved and
why, frame times, and open questions.
