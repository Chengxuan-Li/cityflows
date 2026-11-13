# TASK-166 — Dark appearance for the Mac UI

Owner: Claude Code subagent (Opus 5.5, high). Branch `task/166-dark-appearance`, worktree
`D:\cityflows-wt\166`, ports 5366 / 5466. It starts once TASK-160/162/163 are on main.

## Goal

A dark appearance for the docked Mac window, in the Sonoma flat manner: dark solid surfaces, no
translucency.
- **Setting:** System (follows `prefers-color-scheme`), Light, or Dark. Stored per viewer in
  localStorage inside try/catch.
- **Night lighting:** when TASK-163's lighting preset is Evening or Night (or the clock-following
  preset reaches dusk), a "Match lighting" option switches the UI to dark. It is off by default.
- **Chrome:** all chrome is defined as tokens and redefined for dark, including controls, sheets,
  popovers, the sidebar, the inspector, the status bar and charts. The accent stays system blue in
  its dark variant.
- **Contrast:** WCAG AA for text and controls in both appearances.
- **The map:** in Light and Day the map keeps TASK-162's palette. In Dark with Day lighting, it
  gets a dark canvas and building variant, while roads, markings and rail stay in their real
  colours.

## Scope

`src/ui/**` tokens and components, the map canvas, building and land-use colours under a dark
variant, the settings control, and tests.

## Gates

- Shots of each sidebar section, inspector, sheet and popover in both appearances, plus the map at
  Day and Night in Dark. Save numbered previews to `D:\cityflows-wt\166-evidence\previews\` with a
  log.md.
- Contrast checks.
- `npm run check`, `test:city`, `test:e2e:light`, and T62/T64 with no regression.
- No simulation or project hash moves.

## Report

Write it as the commit body: tokens, the switching rules, shots, contrast, tests, and anything
left open.
