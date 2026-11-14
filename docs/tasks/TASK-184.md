# TASK-184 — Follow clock reaches evening; vehicle lights under bridge decks

Owner: Claude Code subagent (Sonnet 5.5, high). Branch `task/184-evening-clock`, worktree
`D:\cityflows-wt\184`, ports 5384 / 5484.

## Goal

Two items from the TASK-163 review (plan.md):

1. **Follow clock never reaches evening.** "Follow simulation clock" uses one Munich-like day
   (sunrise 06:00, sunset 20:00), but the bundled scenarios end at 18:00, so a normal run never
   shows the evening scene the owner asked for. Add a season choice to Follow clock (Summer,
   Spring/autumn, Winter, with sunrise and sunset close to Munich's at the solstices and equinoxes,
   e.g. Winter about 08:00 to 16:20). In Winter a bundled run must pass through dusk into the
   evening look before it ends. It is a view preference stored with the lighting setting
   (`cityflows.lighting`, older stored values still load), never in the project. Default: keep the
   current day as Spring/autumn's neighbour, or pick the season closest to it, and say which. The
   Day, Evening and Night presets look exactly as before.
2. **Vehicle lights through bridge decks (2D).** In 2D Evening and Night, head- and tail-lamps and
   road beams of vehicles under a bridge deck show through the deck. Draw them under the decks
   above them, as the vehicles themselves are.

## Scope

`src/render/lighting.ts`, the lighting settings component in `src/ui/**`, the 2D night or vehicle
light layer in `src/render/**`, the matching 3D clock use in `src/render3d/**` if the clock is read
there, tests.

Out of scope: the simulation, scenario files and their times, `src/schema`.

## Gates

- Unit tests for the season sun model (sunrise, sunset, and that Winter reaches the evening look
  before 18:00) and for loading an older stored lighting value.
- A test or pinned render that a light under a deck is covered.
- `npm run check`, `test:city`, `test:e2e:light`, V163, T62/T64 (2D Evening within TASK-163's
  limits).
- Screenshots: a bundled run in Follow clock / Winter at 15:00, 16:30 and 17:45 in 2D and 3D; a
  bridge in 2D Night before and after. Send these to the lead as each step lands.

## Report

Write it as the commit body.
