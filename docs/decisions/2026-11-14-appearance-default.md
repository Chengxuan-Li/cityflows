# Decision: the default appearance

Raised by the lead, 2026-11-13 (TASK-166 review).

## Context

TASK-166 added an Appearance pop-up (System / Light / Dark) and a "Match lighting" checkbox in Layers,
stored per viewer (`cityflows.appearance`). The default is System: the window and map follow the
operating system's light or dark setting, live. Match lighting is off by default.

## Options

1. **System** (main): follows the viewer's OS, as Mac apps do.
2. **Light**: always light until the viewer changes it; screenshots and demos look the same everywhere.
3. **System with Match lighting on**: also darkens the window at Evening, Night or after dusk.

## Lead recommendation

Option 1, the macOS convention the owner chose for the UI style (Sonoma/Ventura). Tests and screenshots
already pin the appearance explicitly, so the default does not affect them.

## How to apply

Change the fallback in `src/ui/appearance-store.ts` (and its unit test); no other file depends on it.

Status: awaiting owner
