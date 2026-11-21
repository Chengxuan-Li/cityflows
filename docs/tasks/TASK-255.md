# TASK-255 — Stop lines at the painted line where a signal sits ahead of its junction (TASK-218's D4 with J1)

Status: in progress 2026-11-20 (third unsupervised run). Proposed owner: Claude Code subagent (Opus 5.5,
high). Branch `task/255-stop-line-groups`, worktree `D:\cityflows-wt\255`, ports 5455 / 5555.

## Goal

TASK-218 (parked; branch `task/218-importer-roads`, `26f69c5`; review in `docs/plan.md`) had D4: a signal
mapped at its stop line within 30 m of the junction its control moved to joins that junction's group. It
moved `r:1178`'s stop line from 9 m past the painted line to 0.8 m from it, which shows on the landing
page. Its new groups worsened the audit: fold back-step 3.47 to 6.63 m (`r:1185`, the Hbf inner road,
J1) and bulge 31.46 to 41.76 m². TASK-234 has since landed TASK-226's group membership (D2) on main.
Land D4 on current main with J1 fixed so that the audit stays within the lead's tolerance.

The owner's rule (2026-11-20): improve the reading of OSM, not OSM itself, and no per-id curation.

## Scope

`src/importers/osm/controls.ts`, `split.ts`, `src/network/junctions.ts`, `groups.ts`, tests, the Freiburg
rebuild and pins, Munich re-pins, close-ups under `docs/findings/2026-11-20-stop-line-groups/` (aerial
overlay; imagery read-only in `D:\cityflows-wt\216-data`; download nothing).

Out of scope: `src/sim/**` rules, `src/schema`, the audit, gate floors, `bench/traffic-baseline.json`.

## Gates

- A test that fails without D4; the groups it changes per city; `r:1178` and `r:1185` before and after
  against the imagery.
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both signal modes; full
  demand on seeds 1 to 5, both modes (the five-seed reading); Freiburg's gate and seeds 1 to 3;
  Sindelfingen; the Munich gate and mode-share guard (references: the newest figures in `docs/plan.md`).
- The geometry audit on the three cities, within the lead's tolerance (decisions log, 2026-11-20).
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: the rule, the groups, the audit, the traffic tables.
