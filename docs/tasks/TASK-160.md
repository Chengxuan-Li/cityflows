# TASK-160 — macOS-style interface and map (Sonoma / Ventura flat, Arimo)

Owner: Claude Code subagent from the lead's session (Opus 5.5, high). Branch `task/160-mac-ui`,
worktree `D:\cityflows-wt\160`, ports 5360 (production 5460). It runs in phases. At the end of each
phase the agent commits and reports with screenshots, the lead sends them to the owner, and the
owner's feedback starts the next phase. If no feedback arrives, the lead continues.

## Owner decisions (2026-11-13)

- **Look:** clean Apple style in the Sonoma / Ventura flat manner. Not Liquid Glass: no
  translucency, blur or glassy vibrancy. Use solid surfaces, light gray window chrome, hairline
  separators, rounded rectangles, and accent-filled selection.
- **Font:** Arimo everywhere (UI, map labels, 3D labels). Bundle it locally so the deployed site,
  Windows and CI's Linux runner all render the same metrics. Arimo is SIL OFL 1.1 (the current
  Google Fonts release; owner accepted 2026-11-13); record it in `NOTICE`. Ship the files with the build (an npm `@fontsource/arimo` dependency or vendored woff2
  in `public/`), not from a CDN.
- **Accent:** macOS system blue, `#007AFF`, for selection, focus rings, the primary button and
  toggles.
- **Layout:** a docked window, as in a Mac app:
  - a unified toolbar on top: app name, file actions, the tool segmented control, run controls,
    speed;
  - a left sidebar: tools' options, Layers, Demand, Chart, Validation, Compare;
  - a right inspector for the selection;
  - a status bar: clock, trip counts, and the "synthetic traffic, not observed traffic" notice;
  - the map filling the content area.

  Sidebars collapse, with a toolbar toggle each. At narrow widths (under 900 px) they become
  overlays.
- **Scope:** both the interface and the map. This replaces the Mini Motorways direction in
  `AGENTS.md` "Design direction"; rewrite that section in this task, keeping its principles that
  still hold (direct manipulation, every control visible in effect, plain words, no AI or
  self-referential copy).

## Controls

Build the Mac control set once, in `app.css` tokens and small components, and reuse it everywhere:
- push button, primary button, and a small toolbar button;
- segmented control;
- pop-up and pull-down menus (styled `select` or a small menu component);
- checkbox and toggle switch;
- slider, text and number fields, and a stepper where it fits;
- disclosure groups for sidebar sections;
- popovers with an arrow for contextual edits;
- sheets, sliding down from the toolbar, for import, export and onboarding;
- tooltips.

Sizes and type follow macOS: 13 px body, 11 px small, 6 px control radius, 10 px window radius, and
a 1 px hairline at the platform's separator gray. Use the shadows Sonoma uses for popovers and
sheets only.

## Map (phase 3)

Move the map to a neutral, Apple-Maps-like light palette:
- a pale warm-gray canvas;
- white road surfaces with soft gray casings, and hierarchy shown by width and a restrained tint
  for major roads;
- muted building fills;
- places in quiet system tints;
- vehicles in the system colour set (blue, green, orange, red, purple, teal), tinted by
  destination as now;
- markings in white and system yellow;
- selection in system blue.

Apply it in 2D (`src/render/style.ts` and the layers) and 3D (`src/render3d`). Keep every map
behaviour, layer toggle and test ID. The marking themes (German, UK and others) keep their
regulatory colours.

## Phases and checkpoints

1. **Foundations and shell.**
   - Arimo, the tokens and the control set.
   - The docked window: toolbar, both sidebars as empty or partly filled shells, status bar, map
     in the content area.
   - Today's panels may still float inside it.

   Checkpoint 1: shots of the whole window at 1440×900 and 1024×768, and of every control in a
   control gallery. Place the gallery on a dev page if one exists (see `src/ui` dev pages);
   otherwise a test-only page.
2. **Panels moved in.**
   - Tools, Layers, Demand, Chart, Validation, Compare and Export go into the sidebar.
   - The inspectors (road, node, place, vehicle, person, rail) go into the right inspector.
   - Import, export and onboarding become sheets, and contextual edits become popovers.
   - No floating panel is left over the map, except the map's own transient overlays.

   Checkpoint 2: shots of each sidebar section, each inspector kind and each sheet.
3. **The map palette**, in 2D and 3D. Checkpoint 3: matched before and after shots of Munich
   (Donnersbergerbrücke, a lot, a crossing, trams), Sindelfingen and the grid, at three zoom levels,
   in 2D and 3D.
4. **Finish.**
   - Narrow widths and keyboard focus.
   - The `AGENTS.md` design section rewritten.
   - Browser tests updated where layout moved, by role and test ID, never by pixel position.
   - CI's Linux layout checked: with Arimo bundled, the old Linux font gap should disappear.

   Final shots.

## In scope

- `src/ui/**`, `index.html`, `public/` (fonts).
- `src/render/style.ts` and colour use in `src/render/**` and `src/render3d/**`.
- `package.json` (the font dependency, if chosen), `NOTICE`.
- `AGENTS.md` "Design direction".
- `tests/e2e/**` and any UI unit tests whose selectors or layout assumptions move.

## Out of scope

- Simulation, network, importer and demand behaviour.
- Pinned simulation and route hashes, which must not move.
- Render geometry. Colours and styles move, but geometry stays. Pins over geometry, such as
  marking geometry hashes, must not move; a colour-only change that moves a pin is explained and
  re-pinned.
- Parallel tasks' files (`src/sim/**`, `src/network/**`, `src/demand/**`).

## Gates (every phase)

- `npm run check`.
- `test:e2e:light` on port 5360 at phases 2 and 4. The full `test:e2e` at phase 4.
- The T62 and T64 frame gates at phase 3 and 4: the map palette may not cost frame time. Use one
  worker on an idle machine; record failed runs too.
- Shots for each checkpoint in `D:\cityflows-wt\160-evidence\phase-<n>\`, plus a short index of what
  each shows.
- Accessibility: contrast at least WCAG AA for text and controls, visible focus, and every control
  reachable by keyboard.

## Report (each phase)

Write it as the phase commit's body: what changed, the shots with paths, test results, any moved
pins and why, open questions for the owner, and the plan for the next phase.
