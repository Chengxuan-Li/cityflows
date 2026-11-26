---
name: cityflows-capture-video
description: Plan, dress, tune and render a cinematic video shot of any location in CityFlows (the real app, frame by frame), on the cinematic-captures branch. Use when the owner asks for an intro, trailer, flythrough or "take a shot there" video of a city, airport, station or street; for making the close-up part of a scene look photographic for one shot; or for re-rendering a capture in 16:9, 9:16, WebM or MP4.
---

# CityFlows capture video

A capture is a short video rendered from the real app: the simulation runs, the camera follows
keys, and each frame is drawn at twice the size and scaled down. Everything that only serves
the shot lives on the `cinematic-captures` branch (`bench/intro` today, the capture utility
once it lands); main only provides the app and its debug API. Never merge capture-only code
into main.

The first capture, King George V to London City Airport (2026-11), is the worked example:
`bench/intro`, its shot files `bench/intro/shot.json` and `shot-vertical.json`, and its review
history in that branch's commits.

## 0. Ground rules

- Work on `cinematic-captures` or a branch cut from it. Bring main in with a merge (never the
  other way). The debug API (`window.cityflows`, dev and test builds only) is the only seam
  into the scene; patch the scene from capture code through `scene3D()`, never by editing app
  modules for one shot. A change that would help every user belongs in a main task instead.
- References (Google Earth / photorealistic 3D tiles, Street View, aerial photos the owner
  pastes) are for layout, proportion and colour only. Never sample, trace, embed or ship them:
  every texture and model is procedural or built from map data.
- Do not render the full video until the owner approves stills. Show stills, take notes,
  iterate.
- Downloads (fonts, tools) need the owner's approval each time. Keep caches under
  `node_modules/.cache/cityflows/<capture>/`; `npm ci` wipes them, so check before rendering.
- Never commit machine paths (the tuner entry in `.claude/launch.json`).

## 1. Brief the shot

Agree with the owner, in a few lines, before building:

- **Subject and story:** what the opening frame shows, what the camera reveals, what moves
  (trains departing, an aircraft taking off, traffic), and how it ends (title on the horizon).
- **Formats and length:** 16:9 and/or 9:16, seconds, holds (a static end hold while traffic
  runs on), title and version text.
- **Time and light:** clock time and date, held or easing (the intro held 08:35 then eased to
  dusk), exposure.
- **Must-match details** from the owner's references: which near areas must look real.

## 2. Build the capture's project copy

A capture renders its own project file, built by a script (the intro's
`bench/intro/build-project.ts`), so the shot is reproducible:

1. Start from the bundled city or an import of the area.
2. **Surroundings to the horizon:** an Overpass extract of buildings, building parts, water,
   green, rail and trees, read by the app's own context importer, kept only outside the
   city's own extract. Send a User-Agent, cache the response.
3. **Make the action happen on cue:** compute the sim start from the event times. Rail:
   renumber a service's end node until its departure lands on the wanted second
   (`platformDepartures`). Flights: probe the runway timeline (`bench/intro/probe-flights.ts`)
   and set the shot so rotation lands at the wanted video second. Changing when the event happens
   means rebuilding the project with a new departure time.
4. **Traffic at shot time:** raise demand and move the work-start peak to the shot's clock so
   streets carry moving, not jammed, traffic.
5. **Set dressing as data** (the intro's `bench/intro/dress.ts`), so the app draws it like any
   mapped feature: pitched roofs on untagged houses near the subject, trees planted by rules
   (along rail, in greens, along streets, never on roads, track, water or airfields), glazing
   for a business district's towers, landmark shaping (ExCeL's halls). Keep it deterministic
   (hashed, seeded).

## 3. Author the shot

Use the tuner (`bench/intro/tuner.ts <project> [--shot=<file>]`) on the real app:

- **Camera:** keys of target, zoom, pitch, bearing at video times, played as a Hermite spline,
  holding on the last key. A long lens (FOV 36 over a taller canvas) and a lens shift (the
  video is a window into a canvas taller than the frame) let the horizon sit high at a 10
  degree pitch.
- **Sim timing:** a rate curve (1x while the hero moves off, faster for the pull-back, slower
  for the climb-out) maps video time to sim time.
- **Light:** exposure (the app caps at its maximum; beyond that the capture applies a final
  gain), held or eased sun (`setSunTime3D`), date (Clock light follows the project's
  location since TASK-341), visual settings through `setVisual`.
