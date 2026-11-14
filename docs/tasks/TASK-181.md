# TASK-181 — Window scroll after Play and the mode-choice switch label

Owner: Claude Code subagent (Sonnet 5.5, high). Branch `task/181-ui-polish`, worktree
`D:\cityflows-wt\181`, ports 5381 / 5481.

## Goal

Two items TASK-177 found (2026-11-14):

1. **Sideways scroll.** After Play in a 1280 px window (dev build), `.app` scrolled 32 px
   sideways and shifted the whole window left. The window must never scroll horizontally at any
   width (AGENTS.md "Design direction": nothing wraps, the overflow menu takes what does not fit).
   Find what overflows (likely a run-time element in the toolbar or status bar growing with the
   clock or counts) and fix it at the cause.
2. **Switch label.** The Demand section's switch still reads "Choose walk or car per trip" although
   mode choice now includes transit (TASK-174). Give it a plain label that covers walk, car and
   transit, and update T79 and the e2e helper that find it by name.

## Scope

`src/ui/**`, `app.css`, the specs that name the switch, and a regression e2e for the scroll.

## Gates

- A regression check: after Play, at 1280, 1024 and 900 px, `.app` and the document have no
  horizontal scroll (scrollWidth equals clientWidth).
- `npm run check`, `test:e2e:light`, and the specs that name the switch.
- A before/after screenshot of the window after Play at 1280 px.

## Report

Write it as the commit body.
