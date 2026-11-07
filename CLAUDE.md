# CLAUDE.md

Read `AGENTS.md` first; it holds the rules, layout, commands and delivery protocol. This file
only adds Claude Code specifics.

- Work in a worktree or a `task/<id>-<name>` branch. Never commit directly to `main`.
- Before claiming a task done, run `npm run check` and paste the final lines of its output in
  the PR description. For UI tasks, also open the app with the preview tooling and exercise the
  workflow you built; describe what you saw.
- Also run the task's tiers (AGENTS.md "Delivering a task"): `test:city`, `traffic:quick`, `test:e2e:smoke`.
- Keep edits inside the task's "In scope" files. If the task needs a contract change in
  `src/schema` or `docs/architecture.md`, stop and report instead of changing it.
- Do not add dependencies, Markdown files, or configuration systems unless the task asks.
- Use `npm`, not pnpm or yarn.