- **Formats:** each format has its own frame (size, canvas, FOV, title position); a 9:16 shot
  wants a shorter lens and a deeper pull-back so both sides of the reveal fit.
- **Title:** drawn on the frame, not in the scene; fonts with OpenType features need the full
  font file (web subsets strip discretionary ligatures) and SVG text to turn them on.

## 4. Make the near scene photographic (cut-only detail)

Install cut-only layers into the running scene (the intro's `bench/intro/detail.ts` and its
modules). Pick per shot; the categories come from TASK-341's table (1 shipped ... 4 offline):

| Layer | Module in the intro | Use when |
|---|---|---|
| Soft high-res shadows, sky dome with clouds and stars, haze, ambient occlusion, glow at dusk | `atmosphere.ts` | always |
| Water below the land with quay walls; mirror reflections with blurred, rippled waves | `shore.ts`, `detail.ts` | docks, rivers, coasts |
| Detailed trees (branches, leaf sprays, species colour variation); low vegetation (hedges, scrub, long grass) along rail, verges, car park edges | `foliage.ts`, `undergrowth.ts`, `low-plants.ts` | greenery near the camera |
| Procedural surfaces: asphalt, paving, concrete joints, roofs (clay, slate, metal), walls, dark reflective daytime glass, tower facades; noise-driven variation per tile and slab | `surfaces.ts`, `weathering.ts`, `ground-detail.ts` | always for the near field |
| Track: ballast, sleepers, rail heads, third rail with covers where electrified, cable troughs; continuous curves; turnouts with switch and frog | `tracks.ts`, `track-curves.ts` | rail in the near field |
| Fences built as connected runs along the corridor or boundary | `fences.ts`, `props.ts` | rail, airports, yards |
| Airfield: apron slabs, runway grooves and rubber, shoulders, rough greens | `airfield.ts` | airports |
| Props and fill: full car parks in real car colours, synthetic traffic on roads the trips leave empty, yards and bays | `props.ts`, `dockyard.ts` | when a near area reads as empty |

Rules that kept the intro clean:

- Fade every fine detail by its pixel footprint (`fwidth`) so nothing shimmers; render at 2x
  and downscale.
- Drive variation from noise (domain-warped, rotated octaves) and per-element seeds, never a
  visibly repeating tile.
- Build geometry from the network topology (rail graph, fence runs), joined at nodes, so
  curves and junctions have no gaps or kinks.
- Patch app materials through `onBeforeCompile` with their own program cache key; keep the
  app's own patches working.
- Ask what the owner wants removed as readily as what to add (the intro removed yard markings,
  clutter and an apron that did not read as real).

## 5. Review loop

1. Render mock stills (`render.ts --mock=<t>`, no simulation) at the story beats, for example
   0, 3, 5.5, 9 and 13 s, and simulated stills (`--still=<t,...>`) where the action matters.
2. Compare with the owner's references; crop close-ups of the areas they care about.
3. Send stills, take the owner's mark-ups, iterate. Heavy visual rounds can go to a Codex
   session (gpt-6.2-astra, high effort, full access) resumed round after round, with a written
   brief per round and its own still checks; review its stills before showing the owner.
4. Note the render cost per round (seconds per warmed frame).

## 6. Render and deliver

1. Full render per format (`render.ts <project> <out> [--shot=<file>]`): every frame as JPEG,
   then VP9 WebM.
2. MP4 from the JPEG frames (not from the WebM): libx264 two-pass about 16 Mbit/s, BT.709
   limited range, `+faststart`; under 30 MB so it reaches the owner's phone. Playwright's ffmpeg
   has no H.264; use an approved ffmpeg in the scratchpad (imageio-ffmpeg).
3. Spot-check a frame sheet at the beats, then send the files (WebM over 30 MiB reaches the
   desktop app only).

## Pitfalls seen

- The app's lighting and quality settings moved to `cityflows.visual` (TASK-341); the debug
  hook is `setVisual`. Shadows are a visual setting, not a layer.
- The camera's far plane is dynamic: scale sky domes to it.
- The app's night "sun" is moonlight above the horizon: use its artificial-light factor for
  night effects.
- An aircraft's departure time is in the flight schedule, not the camera: re-time the sim
  start and rebuild the project.
- Background renders and Codex runs take minutes to hours: run them in the background and keep
  one render per port at a time.
