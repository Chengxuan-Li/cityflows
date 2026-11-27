---
name: cityflows-capture-video
description: Plan, dress, tune and render a cinematic video shot of any location in CityFlows (the real app, frame by frame), on the cinematic-captures branch. Use when the owner asks for an intro, trailer, flythrough or "take a shot there" video of a city, airport, station or street; for making the close-up part of a scene look photographic for one shot; or for re-rendering a capture in 16:9, 9:16, WebM or MP4.
---

# CityFlows capture video

A capture is a short video rendered from the real app: the simulation runs, the camera follows
keys, and each frame is drawn at twice the size and scaled down. Everything that only serves
the shot lives on the `cinematic-captures` branch under `capture/`; main only provides the app
and its debug API. Never merge capture-only code into main.

```
capture/core       the shot file (shot.ts), the page-side stage (stage.ts), the title, the render
                   CLI (render.ts), WebM/MP4 encoding (encode.ts), capture:new and capture:build,
                   the dev server's panel endpoints (dev-server.ts)
capture/layers     the scene-layer library: one module per layer with its `params` defaults;
                   index.ts installs the shot's layers in order, registry.ts names them
capture/locations  one folder per location: build-project.ts, its dressing (dress.ts), its own
                   scene props (site.ts), and its shot files
capture/panel      the in-app Capture panel
```

The first capture, King George V to London City Airport (2026-11), is the worked example:
`capture/locations/london-city-airport` (its `shot.json` holds both formats) and its review
history in that branch's commits (it began as `bench/intro`).

## 0. Ground rules

- Work on `cinematic-captures` or a branch cut from it. Bring main in with a merge (never the
  other way). The debug API (`window.cityflows`, dev and test builds only) is the only seam
  into the scene; patch the scene from capture code through `scene3D()`, never by editing app
  modules for one shot. A change that would help every user belongs in a main task instead.
- Generic layers never name a place. Anything place-specific is a layer parameter in the shot
  file or code in the location's `site.ts` (ids, coordinates, names, props).
- References (Google Earth / photorealistic 3D tiles, Street View, aerial photos the owner
  pastes) are for layout, proportion and colour only. Never sample, trace, embed or ship them:
  every texture and model is procedural or built from map data.
- Do not render the full video until the owner approves stills. Show stills, take notes,
  iterate.
- Downloads (fonts, tools) need the owner's approval each time. Caches live under
  `node_modules/.cache/cityflows/capture/` (`<location>/project.cityflows.json`, `fonts/`);
  `npm ci` wipes them, so check before rendering.
- Never commit machine paths: project files and fonts are referenced repository-relative, and
  `--project=<file>` points a render at a file elsewhere.

## 1. Brief the shot

Agree with the owner, in a few lines, before building:

- **Subject and story:** what the opening frame shows, what the camera reveals, what moves
  (trains departing, an aircraft taking off, traffic), and how it ends (title on the horizon).
- **Formats and length:** 16:9 and/or 9:16, seconds, holds (a static end hold while traffic
  runs on), title and version text.
- **Time and light:** clock time and date, held or easing (the intro held 08:35 then eased to
  dusk), exposure.
- **Must-match details** from the owner's references: which near areas must look real.

## 2. Start the location and build its project copy

`npm run capture:new -- <name> [--city=<bundled id>]` creates `capture/locations/<name>/` with a
`build-project.ts` and a `shot.json` on the bundled city. A shot can render a bundled city as it
is (`"project": "bundled:freiburg"`); a dressed shot renders its own project file, built by the
location's script (`npm run capture:build -- <name>`), so the shot is reproducible:

1. Start from the bundled city or an import of the area.
2. **Surroundings to the horizon:** an Overpass extract of buildings, building parts, water,
   green, rail and trees, read by the app's own context importer, kept only outside the
   city's own extract. Send a User-Agent, cache the response.
