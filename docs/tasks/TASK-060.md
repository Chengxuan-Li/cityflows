# TASK-060 — Tooling: workflow actions and audit advisories

Owner: unassigned
Gate: 5 (deferral "npm audit" in the plan; CI warnings)
Depends on: none

## Goal

Keep CI running and the dev toolchain clean. `.github/workflows/ci.yml` uses
`actions/checkout@v4`, `actions/setup-node@v4` and `actions/upload-artifact@v4`, which
GitHub now runs on a forced Node 24 with a deprecation warning. `npm audit` reports twelve
moderate advisories, all the `minimatch` "globparts amplification" issue reached through
`eslint`, `@eslint/js`, `typescript-eslint` and `eslint-plugin-react-refresh`; the fix for
most is a newer `typescript-eslint` and `eslint`, and `eslint-plugin-react-refresh` has no
fixed release at the time of writing.

## In scope

- `.github/workflows/ci.yml`: the current major release of each action (check the release
  pages), Node 24 kept, nothing else changed.
- `package.json` devDependencies and `package-lock.json`: the smallest upgrades of `eslint`,
  `@eslint/js`, `typescript-eslint` (and `eslint-plugin-react-refresh` if a fixed release
  exists) that clear the advisories; pinned the way the existing entries are. No runtime
  dependency changes, no Vite, Vitest, Playwright, TypeScript or React changes.
- `eslint.config.js` only if an upgraded rule set needs a configuration change; a rule that
  starts failing is fixed in the code where the fix is a one-liner, otherwise disabled with
  the reason in the PR.

## Out of scope

- Everything else. This task does not touch `src`, `tests` or `docs` except for lint
  one-liners.

## Acceptance

- `npm audit` reports zero moderate or higher advisories, or the PR names each remaining
  one and why it cannot be fixed.
- `npm run check` green locally; the PR's CI run green on GitHub, both jobs, with no action
  deprecation annotation.
- `npm run test:e2e` green locally.

## Commands

`npm ci`, `npm audit`, `npm run check`, `npm run test:e2e`

## Deliverable

PR with the workflow and dependency changes and the audit output before and after.
