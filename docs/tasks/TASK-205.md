# TASK-205 — Each worktree builds its own production test bundle

Status: done 2026-11-18. Proposed owner: Claude Code subagent (Sonnet 5.5,
high). Branch `task/205-qa-cache`, worktree `D:\cityflows-wt\205`, ports 5405 / 5505.

## Goal

`playwright.config.ts` builds the production bundle for `qa-production.spec.ts` into
`node_modules/.cache/qa-production`. Every worktree links `node_modules` to `D:\cityflows\node_modules`,
so all worktrees share that folder: two agents running the production spec at once overwrite each
other's bundle, and one can test another's code. Build it inside the worktree instead (for example
`dist-production/` beside the test build's `dist`, git-ignored), so each checkout tests its own code.

Check every place that names the old path (Playwright config, scripts, specs, CI workflows) and update
them. CI must still build and test the same bundle.

## Scope

`playwright.config.ts`, `.gitignore`, `package.json` scripts if they name the path, the specs that
read the bundle, `.github/workflows/*` only where they name the path.

Out of scope: application code, test logic, other configuration.

## Gates

- `npx playwright test tests/e2e/qa-production.spec.ts` builds into the worktree and passes; nothing
  is written under `node_modules/.cache/qa-production`.
- `npm run check`, `test:e2e:light`.
- The ci.yml and full.yml runs on the merge stay green (the lead checks after merging).

## Report

Write it as the commit body: the new path, every file changed, and the production spec's result.
