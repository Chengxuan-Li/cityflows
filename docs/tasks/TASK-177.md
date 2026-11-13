# TASK-177 — User documentation and in-app help

Owner: Claude Code subagent (Sonnet 5.5, high). Branch `task/177-user-docs`, worktree
`D:\cityflows-wt\177`. It starts after TASK-160/162/163 and TASK-168 are on main.

## Goal

Update the user README and the in-app hints for what landed on 2026-11-13:
- the Mac window and its sidebar sections;
- the map palette;
- lighting presets and the evening scene;
- mode choice and its sliders;
- household cars and station riders;
- keyboard shortcuts and the command menu;
- dark appearance, if landed.

Plain words, with no self-referential or AI copy, following AGENTS.md. Include a few screenshots
in the README, with the paths kept in the repo's docs assets.

## Gates

- The links in the README resolve.
- Hints point at existing controls; extend the onboarding e2e.
- `npm run check`, `test:e2e:light`.

## Report

Write it as the commit body.
