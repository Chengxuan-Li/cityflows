# TASK-191 — Shortcut keys that browsers reserve

Status: planned, not started; awaiting owner approval (lead, 2026-11-14). Proposed owner: Claude Code
subagent (Sonnet 5.5, high). Branch `task/191-reserved-keys`, worktree `D:\cityflows-wt\191`, ports 5391 / 5491.

## Goal

TASK-168 open item (plan.md): browsers reserve Ctrl/Cmd+N (new window) and may reserve mod+1 to 3
(switch tab) in a normal tab, so those shortcuts never reach the app. Give each affected command a key
the page can receive in Chrome, Edge, Firefox and Safari in a normal tab, following macOS conventions
where possible, and keep the shortcut sheet, tooltips and overflow labels in step (they read the one
command table).

## Scope

`src/ui/shortcuts.ts`, `src/ui/commands.ts`, T80 and the shortcut unit tests, README's keys table.

Out of scope: adding commands, the simulation.

## Gates

- A unit test that no command uses a browser-reserved chord (a listed set, with sources in a comment).
- T80 passes (and 20 repeats under `--repeat-each`).
- `npm run check`, `test:e2e:light`.

## Report

Write it as the commit body.
