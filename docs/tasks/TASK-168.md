# TASK-168 — Keyboard shortcuts and a command menu

Owner: Claude Code subagent (Sonnet 5.5, high). Branch `task/168-shortcuts`, worktree
`D:\cityflows-wt\168`, ports 5368 / 5468. It starts once TASK-160 is on main.

## Goal

Mac-style keyboard control, using ⌘ on Mac and Ctrl elsewhere:
- **File and history:** ⌘N new, ⌘O open, ⌘S save, ⌘⇧S export, ⌘Z / ⌘⇧Z undo and redo.
- **Run:** Space play or pause, `.` step, ⌘R restart, `[` and `]` speed down and up.
- **Tools:** 1–5 switch tools.
- **View:** ⌘1 and ⌘2 toggle the sidebar and the inspector, ⌘3 switches 2D/3D.
- **Selection:** Esc clears the selection, Delete deletes it with confirmation where the action
  already has one.
- **Command menu:** ⌘K opens a searchable list of every action, with its shortcut shown.
- **Shortcut sheet:** ⌘/ or ? shows all shortcuts in a sheet.
- **Behaviour:** shortcuts never fire while typing in a field. They appear in tooltips, in the »
  overflow menu and in the command menu.

## Scope

A small key-binding module in `src/ui`, the command menu component, tooltip text, and tests,
including an e2e spec that drives the main shortcuts.

## Gates

- An e2e spec for shortcuts and the command menu.
- `npm run check`, `test:e2e:light`.
- Previews of the command menu and the shortcut sheet in
  `D:\cityflows-wt\168-evidence\previews\`.

## Report

Write it as the commit body: the bindings, tests, shots, and anything left open.
