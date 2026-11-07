# TASK-090 — Fast checks: test tiers, a city import cache, one shared Munich morning

Owner: unassigned
Gate: process (owner, 2026-11-06, after round 5: "how we may fast track the development by
simplifying checks we run"; the lead's proposal was approved as written).
Depends on: nothing. Design: this file; `docs/plan.md` review log of TASK-089 and the
CI-timeout fixes (`vite.config.ts` 60 s, `playwright.config.ts` 20 s expect).

## Why

Measured on main `5b9bb67` (28-core machine, idle unless noted):

- `npm test` takes about 140 s wall. Five tests each simulate the same Munich morning at
  scale 0.15: `tests/importers/munich.test.ts` (141 s), `tests/sim/T21-conflict-zones` (112 s),
  `tests/sim/T29-mandatory-changes` (80 s), `T36.4` (48 s), `T38.5` (44 s). Together that is
  about 430 s of CPU time, and the slowest of them sets the suite's wall time.
- 51 further tests import Munich or Sindelfingen again (each test file runs isolated). An
  import takes about 2 s idle and 5 to 12 s under load: about 390 s of CPU time, and the cause
  of CI's 5 s timeouts.
- The browser tests take 10 min locally and 29 min on CI. They run on one worker
  (`workers: 1`, GPU starvation), and on CI the e2e job also waits for `check`.
- Exact-baseline tests break on every geometry change and have to be recaptured and named in
  each task. Examples: T25's exact Munich setbacks, the throughput route baselines, outline
  fingerprints and hashes, T38.4's named storage exceptions. TASK-089 ran the unit tests about
  24 times, the audit 23 times and the shots more than 10 times.

## Design

1. **Three tiers.** Every test keeps running in at least one tier.
   - `npm test` (the default, and what `npm run check` runs) covers unit tests, grid, town and
     the Sindelfingen geometry. It runs no Munich import or simulation and no traffic
     simulation of a real city. Target: at most 45 s wall on this machine when idle.
   - `npm run test:city` covers the Munich geometry and import tests.
   - `npm run test:traffic` covers the one shared Munich morning (item 3).
   - Implement the tiers with vitest `projects` or an include/exclude per tier, whichever is
     simpler. Moving a test file is fine. Splitting a mixed file is fine. Skipping by
     environment variable is a last resort.
2. **City import cache.** `loadAuditCity` and the tests' real-city loaders read a cached import
   from `node_modules/.cache/cityflows/` (gitignored by `node_modules`).
   - The key is a hash of: the OSM file bytes, the import options, and the contents of every
     module in the importer's static import graph. Compute the graph by walking the imports
     from `src/importers/osm/index.ts`; do not use a hand-kept list.
   - Write atomically (temp file, then rename). Workers may race.
   - `CITYFLOWS_NO_CACHE=1` bypasses the cache.
   - The determinism and reimport tests always import fresh.
   - Compile is not cached (0.26 s).
3. **One shared Munich morning.** One test file in the traffic tier runs the scale-0.15
   Munich morning once. It attaches every observer that `munich.test.ts`, T21, T29, T36.4 and
   T38.5 need, keeps each of their assertions under its original name, and checks the traffic
   gate (at least 3 497 completed and at least 90 percent of the recorded main figure;
   gridlocked at most 1.5 times main; stalledHeads 0; no non-gridlocked failures).
   - Record main's figures in one place: `bench/traffic-baseline.json`, currently 3 762
     completed and 49 gridlocked.
   - The run must reproduce `npm run import-probe` at 0.15 exactly (the same totals).
4. **Quick traffic run for iterating.** `npm run traffic:quick` runs the same Munich extract
   for a shorter window, or at a smaller scale. Choose whichever predicts the 0.15 gate
   better, and measure that on two recorded trees: `a18cce0` (0.15 gives 3 863 completed,
   42 gridlocked) and `81dfcd0` (3 762 completed, 49 gridlocked). It prints the totals and the delta against its own recorded
   baseline. It is advisory only and never gates. Target: under 30 s.
5. **Tolerances instead of exact baselines** for geometry and routing expectations.
   - Exact route-baseline equality becomes:
     - determinism: the same requests routed twice, and reversed, are equal;
     - route audit zero;
     - at most 10 percent of the sampled routes change roads against the recorded baseline.
   - T25's exact Munich setbacks become a tolerance: at most N nodes change by more than
     0.5 m. Choose N from the history of the last three tasks and say what you chose.
   - Named-exception lists become counted budgets with a threshold. Examples: T38.4 storage
     ("at most 30 lanes lose more than 2 m, none more than 10 m"), the lists in
     `tests/network/junction-audit.ts`, T39's named pairs, and wobble exceptions where the
     list exists only to absorb churn.
   - Pure outline hashes and fingerprints are removed. Reimport determinism covers
     determinism.
   - Keep exact checks where exactness is the property: simulation determinism, the
     benchmark hashes, id stability, project-file round trips, and the named cases the owner
     asked about (`r:259`/`r:694`, G2 through at most 0.1 m).
   - List every converted or removed assertion in the report, each with its reason.
6. **Browser tests.**
   - Tag about 10 smoke tests `@smoke`. Cover: app load, play, editing a road, import of the
     downtown fixture, save and reopen, and one test per panel family.
   - `npm run test:e2e:smoke` runs them. Target: at most 3 min locally.
   - CI shards the full suite over 3 matrix jobs (`--shard=i/3`). The e2e jobs no longer
     wait for `check`, so they run alongside it.
7. **CI layout.** The jobs `check` (`npm run check`), `city` (`test:city` and `test:traffic`),
   `e2e` (3 shards) and `deploy` (needs `check`) all run in parallel. Target: about 15 min wall.
8. **Screenshots.** `npm run geometry-shots -- <dir> --only <id,id>` captures only the named
   cameras.
9. **Docs.**
   - `AGENTS.md` "Commands" and "Delivering a task": agents run `npm run check`, plus the
     tiers that match the task (`test:city` for network, importer and render geometry;
     `traffic:quick` while iterating; `test:e2e:smoke` for UI). The lead runs `test:city`,
     `test:traffic` and the full e2e at merge.
   - `CLAUDE.md` gets the same in one line.
   - `docs/architecture.md` section 14 test table: the tier of each test family.

## In scope

`package.json` (scripts only, no new dependency), `vite.config.ts`, `playwright.config.ts`,
`.github/workflows/ci.yml`, `bench/junction-audit.ts` and the other bench loaders (cache),
`bench/geometry-shots.ts` (`--only`), `bench/traffic-baseline.json` (new),
`bench/import-probe.ts` (shared run code, if you factor it out), `tests/**` (moves, splits,
tolerances, tags), `AGENTS.md`, `CLAUDE.md`, `docs/architecture.md` section 14.

## Out of scope

`src/**` behaviour. A test helper may move into `tests/`, and the cache may live in `bench/`
or `tests/`. Do not change what any city imports or simulates.

## Gates

1. `npm test` takes at most 45 s wall on this machine when idle. Give the before and after
   wall times, three runs each.
2. `test:city` and `test:traffic` pass. The shared morning matches `import-probe` at 0.15
   exactly. The traffic tier takes at most 3 min.
3. Coverage is kept: every assertion of main exists in some tier or is listed as converted or
   removed with its reason. Give the test counts per tier.
4. A cache hit gives a city deep-equal to a fresh import for Munich and Sindelfingen (a test
   in the city tier). Editing any file in the importer graph invalidates the cache, and you
   show this.
5. `traffic:quick` ranks `a18cce0` and `81dfcd0` in the same order as the 0.15 run does, on
   completed trips and on gridlock, or you explain why it cannot. Give its runtime.
6. `test:e2e:smoke` takes at most 3 min, and the full e2e still passes 66.
7. `npm run check` is green. Benchmark hashes are unchanged.

## Acceptance

All gates. The lead pushes, and CI on main must go green with the new layout.

## Deliverable

A report in the body of your last commit message (no new Markdown files):

- the tiers and their wall times;
- the cache;
- the shared morning's numbers;
- `traffic:quick` against the 0.15 gate;
- every converted or removed assertion, with its reason;
- the CI layout;
- the final lines of `npm run check`.

Commit in your git worktree; the lead reviews only commits.
