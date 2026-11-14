# TASK-189 — Inspector as a bottom sheet on phones

Status: planned, not started; awaiting owner approval (lead, 2026-11-14). Proposed owner: Claude Code
subagent (Sonnet 5.5, high). Branch `task/189-phone-sheet`, worktree `D:\cityflows-wt\189`, ports 5389 / 5489.

## Goal

TASK-160's follow-up (plan.md): at phone width (under 600 px) the inspector should be a half-height
bottom sheet over the map, in the Mac style (no glass): a grabber, half and full heights by drag or
tap, swipe or Escape to close, the map still usable above it, and the selection's heading always
visible. It opens when something is selected, as the docked inspector does today.

## Scope

`src/ui/**`, `src/ui/app.css`, a phone e2e spec.

Out of scope: wider layouts (they must not change), the simulation, `src/schema`.

## Gates

- A phone e2e (390 x 844): select a road, the sheet opens at half height with the heading visible;
  drag to full and back; Escape closes; the map pans above the sheet.
- Computed styles unchanged at 768 px and wider (TASK-182's comparison method).
- Contrast test, `npm run check`, `test:e2e:light`, `qa-mobile`.
- Screenshots at 390 px: half, full, closed, Light and Dark.

## Report

Write it as the commit body.
