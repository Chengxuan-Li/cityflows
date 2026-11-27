# TASK-373 — Debug views: overlays and shading for developers

Status: started 2026-11-27 (Claude). First written as TASK-362 on `task/362-debug-views` (2026-11-26); renumbered
TASK-373 when main took TASK-362 for the two-controls signal fix. Work stays on `task/362-debug-views`; the lead
reviews. A first Codex run was stopped by the owner; its unreviewed partial work is on `wip/362-debug-views-codex`.

## Why

Network, sim and rendering problems are diagnosed today from logs, hashes and ad hoc scripts. The owner wants
built-in debug views: wireframe, the street, rail and airside graphs with their nodes, and the sim's reasoning (gaps,
waits, reservations), drawn on top of the rendered view or on their own. Some layers already cover parts of this
(Road speeds, Queues, Signals, Entrances and exits, Disconnected roads); they stay as they are.

## Goal

A **Debug** section in the left sidebar, shown only when developer tools are on: a "Developer tools" switch in the
Visual quality panel's Render section (a per-viewer preference, stored with the visual settings), or `?debug` in the
URL. Off by default; nothing changes for other users.

The section (owner-approved layout, 2026-11-26):

```
[x] Rendered view      Shading: [Normal ▾]
                       Normal · Unlit colour · Light only · Contact shadows only ·
                       Heights and grades · Face direction · Overdraw
Networks
[ ] Road graph
[ ] Lanes and movements
[ ] Rail graph
[ ] Airside graph
[ ] Walk network
[ ] Places and access
Geometry
[ ] Wireframe
[ ] Detail ranges
Sim state
[ ] Vehicles
[ ] Signals
[ ] Aircraft
[ ] Gridlock
[ ] Stats readout
```

Rules:

- Every overlay is an independent checkbox; any combination works. There are no group toggles; the three headings
  are labels.
- **Rendered view on:** overlays draw over the scene as shaded by the Shading menu. **Off:** the scene is not drawn;
  the checked overlays draw on the plain canvas background (so Wireframe alone is a pure wireframe). The Shading menu
  is disabled while Rendered view is off.
- Shading options replace the scene's colours, so they are one menu, not checkboxes.
- Views that exist only in 3D (Wireframe, Detail ranges; Unlit colour, Light only, Contact shadows only, Face
  direction, Overdraw) are hidden in 2D, not disabled. Heights and grades works in both.
- "Contact shadows only" appears only once ambient occlusion exists in the app (a later TASK-341 phase); until then
  leave it out of the menu.
- Debug settings are a per-viewer view preference (local storage), never in the project file, and never change the
  simulation, its hashes or the default rendering.
- Overlays are pickable where it helps: hovering a node, edge, lane, track, runway or stand shows its id in the
  existing tooltip style; clicking selects it as today.

### The views

| View | Shows | 2D | 3D |
|---|---|---|---|
| Road graph | Compiled road nodes as dots coloured by kind (junction, signal, roundabout, dead end, gateway) and edges as centrelines with direction arrows | yes | yes |
| Lanes and movements | Lane centrelines with direction, movements (connectors) through junctions, stop lines, conflict points between movements | yes | yes |
| Rail graph | Track centrelines, rail nodes, switches and turnouts, platforms, signal block sections | yes | yes |
| Airside graph | Runway centrelines, thresholds and ends, taxiway nodes and edges, runway holds, stands; the glide path in 3D | yes | yes |
| Walk network | Walk links and nodes, crossings, building and stop entrances | yes | yes |
| Places and access | Place outlines, connectors (entrances and exits), parking spaces and their access paths | yes | yes |
| Wireframe | Triangle edges of every drawn mesh | no | yes |
| Detail ranges | Shadow-map coverage (TASK-341's shading range), tree detail distance, the car-model detail radius, mesh bounding boxes | no | yes |
| Vehicles | Id labels, colour by sim state, route ahead, leader and gap lines, lane-change intent | yes | yes |
| Signals | Current phase per approach; for the selected junction, its conflict matrix | yes | yes |
| Aircraft | Separation circles, reserved taxi segments, the wait-for links between aircraft (as in TASK-339) | yes | yes |
| Gridlock | The wait-for chain between stuck vehicles or aircraft, highlighted when it closes into a ring | yes | yes |
| Stats readout | Frame time, fps, draw calls, triangles, geometries and textures in memory; a small corner readout | yes | yes |

| Shading | Shows | 2D | 3D |
|---|---|---|---|
| Normal | The scene as rendered | yes | yes |
| Unlit colour | Surface colour without lighting or shadows | no | yes |
| Light only | White materials with lighting and shadows | no | yes |
| Heights and grades | Elevation as a colour ramp; grade per road; bridge decks and tunnels distinct | yes | yes |
| Face direction | World-space normals as colours | no | yes |
| Overdraw | How many times each pixel is drawn, as a heat ramp | no | yes |

Sim-state views read what the snapshot and `inspect` already provide. Where a view needs data the engine does not
expose yet (gap and leader per vehicle, aircraft wait-for links, reservations), add it to the snapshot only when the
debug view asks for it (a flag on the snapshot request), so normal runs carry no extra cost and hashes do not change.

## In scope

- New UI: the Debug section component under `src/ui/`, the Developer tools switch in the Visual quality panel,
  tokens in `src/ui/app.css` if needed (`contrast.test.ts` must pass).
- `src/render/` (2D overlays, shared overlay geometry), `src/render3d/` (3D overlays, shading overrides, wireframe,
  detail ranges, stats), `src/render/types.ts` / settings for the debug preference.
- `src/sim/` and the engine snapshot only for the opt-in debug data described above.
- Tests: debug settings parsing; overlay geometry for one city (counts of nodes, edges, lanes, tracks, runways
  match the compiled city); an e2e spec under `tests/e2e/` that turns on developer tools, toggles Rendered view off
  with Road graph and Wireframe on, checks the canvas reports them (data attributes, as other 3D specs do), switches
  Shading to Unlit and back, and checks the default rendering is unchanged with developer tools off.

## Out of scope

- `src/schema`, `docs/architecture.md`, the project file.
- Changing the existing layers in Layers (Road speeds, Queues, Signals, Entrances and exits, Disconnected roads).
- Any change to simulation behaviour or to hashes with developer tools off.
- The capture tooling on `cinematic-captures`.

## Gates

- With developer tools off, every existing city's simulation and render hashes are unchanged, and the light e2e tier
  passes unchanged.
- With all overlays on at Munich in 3D, the frame stays interactive; report frame time with and without overlays.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`, and the new e2e spec.

## Report

Write it as the final commit body and the PR description: what works, each view's status, frame times, what is
unsupported, the final lines of `npm run check`. Commit on `task/362-debug-views`, push, and open a PR against main.
Do not merge: the lead reviews and merges.