3. **Make the action happen on cue:** the shot's `sim.cue` fixes the clock at a video time; the
   build script reads the shot and times events from it. Rail: renumber a service's end node
   until its departure lands on the wanted second (`platformDepartures`). Flights: probe the
   runway timeline (`capture/locations/london-city-airport/probe-flights.ts`) and set the cue
   to the rotation. Changing when an event happens means rebuilding the project.
4. **Traffic at shot time:** raise demand and move the work-start peak to the shot's clock so
   streets carry moving, not jammed, traffic.
5. **Set dressing as data** (the London `dress.ts`), so the app draws it like any mapped
   feature: pitched roofs on untagged houses near the subject, trees planted by rules (along
   rail, in greens, along streets, never on roads, track, water or airfields), glazing for a
   business district's towers, landmark shaping (ExCeL's halls). Keep it deterministic.

## 3. Author the shot in the Capture panel

Run the app (`npm run dev`) and open `?capture=capture/locations/<name>/shot.json`, or press
Capture in the toolbar and pick a shot. The panel takes the inspector's place; the 3D canvas
takes the format's canvas size, scaled to fit, with the video's window and the title over it.

- **Timeline:** scrub, play, step a frame; the traffic follows (forward only; Rewind traffic
  restarts the run and steps back). Duration and frame rate.
- **Camera keys:** keys of target, zoom, pitch, bearing at video times, played as a Hermite
  spline, holding on the last key. Orbit the view and press Key from view, or Set on a row.
  A long lens (FOV 36 over a taller canvas) and the window (`formats.<f>.window`: the frame's
  window over the canvas, 0 top, 1 bottom, easing between two times) let the horizon sit high
  at a 10 degree pitch. A format can carry its own keys (Own camera keys).
- **Sim timing:** a start clock or a cue (the clock at a video time) and rate keys (sim seconds
  per video second, smoothstep between keys): 1x while the hero moves off, faster for the
  pull-back, slower for the climb-out.
