# TASK-182 — One copy of each rule in app.css

Owner: Claude Code subagent (Sonnet 5.5, high). Branch `task/182-css-dedupe`, worktree
`D:\cityflows-wt\182`, ports 5382 / 5482.

## Goal

`src/ui/app.css` (2,807 lines) holds two near-identical copies of most rules (for example `.app` at
lines 1009 and 1384), a merge leftover from the 2026-11-13 UI work; the later copy wins. Keep one copy
of each rule, merging any property that differs into the copy that wins today, so the computed style
of every element stays exactly the same.

## Scope

`src/ui/app.css` only, plus a throwaway comparison script kept in the evidence folder.

## Gates

- Computed styles unchanged: for the window in Light and Dark, with each sidebar section, an inspector,
  a popover, each sheet, a tooltip and the phone width open, `getComputedStyle` of every element is
  identical before and after (a script that dumps and diffs them).
- Screenshots of those states match before and after.
- `src/ui/contrast.test.ts` passes; `npm run check`, `test:e2e:light`.

## Report

Write it as the commit body: lines before and after, any property that differed between copies and
which value won, the comparison result.
