# TASK-242 — Road widths from the data: urban lane widths, `width` tags and `placement` (TASK-218's D3, D9)

Status: in progress (second unsupervised run, owner 2026-11-20; split from parked TASK-218). Proposed
owner: Claude Code subagent (Opus 5.5, high). Branch `task/242-road-widths`, worktree
`D:\cityflows-wt\242`, ports 5442 / 5542.

## Goal

TASK-218 (parked; branch `task/218-importer-roads`, `26f69c5`; review in `docs/plan.md`) narrowed untagged
urban lanes (secondary 3.25 m, tertiary 3.0 m), read `width:lanes` and `width`, and ignored
`source:width=estimated`. Its widths moved Munich (the three `width` ways with street parking widened 22
roads) and the audit got worse: Munich voids rose (narrower lanes leave more of each median undrawn).
TASK-224 found the five-lane approaches the right width but 1.7 m off the ground because the importer
ignores `placement` (284 Freiburg ways). TASK-233 has since made measure 9 grade-aware.

1. Land the width rules that match the ground (Bismarckallee 3.45 to 3.5 m per lane; `r:261`, `r:1179`
   16.0 and 15.5 m on the ground; Rotteckring `width` 4 m against about 5 m), with `width` read only on
   ways without street parking as TASK-218's variant did.
2. Read `placement` (`left_of:N`, `right_of:N`, `middle_of:N`, `transition`) so a way's line sits on the
   named lane boundary as OSM intends; check `r:261` and `r:1179` against the imagery.
3. If narrower lanes widen corridor voids, say whether the void is real (ground has a median there) or an
   artefact of the measure, with evidence; the audit is not to be changed in this task.

## Scope

`src/importers/osm/roads.ts` (widths), `src/importers/osm/corridors.ts` (placement offsets; TASK-238's
median rule must keep working), tests, the Freiburg rebuild and pins, Munich re-pins, close-ups under
`docs/findings/2026-11-20-road-widths/` (aerial overlay; imagery read-only in `D:\cityflows-wt\216-data`;
download nothing).

Out of scope: `split.ts`, `src/network/**`, `src/sim/**`, `src/schema`, the audit, gate floors,
`bench/traffic-baseline.json`.

## Gates

- A test per rule that fails without it; roads touched per city; `r:261`, `r:1179`, Bismarckallee and
  Rotteckring against the imagery before and after.
- The audit on the three cities: no worsening beyond the lead's tolerance (decisions log, 2026-11-20).
- Traffic, main against branch: Munich 0.15 seeds 1 to 12, choice off and on, both modes; full demand
  both modes; Freiburg's gate and seeds 1 to 3; Sindelfingen; the Munich gate and mode-share guard
  (references: the newest figures in `docs/plan.md`).
- The owner's merge rule. If the first version misses, one variant, both tables.
- `npm run check`, `test:city`, `test:traffic:light`, `test:e2e:light`.

## Report

Write it as the commit body: per rule the cause, the rule, the counts; the imagery checks; the audit;
the traffic tables.