- **Light:** exposure (past the atmosphere layer's `gainAbove` the rest is a final gain), the
  date (Clock light follows the project's location since TASK-341), the sun held, eased or
  following the sim, and any of the app's visual settings (`light.visual`, as `setVisual`
  takes them). The panel applies the shot's light over the defaults and restores the
  viewer's settings when it closes.
- **Format:** 16:9 and 9:16 each have their frame (size, canvas height, FOV, title centre); a
  9:16 shot wants a shorter lens and a deeper pull-back.
- **Title:** drawn on the frame, not in the scene. A subtitle with OpenType features needs the
  full font file (`title.subtitleFont`; web subsets strip discretionary ligatures); without it
  the subtitle is plain canvas text.
- **Layers:** each on or off with its parameters (below); Show layers compares with the plain
  app.
- **Grab frame** saves the current frame as PNG; **Save** writes the shot file through the dev
  server. **Render** lists the commands for the current shot.

## 4. Make the near scene photographic (layers)

The shot's `layers` object turns layers on (`"surfaces": {}`) and sets their parameters; the
defaults are each module's `params`. Areas default to a box around the shot's `focus`.

| Layer | Module | Parameters | Use when |
|---|---|---|---|
| `atmosphere`: soft high-res shadows, sky dome with clouds and stars, haze, ambient occlusion, glow at dusk | `atmosphere.ts` | shadows, shadowMap, sky, occlusion, gainAbove | always |
| `water`: mirror reflections, blurred rippled waves; `shore`: water below the land, quay walls | `water.ts`, `shore.ts` | resolution; level | docks, rivers, coasts |
| `trees`: branches, leaf sprays, species colours; `plants`: hedges, scrub, long grass along fences, greens and the site's runs | `foliage.ts`; `undergrowth.ts`, `low-plants.ts` | widen; area, fenceLines | greenery near the camera |
| `surfaces`: asphalt, paving, concrete joints, roofs, walls, daytime glass, towers; `windows` sharp to a few pixels; `curtainWalls` on low glass buildings | `surfaces.ts`, `weathering.ts`, `ground-detail.ts`, `windows.ts`, `curtain-walls.ts` | centre, shadeSize, pavingAxis, towerHeight | always for the near field |
| `tracks`: ballast, sleepers, rail heads, covered third rail, cable troughs, continuous curves, turnouts | `tracks.ts`, `track-curves.ts` | kinds, names, area, formation, crossovers, sideY, thirdRail | rail in the near field |
| `fences`: connected palisade runs along at-grade rail, chain-link round the airport | `fences.ts` | rail, airport | rail, airports, yards |
| `airfield`: apron slabs, runway grooves and rubber, shoulders, rough greens | `airfield.ts` | | airports |
| `parking`: full car parks in real colours; `traffic`: cars looping roads the trips leave empty | `parking.ts`, `traffic.ts` | occupancy; routes, perRoute | when a near area reads as empty |

A location's `site.ts` (`Site` in `capture/layers/index.ts`) adds what only it has: props
installed after the shore (King George V's canopy and roundels, ExCeL's masts, the dockyard)
and hooks into the generic layers (ground the trees and plants keep off, planting runs, lamp
pools, a paved frontage).

Rules that kept the intro clean:

- Fade every fine detail by its pixel footprint (`fwidth`) so nothing shimmers; render at 2x
  and downscale.
- Drive variation from noise (domain-warped, rotated octaves) and per-element seeds, never a
  visibly repeating tile.
- Build geometry from the network topology (rail graph, fence runs), joined at nodes, so
  curves and junctions have no gaps or kinks.
- Patch app materials through `onBeforeCompile` with their own program cache key (include any
  parameter that changes the shader source); keep the app's own patches working.
- Ask what the owner wants removed as readily as what to add (the intro removed yard markings,
  clutter and an apron that did not read as real).

## 5. Review loop

1. Render mock stills (no simulation, one app load for all times) at the story beats, and
   simulated stills where the action matters:
   `npm run capture -- <shot.json> --mock=0,3,5.5,9,13 --format=landscape`,
   `npm run capture -- <shot.json> --still=7.5`.
2. Compare with the owner's references; crop close-ups of the areas they care about.
3. Send stills, take the owner's mark-ups, iterate. Heavy visual rounds can go to a Codex
   session (gpt-6.2-astra, high effort, full access) resumed round after round, with a written
   brief per round and its own still checks; review its stills before showing the owner.
4. Note the render cost per round (seconds per warmed frame).

## 6. Render and deliver

1. `npm run capture -- <shot.json> --format=all --mp4` renders every frame of each format as
   JPEG, then a VP9 WebM (Playwright's ffmpeg) and an MP4 from the JPEG frames: libx264
   two-pass at up to 16 Mbit/s, BT.709 limited range, `+faststart`, under 30 MB so it reaches
   the owner's phone. Output: `node_modules/.cache/cityflows/capture/<location>/<shot>/` (or
   `--out=<dir>`).
2. Playwright's ffmpeg has no H.264: `--mp4` needs an ffmpeg with libx264 on PATH or in
   `CITYFLOWS_FFMPEG` (an approved one, such as imageio-ffmpeg's binary in a scratchpad).
3. Spot-check a frame sheet at the beats, then send the files (WebM over 30 MiB reaches the
   desktop app only).

## Pitfalls seen

- The app's lighting and quality settings live in `cityflows.visual` (TASK-341); the debug
  hook is `setVisual`. Shadows are a visual setting; the atmosphere layer only sharpens them.
- A scene rebuild (terrain, palette) drops the layers' patches; the stage reinstalls them.
- The camera's zoom is relative to the canvas's CSS height: frame only on a canvas of the
  format's size (the CLI sizes the page, the panel scales the canvas).
- The camera's far plane is dynamic: scale sky domes to it.
- The app's night "sun" is moonlight above the horizon: use its artificial-light factor for
  night effects.
- An aircraft's departure time is in the flight schedule, not the camera: re-time the sim cue
  and rebuild the project.
- Aircraft cabin-window textures arrive a moment after the scene: the first still in a fresh
  page can show plain cheatlines where later ones show windows. Compare stills taken alike.
- Background renders and Codex runs take minutes to hours: run them in the background and keep
  one render per port at a time (`--port=<n>` for a second).
