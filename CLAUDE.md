# CLAUDE.md

Read `AGENTS.md` first; it holds the rules, layout, commands and delivery protocol. This file
only adds Claude Code specifics.

- Work in a worktree or a `task/<id>-<name>` branch. Never commit directly to `main`.
- Before claiming a task done, run `npm run check` and paste the final lines of its output in
  the PR description. For UI tasks, also open the app with the preview tooling and exercise the
  workflow you built; describe what you saw.
- Also run the task's tiers (AGENTS.md "Delivering a task"): `test:city`, `traffic:quick`, `test:e2e:smoke`.
- Keep edits to the task's "In scope" files plus what the feature needs to be wired in,
  type-check or be tested; list the extra files in your report. Stop and report only for a file
  under "Out of scope", a contract change (`src/schema`, `docs/architecture.md`) the task does
  not describe, or a behaviour change to another feature.
- Do not add dependencies, Markdown files, or configuration systems unless the task asks.
- Use `npm`, not pnpm or yarn.
